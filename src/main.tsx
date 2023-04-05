import produce, { enableMapSet } from 'immer';
import { WritableDraft } from 'immer/dist/internal';
import { useImmerAtom } from 'jotai-immer';
import { useAtom } from 'jotai/react';
import { Event, verifyEvent } from 'nostr-mux';
import { Relay } from 'nostr-mux/dist/core/relay';
import React, { useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import ErrorPage from './routes/errorpage';
import Global from './routes/global';
import MainLayout from './routes/mainlayout';
import Preferences from './routes/preferences';
import Root from './routes/root';
import TabsView from './routes/tabsview';
import TestApp from './routes/test';
import state from './state';
import { Post } from './types';
import invariant from 'tiny-invariant';

enableMapSet();

// const mget = <T extends Map<K, V>, K, V>(map: T, key: K, def: () => V): V => {
//     const v = map.get(key);
//     if (v) { return v; }
//     const nv = def();
//     map.set(key, nv);
//     return nv;
// };
// const oget = <T, K extends keyof T, V extends NonNullable<T[K]>>(obj: T, key: K, def: () => V): V => {
//     const v = obj[key];
//     if (v) { return v; }
//     const nv = def();
//     obj[key] = nv;
//     return nv;
// };

const App = () => {
    const [prefrelays] = useAtom(state.preferences.relays);
    const [relays, setRelays] = useImmerAtom(state.relays);
    const [mux] = useAtom(state.relaymux);
    const [allevents, setAllevents] = useAtom(state.allevents);
    const allevref = useRef(allevents);
    // called twice??
    useEffect(useMemo(() => {
        const sid = mux.subscribe({
            enableBuffer: { flushInterval: 50 },
            filters: [{ /* authors: ["eeef"] */ limit: 10 }],
            onEvent: async receives => {
                // XXX: produce() don't support async??
                //      [Immer] produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '[object Promise]'
                //      try best.

                // setAllevents(async evs => await produce(evs, async draftorg => {
                //     const draft = await draftorg;
                //     // XXX: it infers Map<s,P>|Map<s,WD<P>> that could not be mixed value...
                //     const byevid: Map<string, Post | WritableDraft<Post>> = draft.byEventId;
                //     for (const { received: { event }, relay } of receives) {
                //         if (event.kind === 5) {
                //             // delete event
                //             for (const tag of event.tags) {
                //                 if (tag[0] !== "e") {
                //                     // !? ignore
                //                     continue;
                //                 }
                //                 const evid = tag[1];
                //                 // const ae = mget(byevid, evid, () => ({
                //                 //     event: null,
                //                 //     deleteevent: null,
                //                 //     repostevent: null,
                //                 // }));
                //                 // const de = oget(ae, "deleteevent", () => ({
                //                 //     event,
                //                 //     receivedfrom: new Set(),
                //                 // }));
                //                 const post = byevid.get(evid) ?? {
                //                     id: evid,
                //                     event: null,
                //                     deleteevent: null,
                //                     repostevent: null,
                //                 };
                //                 byevid.set(evid, post);

                //                 const de = post.deleteevent = post.deleteevent ?? {
                //                     event,
                //                     receivedfrom: new Set(),
                //                 };
                //                 de.event = event;

                //                 de.receivedfrom.add(relay);
                //             }
                //         } else {
                //             const post = byevid.get(event.id) ?? {
                //                 id: event.id,
                //                 event: {
                //                     event,
                //                     receivedfrom: new Set(),
                //                 },
                //                 deleteevent: null,
                //                 repostevent: null,
                //             };
                //             byevid.set(event.id, post);

                //             // TODO: coalesce event? (some relay drop many tags) -> dropped by invalid sig
                //             if (!post.event) {
                //                 // ignoring invalid event (should record receivedfrom?)
                //                 const r = await verifyEvent(event);
                //                 if (typeof r === "string") {
                //                     // verification error
                //                 } else {
                //                     post.event = post.event ?? {
                //                         event,
                //                         receivedfrom: new Set(),
                //                     };
                //                 }
                //             }
                //             if (post.event) {
                //                 post.event.receivedfrom.add(relay);
                //             }
                //         }
                //     }
                // }));

                const byeid = allevref.current.byEventId;
                type OpEv = { type: "event"; event: Event; relay: Relay; };
                type OpDel = { type: "delete"; event: Event; relay: Relay; id: string; };

                const ops: (OpEv | OpDel)[] = [];
                for (const { received: { event }, relay } of receives) {
                    if (event.kind === 5) {
                        // delete
                        const dels: OpDel[] = [];
                        for (const tag of event.tags) {
                            if (tag[0] !== "e") {
                                // !? ignore
                                continue;
                            }
                            const evid = tag[1];
                            if (!byeid.has(evid)) {
                                dels.push({ type: "delete", event, relay, id: evid });
                            }
                        }
                        if (0 < dels.length) {
                            const r = await verifyEvent(event);
                            if (typeof r === "string") {
                                // TODO: invalid sig!?
                            } else {
                                ops.push(...dels);
                                // ops.push({ type: "event", event, relay });
                            }
                        }
                    } else {
                        // others
                        if (!byeid.has(event.id)) {
                            const r = await verifyEvent(event);
                            if (typeof r === "string") {
                                // TODO: invalid sig!?
                            } else {
                                ops.push({ type: "event", event, relay });
                            }
                        }
                    }
                }
                setAllevents(produce(draft => {
                    // XXX: it infers Map<s,P>|Map<s,WD<P>> that could not be mixed value...
                    const byevid: Map<string, Post | WritableDraft<Post>> = draft.byEventId;
                    for (const op of ops) {
                        switch (op.type) {
                            case 'delete': {
                                const evid = op.id;
                                const post = byevid.get(evid) ?? {
                                    id: evid,
                                    event: null,
                                    deleteevent: null,
                                    repostevent: null,
                                };
                                byevid.set(evid, post);

                                const de = post.deleteevent = post.deleteevent ?? {
                                    event: op.event,
                                    receivedfrom: new Set(),
                                };
                                de.event = op.event;

                                de.receivedfrom.add(op.relay);

                                break;
                            }
                            case 'event': {
                                const post = byevid.get(op.event.id) ?? {
                                    id: op.event.id,
                                    event: {
                                        event: op.event,
                                        receivedfrom: new Set(),
                                    },
                                    deleteevent: null,
                                    repostevent: null,
                                };
                                byevid.set(op.event.id, post);

                                // coalesce event? (some relay drop many tags) -> dropped by invalid sig
                                post.event = post.event ?? {
                                    event: op.event,
                                    receivedfrom: new Set(),
                                };
                                post.event.event = op.event;

                                post.event.receivedfrom.add(op.relay);

                                if (post.event.event.kind === 1) {
                                    const i = (function <T>(arr: T[], comp: (x: T) => boolean) {
                                        let left = 0;
                                        let right = arr.length - 1;
                                        let mid = Math.floor((left + right) / 2);

                                        while (left <= right) {
                                            if (comp(arr[mid])) {
                                                right = mid - 1;
                                            } else {
                                                left = mid + 1;
                                            }
                                            mid = Math.floor((left + right) / 2);
                                        }
                                        return mid;
                                    })(draft.byCreatedAt, x => op.event.created_at < x.event!.event.created_at);
                                    draft.byCreatedAt.splice(i, 0, post);
                                }

                                break;
                            }
                        }
                    }
                }));
            },
        });
        return () => {
            mux.unSubscribe(sid);
        };
    }, []), []);
    useEffect(() => {
        setRelays(draft => {
            const pre = new Map(draft); // taking a (shallow) copy is important
            const cur = new Map(prefrelays.map(r => [r.url, r]));

            // added
            for (const [url, relopt] of cur.entries()) {
                if (pre.has(url)) continue;

                const relay = new Relay(relopt.url, { read: relopt.read, write: relopt.write });
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
