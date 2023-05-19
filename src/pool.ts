// based on nostr-tools@1.10.1
// nostr-tools's SimplePool does not have reconnect/resub/resend. (nostr-mux have though)
// also SimplePool have redundant "seenOn"... we should re-(/de-)impl that.

import { Event, Filter, utils } from 'nostr-tools';
import { Relay, Sub, SubscriptionOptions, relayInit } from './relay';
import { getmk } from './util';

// reconnecting and stats wrapper.
export class RelayWrap {
    /* readonly */ relay: Relay;
    /* readonly */ wantonline = false;
    private dead = false;
    /* readonly */ ndied = 0;
    /* readonly */ nfail = 0;
    /* readonly */ disconnectedat: number | undefined;
    /* readonly */ connectedat: number | undefined;
    /* readonly */ reconnectat: number | undefined;
    /* readonly */ reconnecttimer: ReturnType<typeof setTimeout> | undefined;

    constructor(...args: Parameters<typeof relayInit>) {
        this.relay = relayInit(...args);
        this.relay.on("disconnect", () => {
            this.died();
        });
        this.relay.on("connect", () => {
            console.debug(`${new Date().toISOString()} connected ${this.ndied} ${this.nfail} ${this.relay.url}`);
            this.connectedat = Date.now();
            this.disconnectedat = undefined;
            this.nfail = 0;
            this.unsched();
        });
        this.relay.on("error", () => {
            // error then disconnect is called...?
            this.died();
        });
    }

    close() {
        if (!this.wantonline) return;
        this.forget();
        this.relay.close();  // for connecting
    }

    private forget() {
        if (!this.wantonline) return;
        this.wantonline = false;
        this.unsched();  // for reconnecting
    }

    wantweak() {
        this.want()?.catch(e => console.error(e));
    }

    async want() {
        if (this.wantonline) return;
        this.wantonline = true;
        this.ndied = 0;
        if (this.reconnecttimer !== undefined) {
            // do nothing on waiting for reconnect (listener.connected may called on reconnect)
            return undefined;
        }
        return await this.must();
    }

    async must() {
        if (!this.wantonline) {
            this.wantonline = true;
            this.ndied = 0;
        }
        this.unsched();
        this.dead = false;
        console.debug(`${new Date().toISOString()} connecting ${this.ndied} ${this.nfail} ${this.relay.url}`);
        return await this.relay.connect();  // reconnection is handled on "error" handler.
    }

    private died() {
        // prepared for twice: error=>disconnect
        if (this.dead) return;
        this.dead = true;
        console.debug(`${new Date().toISOString()} died ${this.ndied} ${this.nfail} ${this.relay.url}`);
        this.ndied++;
        this.disconnectedat = Date.now();
        if (!this.wantonline) return;
        this.nfail++;
        this.sched();
    }

    private sched() {
        this.unsched();
        const t = 1000 * (2 ** this.nfail);
        this.reconnecttimer = setTimeout(() => this.must(), t);
        this.reconnectat = Date.now() + t;
    }

    private unsched() {
        if (this.reconnecttimer !== undefined) return;
        clearTimeout(this.reconnecttimer);
        this.reconnecttimer = undefined;
        this.reconnectat = undefined;
    }
}

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
    health: (event: { relay: Relay; event: 'connected' | 'disconnected'; reason?: unknown; }) => void | Promise<void>;
};

type MuxSubEvent = {
    event: (receives: MuxedEvent[]) => void | Promise<void>;
    error: (failure: MuxedError) => void | Promise<void>;
    eose: () => void | Promise<void>;
};
export type MuxSubscriptionOptions = SubscriptionOptions & {
    refilters?: (relay: string, filter: Filter[]) => Filter[];
};
export type MuxSub = {
    sub: (relays: string[], filters: Filter[] | null, opts?: MuxSubscriptionOptions) => MuxSub;
    unsub: () => void;
    on: ListenerModifier<MuxSubEvent>;
    off: ListenerModifier<MuxSubEvent>;
};

