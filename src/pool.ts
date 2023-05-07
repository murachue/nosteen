// based on nostr-tools@1.10.1

import { Event, Filter, utils } from 'nostr-tools';
import { Pub, Relay, Sub, SubscriptionOptions, relayInit } from './relay';
import { getmk } from './util';

export type MuxEvent = {
    relay: Relay;
    event: Event;
};
export type MuxError = {
    relay: string;  // we cannot ensure that Relay instance is available...
    reason: unknown;
};
export type MuxOk = {
    relay: Relay;
    reason: string;
};

type MuxSubEvent = {
    event: (receive: MuxEvent) => void | Promise<void>;
    error: (failure: MuxError) => void | Promise<void>;
    eose: () => void | Promise<void>;
};
export type MuxSub = {
    sub: (filters: Filter[], opts: SubscriptionOptions) => MuxSub;
    unsub: () => void;
    on: <T extends keyof MuxSubEvent, U extends MuxSubEvent[T]>(
        event: T,
        listener: U
    ) => void;
    off: <T extends keyof MuxSubEvent, U extends MuxSubEvent[T]>(
        event: T,
        listener: U
    ) => void;
};

type MuxPubEvent = {
    ok: (receive: MuxOk) => void;
    failed: (failure: MuxError) => void;
};
export type MuxPub = {
    off: <T extends keyof MuxPubEvent, U extends MuxPubEvent[T]>(
        event: T,
        listener: U
    ) => void;
    on: <T extends keyof MuxPubEvent, U extends MuxPubEvent[T]>(
        event: T,
        listener: U
    ) => void;
    forget: () => void;
};

// TODO: reconnect with exp-time
// TODO: resub on reconnect
export class MuxPool {
    private _conn: { [url: string]: Relay; };

    private eoseSubTimeout: number;
    private getTimeout: number;

    constructor(options: { eoseSubTimeout?: number; getTimeout?: number; } = {}) {
        this._conn = {};
        this.eoseSubTimeout = options.eoseSubTimeout || 3400;
        this.getTimeout = options.getTimeout || 3400;
    }

    close(relays: string[]): void {
        relays.forEach(url => {
            let relay = this._conn[utils.normalizeURL(url)];
            if (relay) relay.close();
        });
    }

    async ensureRelay(url: string): Promise<Relay> {
        const nm = utils.normalizeURL(url);

        if (!this._conn[nm]) {
            this._conn[nm] = relayInit(nm, {
                getTimeout: this.getTimeout * 0.9,
                listTimeout: this.getTimeout * 0.9
            });
        }

        const relay = this._conn[nm];
        await relay.connect();
        return relay;
    }

    sub(relays: string[], filters: Filter[], opts?: SubscriptionOptions): MuxSub {
        const subs: Sub[] = [];
        let subListeners: { [TK in keyof MuxSubEvent]: MuxSubEvent[TK][] } = {
            event: [],
            error: [],
            eose: [],
        };
        let eosesMissing = relays.length;
        let eoseSent = false;
        const eoseTimeout = setTimeout(() => {
            eoseSent = true;
            subListeners.eose.forEach(cb => cb());
            subListeners.eose = []; // 'eose' only happens once per sub, so stop listeners here
        }, this.eoseSubTimeout);

        relays.forEach(async relay => {
            let r: Relay;
            try {
                r = await this.ensureRelay(relay);
            } catch (err) {
                handleEose();
                return;
            }
            let s = r.sub(filters, opts);
            s.on('event', (event: Event) => {
                subListeners.event.forEach(cb => cb({ relay: r, event }));
            });
            s.on('eose', () => {
                handleEose();
            });
            s.on('error', err => {
                handleEose();
            });
            subs.push(s);

            function handleEose() {
                if (eoseSent) return;
                eosesMissing--;
                if (eosesMissing === 0) {
                    clearTimeout(eoseTimeout);
                    subListeners.eose.forEach(cb => cb());
                    subListeners.eose = []; // 'eose' only happens once per sub, so stop listeners here
                }
            }
        });

        let greaterSub: MuxSub = {
            sub(filters, opts) {
                subs.forEach(sub => sub.sub(filters, opts));
                return greaterSub;
            },
            unsub() {
                subs.forEach(sub => sub.unsub());
            },
            on: (event, listener) => {
                subListeners[event].push(listener);
            },
            off(type, cb) {
                let idx = subListeners[type].indexOf(cb);
                if (idx >= 0) subListeners[type].splice(idx, 1);
            }
        };

        return greaterSub;
    }

