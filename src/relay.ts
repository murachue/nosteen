/* global WebSocket */

// based on nostr-tools@1.10.1

import { Event, Filter, matchFilters, validateEvent, verifySignature } from 'nostr-tools';

type RelayEvent = {
    connect: () => void | Promise<void>;
    disconnect: () => void | Promise<void>;
    error: (reason?: unknown) => void | Promise<void>;
    notice: (msg: string) => void | Promise<void>;
    auth: (challenge: string) => void | Promise<void>;
};
export type CountPayload = {
    count: number;
};
type SubEvent = {
    event: (event: Event) => void | Promise<void>;
    count: (payload: CountPayload) => void | Promise<void>;
    eose: () => void | Promise<void>;
    error: (err: unknown) => void | Promise<void>;  // TODO: what if REQ responded with NOTICE?
};
export type Relay = {
    url: string;
    status: number;
    connect: () => Promise<void>;
    close: () => void;
    sub: (filters: Filter[], opts?: SubscriptionOptions) => Sub;
    list: (filters: Filter[], opts?: SubscriptionOptions) => Promise<Event[]>;
    get: (filter: Filter, opts?: SubscriptionOptions) => Promise<Event | null>;
    count: (
        filters: Filter[],
        opts?: SubscriptionOptions
    ) => Promise<CountPayload | null>;
    publish: (event: Event) => Pub;
    auth: (event: Event) => Pub;
    off: <T extends keyof RelayEvent, U extends RelayEvent[T]>(
        event: T,
        listener: U
    ) => void;
    on: <T extends keyof RelayEvent, U extends RelayEvent[T]>(
        event: T,
        listener: U
    ) => void;
};
type PubEvent = {
    ok: (reason: string) => void;
    failed: (reason: unknown) => void;
};
export type Pub = {
    off: <T extends keyof PubEvent, U extends PubEvent[T]>(
        event: T,
        listener: U
    ) => void;
    on: <T extends keyof PubEvent, U extends PubEvent[T]>(
        event: T,
        listener: U
    ) => void;
    forget: () => void;
};
export type Sub = {
    sub: (filters: Filter[], opts?: SubscriptionOptions) => Sub;
    unsub: () => void;
    on: <T extends keyof SubEvent, U extends SubEvent[T]>(
        event: T,
        listener: U
    ) => void;
    off: <T extends keyof SubEvent, U extends SubEvent[T]>(
        event: T,
        listener: U
    ) => void;
};

export type SubscriptionOptions = {
    id?: string;
    verb?: 'REQ' | 'COUNT';
    skipVerification?: boolean;
};

const idgenerator = () => {
    let id = 0;
    const free: string[] = [];

    return {
        get: (): string => {
            const i = free.pop() ?? (id++).toString(36);
            return i;
        },
        put: (rid: string): void => {
            // check it is generated by us roughly
            // parseInt may return NaN, must test by if-true
            // parseInt stops parsing on first non-numeric, must test whole string is a number.
            if (/^[0-9A-Za-z]{1,5}$/.exec(rid) && parseInt(rid, 36) < id) {
                free.push(rid);
            }
        },
    };
};

const newListeners = (): { [TK in keyof RelayEvent]: RelayEvent[TK][] } => ({
    connect: [],
    disconnect: [],
    error: [],
    notice: [],
    auth: []
});

