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
import TabsView from './routes/tabsview';
import TestApp from './routes/test';
import state from './state';
import { enableMapSet } from 'immer';

enableMapSet();

const App = () => {
    const [prefrelays] = useAtom(state.preferences.relays);
    const [relays, setRelays] = useImmerAtom(state.relays);
    const [mux] = useAtom(state.relaymux);
    useEffect(() => {
        setRelays(relays => {
            for (const relopt of prefrelays) {
                const relay = new Relay(relopt.url, { read: relopt.read, write: relopt.write });
                relays.set(relopt.url, relay);
                mux.addRelay(relay);
            }
        });
    });

    return <HashRouter>
        <Routes>
            <Route element={<Global />} errorElement={<ErrorPage />}>
                <Route element={<MainLayout />}>
                    <Route path="/:name?" element={<TabsView />} />
                    <Route path="test" element={<TestApp />} />
                    <Route path="/preferences" element={<Preferences />} />
                </Route>
            </Route>
        </Routes>
    </HashRouter>;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
