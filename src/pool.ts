// based on nostr-tools@1.10.1

import { Event, Filter, utils } from 'nostr-tools';
import { Relay, Sub, SubscriptionOptions, relayInit } from './relay';
import { getmk } from './util';

export type MuxedEvent = {
    relay: Relay;
    event: Event;
};
export type MuxedError = {
    relay: string;  // we cannot ensure that Relay instance is available...
    reason: unknown;
};
export type MuxedOk = {
    relay: Relay;
    reason: string;
};

type ListenerModifier<E> = <T extends keyof E, U extends E[T]>(event: T, listener: U) => void;
type ListenersContainer<E> = { [TK in keyof E]: E[TK][] };

type MuxEvent = {
    health: (relay: Relay, event: "connected" | "disconnected") => void | Promise<void>;
};

type MuxSubEvent = {
    event: (receive: MuxedEvent) => void | Promise<void>;
    error: (failure: MuxedError) => void | Promise<void>;
    eose: () => void | Promise<void>;
};
export type MuxSubscriptionOptions = SubscriptionOptions & {
    refilters?: (relay: string, filter: Filter[]) => Filter[];
};
export type MuxSub = {
    sub: (filters: Filter[], opts: MuxSubscriptionOptions) => MuxSub;
    unsub: () => void;
    on: ListenerModifier<MuxSubEvent>;
    off: ListenerModifier<MuxSubEvent>;
};

type MuxPubEvent = {
    ok: (receive: MuxedOk) => void;
    failed: (failure: MuxedError) => void;
};
export type MuxPub = {
    on: ListenerModifier<MuxPubEvent>;
    off: ListenerModifier<MuxPubEvent>;
    forget: () => void;
};

// TODO: reconnect with exp-time
export class MuxPool {
    private _conn: { [url: string]: Relay; };
    private subListeners: ListenersContainer<MuxEvent> = {
        health: [],
    };

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
            const r = relayInit(nm, {
                getTimeout: this.getTimeout * 0.9,
                listTimeout: this.getTimeout * 0.9
            });
            r.on('connect', () => this.subListeners.health.forEach(cb => cb(r, 'connected')));
            r.on('disconnect', () => this.subListeners.health.forEach(cb => cb(r, 'disconnected')));
            this._conn[nm] = r;
        }

        const relay = this._conn[nm];
        await relay.connect();
        return relay;
    }

    on: ListenerModifier<MuxEvent> = (event, listener) => {
        this.subListeners[event].push(listener);
    };
    off: ListenerModifier<MuxEvent> = (event, listener) => {
        let idx = this.subListeners[event].indexOf(listener);
        if (idx >= 0) this.subListeners[event].splice(idx, 1);
    };

    sub(relays: string[], filters: Filter[], opts?: MuxSubscriptionOptions): MuxSub {
        // XXX: this subs is complicated...
        const subs = new Map<string, {
            relay: Relay;
            sub: Sub;
            disconnectl: () => void | Promise<void>;
            connectl: () => void | Promise<void>;
        }>();
        const subListeners: ListenersContainer<MuxSubEvent> = {
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

        relays.forEach(relay => (async () => {
            let r: Relay;
            try {
                r = await this.ensureRelay(relay);
            } catch (err) {
                handleEose();
                return;
            }
            let rfilters = filters;
            function subone() {
                let s = r.sub(rfilters, opts);
                s.on('event', (event: Event) => {
                    subListeners.event.forEach(cb => cb({ relay: r, event }));
                });
                s.on('eose', () => {
                    handleEose();
                });
                s.on('error', err => {
                    handleEose();
                });

                const ps = subs.get(relay);
                if (ps) {
                    r.off('disconnect', ps.disconnectl);
                    r.off('connect', ps.connectl);
                }

                const disconnectl = () => {
                    handleEose();
                };
                r.on('disconnect', disconnectl);
                const connectl = () => {
                    if (opts?.refilters) {
                        rfilters = opts.refilters(relay, rfilters);
                    }
                    subone();
                };
                r.on('connect', connectl);
                subs.set(relay, { relay: r, sub: s, connectl, disconnectl });
            }
            subone();

            let eosed = false;
            function handleEose() {
                if (eosed) return;
                eosed = true;
                if (eoseSent) return;
                eosesMissing--;
                if (eosesMissing === 0) {
                    clearTimeout(eoseTimeout);
                    subListeners.eose.forEach(cb => cb());
                    subListeners.eose = []; // 'eose' only happens once per sub, so stop listeners here
                }
            }
        })().catch(console.error));

        let greaterSub: MuxSub = {
            sub(filters, opts) {
                subs.forEach(s => s.sub.sub(filters, opts));
                return greaterSub;
            },
            unsub() {
                subs.forEach(s => {
                    s.sub.unsub();
                    if (s) {
                        s.relay.off('disconnect', s.disconnectl);
                        s.relay.off('connect', s.connectl);
                    }
                });
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
    ): Promise<MuxedEvent | null> {
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
    ): Promise<MuxedEvent[]> {
        return new Promise((resolve, reject) => {
            let events: MuxedEvent[] = [];
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
        let pubListeners: Map<string, ListenersContainer<MuxPubEvent>> = new Map();
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
