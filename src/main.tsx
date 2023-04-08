import produce, { enableMapSet } from 'immer';
import { useImmerAtom } from 'jotai-immer';
import { useAtom } from 'jotai/react';
import { Event, Filter, Relay, SubscriptionOptions, verifyEvent } from 'nostr-mux';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import invariant from 'tiny-invariant';
import './index.css';
import ErrorPage from './routes/errorpage';
import Global from './routes/global';
import MainLayout from './routes/mainlayout';
import Preferences from './routes/preferences';
import Root from './routes/root';
import TabsView from './routes/tabsview';
import TestApp from './routes/test';
import state from './state';

enableMapSet();

const Kinds = {
    post: 1,
    dm: 4,
    delete: 5,
    repost: 6,
    reaction: 7,
};

const bsearchi = function <T>(arr: T[], comp: (x: T) => boolean): number {
    let left = 0;
    let right = arr.length;
    let mid: number;

    while (left < right) {
        mid = Math.floor((left + right) / 2);
        if (comp(arr[mid])) {
            right = mid;
        } else {
            left = mid + 1;
        }
    }

    // arr.length must be 0 or greater, left<right never be true on first, sets mid.
    return mid!;
};

const App = () => {
    const [prefrelays] = useAtom(state.preferences.relays);
    const [prefaccount] = useAtom(state.preferences.account);
    const [relays, setRelays] = useImmerAtom(state.relays);
    const [mux] = useAtom(state.relaymux);
    const [posts, setPosts] = useAtom(state.posts);
    const [tabs] = useAtom(state.tabs);
    const [mycontacts, setMycontacts] = useState<Event | null>(null);
    type Sub = {
        name: string;
        filters: [Filter, ...Filter[]];
        sid: string;
    };

    const [subs, setSubs] = useState(new Map<string, Sub>());
    const postsRef = useRef(posts);
    // TODO: unsub on unload, but useEffect.return is overkill
    useEffect(() => {
        type SetSub = {
            op: "set";
            sub: Sub;
        };
        type DeleteSub = {
            op: "delete";
            name: string;
        };
        const ops: (SetSub | DeleteSub)[] = [];
        for (const tab of tabs) {
            const sub = subs.get(tab.name);
            const tabfilt = ((): SubscriptionOptions["filters"] | null => {
                if (tab.filter === "recent") {
                    if (sub?.filters[0]?.authors?.[0] === prefaccount?.pubkey) {
                        return sub?.filters || null; // return as is, or null on unlogin
                    } else if (!prefaccount) {
                        return null;
                    } else {
                        return [
                            // my events
                            {
                                authors: [prefaccount.pubkey],
                                kinds: [Kinds.post, Kinds.delete, Kinds.repost, Kinds.reaction],
                                limit: 100,
                            },
                            // following events but we don't need their reactions
                            ...(() => {
                                if (!mycontacts) {
                                    return [];
                                }
                                const pks = mycontacts.tags.filter(t => t[0] === "p").map(t => t[1]);
                                if (pks.length === 0) {
                                    return [];
                                }
                                return [{
                                    authors: pks,
                                    kinds: [Kinds.post, Kinds.delete, Kinds.repost],
                                    limit: 100,
                                }];
                            })(),
                        ];
                    }
                } else if (tab.filter === "reply") {
                    if (sub?.filters[0]?.["#p"]?.[0] === prefaccount?.pubkey) {
                        return sub?.filters || null; // return as is, or null on unlogin
                    } else if (!prefaccount) {
                        return null;
                    } else {
                        // tagged me
                        return [
                            {
                                "#p": [prefaccount.pubkey],
                                kinds: [Kinds.post, Kinds.delete, Kinds.repost],
                                limit: 100,
                            },
                        ];
                    }
                } else if (tab.filter === "dm") {
                    if (sub?.filters[0]?.authors?.[0] === prefaccount?.pubkey) {
                        return sub?.filters || null; // return as is, or null on unlogin
                    } else if (!prefaccount) {
                        return null;
                    } else {
                        // dm from me and to me
                        return [
                            {
                                authors: [prefaccount.pubkey],
                                kinds: [Kinds.dm],
                                limit: 100,
                            },
                            {
                                "#p": [prefaccount.pubkey],
                                kinds: [Kinds.dm],
                                limit: 100,
                            },
                        ];
                    }
                } else if (tab.filter === "favs") {
                    if (sub?.filters[0]?.authors?.[0] === prefaccount?.pubkey) {
                        return sub?.filters || null; // return as is, or null on unlogin
                    } else if (!prefaccount) {
                        return null;
                    } else {
                        // tagged me
                        return [
                            {
                                authors: [prefaccount.pubkey],
                                kinds: [Kinds.reaction],
                                limit: 100,
                            },
                        ];
                    }
                } else {
                    return tab.filter.length === 0
                        ? null
                        : ((tab.filter satisfies Filter[]) as [Filter, ...Filter[]]);
                }
            })();
            if (!sub || sub.filters !== tabfilt) {
                // removed or modified
                if (sub) {
                    mux.unSubscribe(sub.sid);
                    ops.push({ op: "delete", name: sub.name });
                }
                // added or modified
                if (tabfilt) {
                    // TODO: we should intro global async verify/add queue?
                    const sid = mux.subscribe({
                        filters: tabfilt,
                        enableBuffer: { flushInterval: 50 },
                        onEvent: async receives => {
                            // XXX: produce() don't support async??
                            //      [Immer] produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '[object Promise]'
                            //      try best. (ref'ing old events may cause extra verify which is sad but not fatal.)
                            // TODO: repost/reaction target fetching
                            // TODO: we may can use batch schnorr verify (if library supports) but bothered if some fail.
                            const allevents = postsRef.current.allevents;
                            type OpEv = { type: "event"; event: Event; relay: Relay; };
                            type OpDel = { type: "delete"; event: Event; relay: Relay; id: string; };
                            const okevs = new Set<string>(); // don't taint allevents till updating setPosts
                            const ops: (OpEv | OpDel)[] = [];
                            for (const { received: { event }, relay } of receives) {
                                if (okevs.has(event.id) || allevents.has(event.id)) {
                                    // we already know valid that event...
                                    // XXX: we are trusting that relay also sends valid event!! (instead of drop/ignore on first see)
                                    ops.push({ type: "event", event, relay });
                                    continue;
                                }

                                if (event.kind === 5) {
                                    // delete
                                    const dels: OpDel[] = [];
                                    for (const tag of event.tags) {
                                        if (tag[0] !== "e") {
                                            // !? ignore
                                            continue;
                                        }
                                        const evid = tag[1];
                                        if (!allevents.has(evid)) {
                                            dels.push({ type: "delete", event, relay, id: evid });
                                        }
                                    }
                                    if (0 < dels.length) {
                                        const r = await verifyEvent(event);
                                        if (typeof r === "string") {
                                            // TODO: invalid sig!?
                                        } else {
                                            ops.push(...dels);
                                            ops.push({ type: "event", event, relay });
                                            okevs.add(event.id);
                                        }
                                    }
                                } else {
                                    // others
                                    if (!allevents.has(event.id)) {
                                        const r = await verifyEvent(event);
                                        if (typeof r === "string") {
                                            // TODO: invalid sig!?
                                        } else {
                                            ops.push({ type: "event", event, relay });
                                            okevs.add(event.id);
                                        }
                                    }
                                }
                            }

                            // then synchronous update
                            setPosts(produce(draft => {
                                const all = draft.allposts;
                                const tap = draft.bytab.get(tab.name);
                                invariant(tap, `no posts.bytab for ${tab.name}`);
                                for (const op of ops) {
                                    switch (op.type) {
                                        case 'delete': {
                                            const evid = op.id;
                                            const post = all.get(evid) ?? {
                                                id: evid,
                                                event: null,
                                                deleteevent: null,
                                                reposttargetevent: null,
                                                myreactionevent: null,
                                                hasread: false,
                                            };
                                            all.set(evid, post);

                                            // FIXME: we are trusting this delete
                                            post.deleteevent = post.deleteevent ?? {
                                                event: op.event,
                                                receivedfrom: new Set(),
                                            };

                                            post.deleteevent.receivedfrom.add(op.relay);

                                            if (post.event) {
                                                // update bytab to make component update
                                                const cat = post.event.event.created_at;
                                                for (
                                                    let i = bsearchi(tap, p => cat <= p.event!.event.created_at);
                                                    tap[i] && tap[i].event!.event.created_at === cat;
                                                    i++
                                                ) {
                                                    if (tap[i].event!.event.id === evid) {
                                                        tap[i] = post;
                                                        break;
                                                    }
                                                }
                                            }

                                            break;
                                        }
                                        case 'event': {
                                            const ev = op.event;

                                            draft.allevents.set(ev.id, ev);

                                            const evid = op.event.id;
                                            const post = all.get(evid) ?? {
                                                id: evid,
                                                event: null,
                                                deleteevent: null,
                                                reposttargetevent: null,
                                                myreactionevent: null,
                                                hasread: false,
                                            };
                                            all.set(evid, post);

                                            if (ev.kind === Kinds.reaction)
                                                post.event = post.event ?? {
                                                    event: op.event,
                                                    receivedfrom: new Set(),
                                                };

                                            post.event.receivedfrom.add(op.relay);

                                            if (ev.kind === Kinds.delete) {
                                                // nothing to do, even adding or modifying (already done on op:"delete")
                                            } else if (ev.kind === Kinds.reaction) {
                                                // required to
                                            } else {
                                                const i = bsearchi(draft.byCreatedAt, x => op.event.created_at < x.event!.event.created_at);
                                                draft.byCreatedAt.splice(i, 0, post);
                                            }

                                            break;
                                        }
                                    }
                                }
                            }));
                            setTabevents(produce(draft => {
                                const t = draft.get(tab.name);
                                t?.byEventId;
                                t?.byCreatedAt;
                            }));
                        },
                    });
                    ops.push({
                        op: "set",
                        sub: {
                            name: tab.name,
                            filters: tabfilt,
                            sid,
                        },
                    });
                }
            }
        }
        if (0 < ops.length) {
            setSubs(produce(draft => {
                for (const op of ops) {
                    switch (op.op) {
                        case 'set': {
                            draft.set(op.sub.name, op.sub);
                            break;
                        }
                        case 'delete': {
                            draft.delete(op.name);
                            break;
                        }
                    }
                }
            }));
        }

        // return () => {
        //     ops
        //         .filter((op): op is SetSub => op.op === "set")
        //         .forEach(op => mux.unSubscribe(op.sub.sid));
        // };
    }, [tabs, prefaccount, mycontacts]);
    useEffect(() => {
        setRelays(draft => {
            const pre = new Map(draft); // taking a (shallow) copy is important
            const cur = new Map(prefrelays.map(r => [r.url, r]));

            // added
            for (const [url, relopt] of cur.entries()) {
                if (pre.has(url)) continue;

                const relay = new Relay(relopt.url, { read: relopt.read, write: relopt.write, watchDogInterval: 3600000 });
                draft.set(relopt.url, relay);
                mux.addRelay(relay);
            }

            // removed
            for (const url of pre.keys()) {
                if (cur.has(url)) continue;

                mux.removeRelay(url);
                draft.delete(url);
            }
        });
    }, [prefrelays]);

    return <HashRouter>
        <Routes>
            <Route element={<Global />} errorElement={<ErrorPage />}>
                <Route path="/" element={<Root />} />
                <Route element={<MainLayout />}>
                    <Route path="/tab/:name?" element={<TabsView />} />
                    <Route path="test" element={<TestApp />} />
                </Route>
                <Route path="/preferences" element={<Preferences />} />
            </Route>
        </Routes>
    </HashRouter>;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