    // resolve on first event receive.
    // good for ids, bad for replacable events.
    get(
        relays: string[],
        filter: Filter,
        opts?: SubscriptionOptions
    ): Promise<MuxEvent | null> {
        return new Promise(resolve => {
            let sub = this.sub(relays, [filter], opts);
            let timeout = setTimeout(() => {
                sub.unsub();
                resolve(null);
            }, this.getTimeout);
            sub.on('event', (receive) => {
                resolve(receive);
                clearTimeout(timeout);
                sub.unsub();
            });
        });
    }

    // resolve on all relay's eose (or timeout)
    // also good for replacable events.
    list(
        relays: string[],
        filters: Filter[],
        opts?: SubscriptionOptions
    ): Promise<MuxEvent[]> {
        return new Promise((resolve, reject) => {
            let events: MuxEvent[] = [];
            let sub = this.sub(relays, filters, opts);

            sub.on('event', (receive) => {
                events.push(receive);
            });

            // we can rely on an eose being emitted here because pool.sub() will fake one
            sub.on('eose', () => {
                sub.unsub();
                resolve(events);
            });

            sub.on('error', reason => {
                reject(reason);
            });
        });
    }

    publish(relays: string[], event: Event): MuxPub {
        // we maintain listeners ourself for both make-easier and quick-return without switching microtask.
        let pubListeners: Map<string, { [TK in keyof MuxPubEvent]: MuxPubEvent[TK][] }> = new Map();
        let unlinker = () => { };  // hacky...

        relays.forEach(relay => (async () => {
            try {
                const r = await this.ensureRelay(relay);
                const pub = r.publish(event);
                const okhandler = (reason: string): void => {
                    const listeners = pubListeners.get(relay);
                    if (listeners) {
                        listeners.ok.forEach(cb => cb({ relay: r, reason }));
                        pubListeners.delete(relay);
                    }
                    if (pubListeners.size === 0) {
                        unlinker();
                    }
                };
                const failedhandler = (reason: unknown): void => {
                    const listeners = pubListeners.get(relay);
                    if (listeners) {
                        listeners.failed.forEach(cb => cb({ relay, reason }));
                        pubListeners.delete(relay);
                    }
                    if (pubListeners.size === 0) {
                        unlinker();
                    }
                };
                unlinker = () => {
                    pub.off('ok', okhandler);
                    pub.off('failed', failedhandler);
                };
                pub.on('ok', okhandler);
                pub.on('failed', failedhandler);
            } catch (reason) {
                pubListeners.forEach(lns => lns.failed.forEach(cb => cb({ relay, reason })));
            }
        })().catch(console.error));

        return {
            on(event, listener) {
                // XXX: on()'ed after complete will not be invoked.
                relays.forEach(async (relay, i) => {
                    getmk(pubListeners, relay, () => ({ ok: [], failed: [] }))[event].push(listener);
                });
            },
            off(event, listener) {
                relays.forEach(async (relay, i) => {
                    const lns = getmk(pubListeners, relay, () => ({ ok: [], failed: [] }))[event];
                    let idx = lns.indexOf(listener);
                    if (idx >= 0) lns.splice(idx, 1);
                });
            },
            forget() {
                pubListeners.clear();
                unlinker();
            }
        };
    }
}
