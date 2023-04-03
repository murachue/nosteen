import produce, { enableMapSet } from 'immer';
import { WritableDraft } from 'immer/dist/internal';
import { useImmerAtom } from 'jotai-immer';
import { useAtom } from 'jotai/react';
import { verifyEvent } from 'nostr-mux';
import { Relay } from 'nostr-mux/dist/core/relay';
import React, { useEffect } from 'react';
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
    useEffect(() => {
        setRelays(relays => {
            for (const relopt of prefrelays) {
                const relay = new Relay(relopt.url, { read: relopt.read, write: relopt.write });
                relays.set(relopt.url, relay);
                mux.addRelay(relay);
            }
            mux.subscribe({
                enableBuffer: { flushInterval: 50 },
                filters: [{ /* authors: ["eeef"] */ }],
                // XXX: umm... setXxx with produce seems does not support async.
                //      (it may hard that it intros setXxx depend queueing...)
                //      async-ity is only in verifyEvent, so we ???
                onEvent: async receives => {
                    await setAllevents(async evs => await produce(evs, async draftorg => {
                        const draft = await draftorg;
                        // XXX: it infers Map<s,P>|Map<s,WD<P>> that could not be mixed value...
                        const byevid: Map<string, Post | WritableDraft<Post>> = draft.byEventId;
                        for (const { received: { event }, relay } of receives) {
                            if (event.kind === 5) {
                                // delete event
                                for (const tag of event.tags) {
                                    if (tag[0] !== "e") {
                                        // !? ignore
                                        continue;
                                    }
                                    const evid = tag[1];
                                    // const ae = mget(byevid, evid, () => ({
                                    //     event: null,
                                    //     deleteevent: null,
                                    //     repostevent: null,
                                    // }));
                                    // const de = oget(ae, "deleteevent", () => ({
                                    //     event,
                                    //     receivedfrom: new Set(),
                                    // }));
                                    const post = byevid.get(evid) ?? {
                                        id: evid,
                                        event: null,
                                        deleteevent: null,
                                        repostevent: null,
                                    };
                                    byevid.set(evid, post);

                                    const de = post.deleteevent = post.deleteevent ?? {
                                        event,
                                        receivedfrom: new Set(),
                                    };
                                    de.event = event;

                                    de.receivedfrom.add(relay);
                                }
                            } else {
                                const post = byevid.get(event.id) ?? {
                                    id: event.id,
                                    event: {
                                        event,
                                        receivedfrom: new Set(),
                                    },
                                    deleteevent: null,
                                    repostevent: null,
                                };
                                byevid.set(event.id, post);

                                // TODO: coalesce event? (some relay drop many tags) -> dropped by invalid sig
                                if (!post.event) {
                                    // ignoring invalid event (should record receivedfrom?)
                                    const r = await verifyEvent(event);
                                    if (typeof r === "string") {
                                        // verification error
                                    } else {
                                        post.event = post.event ?? {
                                            event,
                                            receivedfrom: new Set(),
                                        };
                                    }
                                }
                                if (post.event) {
                                    post.event.receivedfrom.add(relay);
                                }
                            }
                        }
                    }));
                },
            });
        });
    }, []);

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
