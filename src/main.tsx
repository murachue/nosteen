import { enableMapSet } from 'immer';
import { useImmerAtom } from 'jotai-immer';
import { useAtom } from 'jotai/react';
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
import { AnEvent } from './types';

enableMapSet();

const App = () => {
    const [prefrelays] = useAtom(state.preferences.relays);
    const [relays, setRelays] = useImmerAtom(state.relays);
    const [mux] = useAtom(state.relaymux);
    const [allevents, setAllevents] = useImmerAtom(state.allevents);
    useEffect(() => {
        setRelays(relays => {
            for (const relopt of prefrelays) {
                const relay = new Relay(relopt.url, { read: relopt.read, write: relopt.write });
                relays.set(relopt.url, relay);
                mux.addRelay(relay);
            }
            mux.subscribe({
                filters: [{ authors: ["eeef"] }],
                onEvent: es => {
                    setAllevents(draft => {
                        for (const e of es) {
                            let ae: AnEvent = draft.byEventId.get(e.received.event.id);
                            if (!ae) {
                                ae = {
                                    event: {
                                        event: e.received.event,
                                        receivedfrom: new Set(),
                                    },
                                    deleteevent: null,
                                    repostevent: null,
                                };
                                draft.byEventId.set(e.received.event.id, ae);
                            }
                            ae.event.receivedfrom.add(e.relay);
                        }
                    });
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