export function relayInit(
    url: string,
    options: {
        getTimeout?: number;
        listTimeout?: number;
        countTimeout?: number;
    } = {}
): Relay {
    let { listTimeout = 3000, getTimeout = 3000, countTimeout = 3000 } = options;

    let ws: WebSocket | undefined;
    let openSubs: { [id: string]: { filters: Filter[]; } & SubscriptionOptions; } = {};
    let listeners = newListeners();
    let subListeners: {
        [subid: string]: { [TK in keyof SubEvent]: SubEvent[TK][] };
    } = {};
    let pubListeners: {
        [eventid: string]: { [TK in keyof PubEvent]: PubEvent[TK][] };
    } = {};
    let idgen = idgenerator();

    function reset() {
        connectionPromise = undefined;
        openSubs = {};
        listeners = newListeners();
        subListeners = {};
        pubListeners = {};
        idgen = idgenerator();
    }

    let connectionPromise: Promise<void> | undefined;
    async function connectRelay(): Promise<void> {
        if (connectionPromise) return connectionPromise;
        connectionPromise = new Promise((resolve, reject) => {
            try {
                ws = new WebSocket(url);
            } catch (err) {
                listeners.error.forEach(cb => cb(err));
                return reject(err);
            }

            ws.onopen = () => {
                listeners.connect.forEach(cb => cb());
                resolve();
            };
            ws.onerror = (ev) => {
                reset();
                listeners.error.forEach(cb => cb(ev));
                reject();
            };
            ws.onclose = async () => {
                reset();
                listeners.disconnect.forEach(cb => cb());
            };

            const incomingMessageQueue: string[] = [];
            let handleNextInterval: ReturnType<typeof setInterval> | undefined;

            ws.onmessage = e => {
                incomingMessageQueue.push(e.data);
                if (!handleNextInterval) {
                    handleNextInterval = setInterval(handleNext, 0);
                }
            };

            function handleNext() {
                if (incomingMessageQueue.length === 0) {
                    clearInterval(handleNextInterval);
                    handleNextInterval = undefined;
                    return;
                }

                const json = incomingMessageQueue.shift();
                if (!json) return;

                try {
                    let data = JSON.parse(json);

                    // we won't do any checks against the data since all failures (i.e. invalid messages from relays)
                    // will naturally be caught by the encompassing try..catch block

                    switch (data[0]) {
                        case 'EVENT': {
                            let id = data[1];
                            let event = data[2];
                            if (
                                validateEvent(event) &&
                                openSubs[id] &&
                                (openSubs[id].skipVerification || verifySignature(event)) &&
                                matchFilters(openSubs[id].filters, event)
                            ) {
                                ; (subListeners[id]?.event || []).forEach(cb => cb(event));
                            }
                            return;
                        }
                        case 'COUNT':
                            let id = data[1];
                            let payload = data[2];
                            if (openSubs[id]) {
                                ; (subListeners[id]?.count || []).forEach(cb => cb(payload));
                            }
                            return;
                        case 'EOSE': {
                            let id = data[1];
                            if (id in subListeners) {
                                subListeners[id].eose.forEach(cb => cb());
                                subListeners[id].eose = []; // 'eose' only happens once per sub, so stop listeners here
                            }
                            return;
                        }
                        case 'OK': {
                            let id: string = data[1];
                            let ok: boolean = data[2];
                            let reason: string = data[3] || '';
                            if (id in pubListeners) {
                                if (ok) pubListeners[id].ok.forEach(cb => cb(reason));
                                else pubListeners[id].failed.forEach(cb => cb(reason));
                                delete pubListeners[id]; // 'ok' only happens once per pub, so stop listeners here
                            }
                            return;
                        }
                        case 'NOTICE':
                            let notice = data[1];
                            listeners.notice.forEach(cb => cb(notice));
                            return;
                        case 'AUTH': {
                            let challenge = data[1];
                            listeners.auth?.forEach(cb => cb(challenge));
                            return;
                        }
                    }
                } catch (err) {
                    return;
                }
            }
        });

        return connectionPromise;
    }

    function connected() {
        return ws?.readyState === WebSocket.OPEN;
    }

    async function connect(): Promise<void> {
        if (connected()) return; // ws already open
        await connectRelay();
    }

    async function trySend(params: [string, ...any], onerror: (err: unknown) => void | Promise<void>) {
        let msg = JSON.stringify(params);
        if (!connected()) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!connected()) {
                onerror(new Error("not connected"));
                return;
            }
        }
        try {
            ws!.send(msg);
        } catch (err) {
            console.log(err);
            onerror(err);
        }
    }

    const sub = (
        filters: Filter[],
        {
            verb = 'REQ',
            skipVerification = false,
            id = idgen.get()
        }: SubscriptionOptions = {}
    ): Sub => {
        let subid = id;

        openSubs[subid] = {
            id: subid,
            filters,
            skipVerification,
        };
        // get a ref to avoid overwriting by on() after unsub()
        // `sL[id] || {}` to keep on re-sub()
        const subListener = subListeners[subid] = subListeners[subid] || {
            event: [],
            count: [],
            eose: [],
            error: []
        };
        trySend([verb, subid, ...filters], err => {
            subListeners[subid].error.forEach(cb => cb(err));
            delete openSubs[subid];
            delete subListeners[subid];
            idgen.put(subid);
        });

        return {
            sub: (newFilters, newOpts = {}) =>
                sub(newFilters || filters, {
                    skipVerification: newOpts.skipVerification ?? skipVerification,
                    id: subid
                    // no verb.
                }),
            unsub: () => {
                const errlisteners = subListeners[subid].error; // keep before delete
                delete openSubs[subid];
                delete subListeners[subid];
                idgen.put(subid);
                trySend(['CLOSE', subid], err => {
                    errlisteners.forEach(cb => cb(err));
                });
            },
            on: <T extends keyof SubEvent, U extends SubEvent[T]>(
                type: T,
                cb: U
            ): void => {
                subListener[type].push(cb);
            },
            off: <T extends keyof SubEvent, U extends SubEvent[T]>(
                type: T,
                cb: U
            ): void => {
                let listeners = subListener;
                let idx = listeners[type].indexOf(cb);
                if (idx >= 0) listeners[type].splice(idx, 1);
            }
        };
    };

    function _publishEvent(event: Event, type: string): Pub {
        if (!event.id) throw new Error(`event ${event} has no id`);
        let id = event.id;

        trySend([type, event], err => {
            const listeners = pubListeners[id];
            if (!listeners) return;
            listeners.failed.forEach(cb => cb(err));
        });

        return {
            on: (event, listener) => {
                pubListeners[id] = pubListeners[id] || {
                    ok: [],
                    failed: []
                };
                pubListeners[id][event].push(listener);
            },
            off: (event, listener) => {
                let listeners = pubListeners[id];
                if (!listeners) return;
                let idx = listeners[event].indexOf(listener);
                if (idx >= 0) listeners[event].splice(idx, 1);
            },
            // for the case of a relay does not support NIP-20.
            forget: () => {
                delete pubListeners[id];
            }
        };
    }

    return {
        url,
        sub,
        on: <T extends keyof RelayEvent, U extends RelayEvent[T]>(
            type: T,
            cb: U
        ): void => {
            listeners[type].push(cb);
            if (type === 'connect' && ws?.readyState === 1) {
                // i would love to know why we need this
                ; (cb as () => void)();
            }
        },
        off: <T extends keyof RelayEvent, U extends RelayEvent[T]>(
            type: T,
            cb: U
        ): void => {
            let index = listeners[type].indexOf(cb);
            if (index !== -1) listeners[type].splice(index, 1);
        },
        list: (filters: Filter[], opts?: SubscriptionOptions): Promise<Event[]> =>
            new Promise((resolve, reject) => {
                const s = sub(filters, opts);
                let events: Event[] = [];
                let timeout = setTimeout(() => {
                    s.unsub();
                    resolve(events);
                }, listTimeout);
                s.on('eose', () => {
                    s.unsub();
                    clearTimeout(timeout);
                    resolve(events);
                });
                s.on('event', event => {
                    events.push(event);
                });
                s.on('error', err => {
                    clearTimeout(timeout);
                    reject(err);
                });
            }),
        get: (filter: Filter, opts?: SubscriptionOptions): Promise<Event | null> =>
            new Promise((resolve, reject) => {
                const s = sub([filter], opts);
                const timeout = setTimeout(() => {
                    s.unsub();
                    resolve(null);
                }, getTimeout);
                s.on('event', event => {
                    s.unsub();
                    clearTimeout(timeout);
                    resolve(event);
                });
                s.on('error', err => {
                    clearTimeout(timeout);
                    reject(err);
                });
            }),
        count: (filters: Filter[]): Promise<CountPayload | null> =>
            new Promise((resolve, reject) => {
                const s = sub(filters, { ...sub, verb: 'COUNT' });
                const timeout = setTimeout(() => {
                    s.unsub();
                    resolve(null);
                }, countTimeout);
                s.on('count', event => {
                    s.unsub();
                    clearTimeout(timeout);
                    resolve(event);
                });
                s.on('error', err => {
                    clearTimeout(timeout);
                    reject(err);
                });
            }),
        publish(event): Pub {
            return _publishEvent(event, 'EVENT');
        },
        auth(event): Pub {
            return _publishEvent(event, 'AUTH');
        },
        connect,
        close(): void {
            reset();
            if (ws?.readyState === WebSocket.OPEN) {
                ws.close();
            }
        },
        get status() {
            return ws?.readyState ?? WebSocket.CLOSED;
        }
    };
}