type MuxPubEvent = {
    ok: (receives: MuxedOk[]) => void;
    failed: (failure: MuxedError) => void;
    forget: () => void;
};
export type MuxPub = {
    on: ListenerModifier<MuxPubEvent>;
    off: ListenerModifier<MuxPubEvent>;
    forget: () => void;
};

export class MuxPool {
    private _conn: { [url: string]: RelayWrap; };
    private listeners: ListenersContainer<MuxEvent> = {
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
            // TODO: also unsub or forget pub on close for that relay!
        });
    }

    getrelay(url: string): RelayWrap {
        const nm = utils.normalizeURL(url);

        if (!this._conn[nm]) {
            const r = new RelayWrap(nm, {
                getTimeout: this.getTimeout * 0.9,
                listTimeout: this.getTimeout * 0.9
            });
            r.relay.on('connect', () => this.listeners.health.forEach(cb => cb({ relay: r.relay, event: 'connected' })));
            r.relay.on('error', reason => this.listeners.health.forEach(cb => cb({ relay: r.relay, event: 'disconnected', reason })));
            r.relay.on('disconnect', () => this.listeners.health.forEach(cb => cb({ relay: r.relay, event: 'disconnected' })));
            this._conn[nm] = r;
        }

        return this._conn[nm];
    }

    async ensureRelay(url: string): Promise<RelayWrap> {
        const relay = this.getrelay(url);
        await relay.must();
        return relay;
    }

    on: ListenerModifier<MuxEvent> = (event, listener) => {
        this.listeners[event].push(listener);
    };
    off: ListenerModifier<MuxEvent> = (event, listener) => {
        let idx = this.listeners[event].indexOf(listener);
        if (idx >= 0) this.listeners[event].splice(idx, 1);
    };

    sub(relays: string[], filters: Filter[], opts?: MuxSubscriptionOptions): MuxSub {
        // XXX: this subs is complicated...
        const subs = new Map<string, {
            relay: Relay;
            sub: Sub;
            connectl: () => void | Promise<void>;
        }>();
        let lastfilters = filters;
        const subListeners: ListenersContainer<MuxSubEvent> = {
            event: [],
            error: [],
            eose: [],
        };
        // muxed eose. XXX: not support on new relay of resubs.
        let eosesMissing = relays.length;
        let eoseSent = false;
        // this also treats on relays==[]... HACK.
        const eoseTimeout = setTimeout(() => {
            eoseSent = true;
            subListeners.eose.forEach(cb => cb());
            subListeners.eose = []; // 'eose' only happens once per sub, so stop listeners here
        }, this.eoseSubTimeout);
        // async headache.
        let killed = false;

        // mixed between relays...
        const buffered = (({ onEvent, onEose, spongems = 100 }: {
            onEvent: (receives: MuxedEvent[]) => void;
            onEose: () => void;
            spongems?: number;
        }): {
            onEvent: (receive: MuxedEvent) => void;
            onEose: () => void;
        } => {
            if (spongems <= 0) {
                return { onEvent: (ev: MuxedEvent) => onEvent([ev]), onEose };
            }
            const evbuf: MuxedEvent[] = [];
            let timeout: ReturnType<typeof setTimeout> | undefined;
            return {
                onEvent: (ev: MuxedEvent) => {
                    evbuf.push(ev);
                    if (timeout === undefined) {
                        timeout = setTimeout(() => {
                            timeout = undefined;
                            onEvent(evbuf);
                            evbuf.splice(0);
                        }, spongems);
                    }
                },
                onEose: () => {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = undefined;
                        onEvent(evbuf);
                        evbuf.splice(0);
                    }
                    onEose();
                }
            };
        })({
            onEvent: (receives: MuxedEvent[]) => subListeners.event.forEach(cb => cb(receives)),
            onEose: () => {
                if (eoseSent) return;
                eosesMissing--;
                if (eosesMissing === 0) {
                    clearTimeout(eoseTimeout);
                    subListeners.eose.forEach(cb => cb());
                    subListeners.eose = []; // 'eose' only happens once per sub, so stop listeners here
                }
            },
        });

        const add = (urelay: string, initial: boolean) => (async () => {
            if (killed) return;

            const relay = utils.normalizeURL(urelay);
            let eosed = false;
            function handleEose() {
                if (eosed) return;
                eosed = true;
                buffered.onEose();
            }
            const r = this.getrelay(relay);
            // this will be also called on already connected.
            const connectl = () => {
                if (killed)
                    return;

                const pps = subs.get(relay);
                const ft = pps && opts?.refilters?.(relay, lastfilters) || lastfilters;

                let s = r.relay.sub(ft, opts);
                s.on('event', (event: Event) => {
                    buffered.onEvent({ relay: r.relay, event });
                });
                s.on('eose', () => {
                    if (initial) handleEose();
                });
                s.on('error', err => {
                    if (initial) handleEose();
                });
                const ps = getmk(subs, relay, () => ({ relay: r.relay, sub: s, connectl }));
                ps.sub = s;
            };
            r.relay.on("connect", connectl);
            r.wantweak();
        })().catch(console.error);
        relays.forEach(url => add(url, true));

        let greaterSub: MuxSub = {
            sub(relays, filters, opts) {
                if (killed) {
                    throw new Error(`sub already killed: ${JSON.stringify(lastfilters)}`);
                }
                if (filters) {
                    // be prepared to add() use new filters.
                    lastfilters = filters;
                }

                for (const [url, s] of subs.entries()) {
                    if (relays.includes(url)) continue;
                    // removed
                    s.sub.unsub();
                    s.relay.off('connect', s.connectl);
                }

                for (const url of relays) {
                    const s = subs.get(url);
                    if (s) {
                        if (filters) {
                            s.sub.sub(lastfilters, opts);
                        }
                    } else {
                        // added
                        add(url, false);
                    }
                }

                return greaterSub;
            },
            unsub() {
                killed = true;
                subs.forEach(s => {
                    s.sub.unsub();
                    s.relay.off('connect', s.connectl);
                });
            },
            on(event, listener) {
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
                resolve(receive[0]);
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
                events.push(...receive);
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

        relays.forEach(relay => {
            const plns: ListenersContainer<MuxPubEvent> = { ok: [], failed: [], forget: [] };
            pubListeners.set(relay, plns);
            (async () => {
                try {
                    const r = await this.ensureRelay(relay);
                    const pub = r.relay.publish(event);
                    let unlinker: (() => void) | undefined;  // hacky...
                    const okhandler = (reason: string): void => {
                        const listeners = pubListeners.get(relay);
                        if (listeners) {
                            listeners.ok.forEach(cb => cb([{ relay: r.relay, reason }]));
                            pubListeners.delete(relay);
                        }
                        unlinker?.();
                    };
                    const failedhandler = (reason: unknown): void => {
                        const listeners = pubListeners.get(relay);
                        if (listeners) {
                            listeners.failed.forEach(cb => cb({ relay, reason }));
                            pubListeners.delete(relay);
                        }
                        unlinker?.();
                    };
                    unlinker = () => {
                        pub.off('ok', okhandler);
                        pub.off('failed', failedhandler);

                        const ls = plns.forget;
                        let idx = ls.indexOf(unlinker!);
                        if (idx >= 0) ls.splice(idx, 1);
                    };
                    pub.on('ok', okhandler);
                    pub.on('failed', failedhandler);
                    plns.forget.push(unlinker);
                } catch (reason) {
                    pubListeners.forEach(lns => lns.failed.forEach(cb => cb({ relay, reason })));
                }
            })().catch(console.error);
        });

        return {
            on(event, listener) {
                // XXX: on()'ed after complete will not be invoked.
                pubListeners.forEach(lns => lns[event].push(listener));
            },
            off(event, listener) {
                pubListeners.forEach(lns => {
                    const ls = lns[event];
                    let idx = ls.indexOf(listener);
                    if (idx >= 0) ls.splice(idx, 1);
                });
            },
            forget() {
                pubListeners.forEach(lns => lns.forget.forEach(cb => cb()));
                pubListeners.clear();
            }
        };
    }
}
