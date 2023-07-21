import { Analytics } from '@vercel/analytics/react';
import { enableMapSet } from 'immer';
import { useAtom } from 'jotai/react';
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import GA from './components/ga';
import './index.css';
import { NostrWorkerProvider, useNostrWorker } from './nostrworker';
import About from './routes/about';
import ErrorPage from './routes/errorpage';
import Global from './routes/global';
import Preferences from './routes/preferences';
import Profile from './routes/profile';
import Root from './routes/root';
import TabsView from './routes/tabsview';
import state from './state';
import { DeletableEvent, FilledFilters } from './types';

enableMapSet();

const App = () => {
    const [prefrelays] = useAtom(state.preferences.relays);
    const [prefaccount] = useAtom(state.preferences.account);
    const [tabs] = useAtom(state.tabs);
    const noswk = useNostrWorker();

    useEffect(() => {
        noswk.setRelays(prefrelays);
    }, [prefrelays]);
    // TODO: unsub on unload, but useEffect.return is overkill
    useEffect(() => {
        const pk = prefaccount?.pubkey;
        noswk.setIdentity(pk || null);
        const setsub = () => {
            noswk.setSubscribes(new Map(tabs
                .map<[string, FilledFilters | null]>(e => [
                    e.id,
                    typeof e.filter === "string" ? (noswk.getFilter(e.filter) || null) : (e.filter as FilledFilters)
                ])
                .filter((e): e is [string, FilledFilters] => !!e[1])));
        };
        setsub();
        const onMyContacts: (contacts: DeletableEvent) => void = contacts => {
            setsub();
        };
        noswk.onMyContacts.on("", onMyContacts);
        return () => {
            noswk.onMyContacts.off("", onMyContacts);
        };
    }, [tabs, prefaccount]);
    useEffect(() => {
        return () => {
            noswk.setSubscribes(new Map());
            noswk.setIdentity(null);
        };
    }, []);

    return <HashRouter>
        <Routes>
            <Route element={<GA measurementId={import.meta.env.VITE_APP_GA_MEASUREMENT_ID}><Global /></GA>} errorElement={<ErrorPage />}>
                <Route path="/" element={<Root />} />
                <Route path="/tab/*" element={<TabsView />} />
                <Route path="/preferences" element={<Preferences />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/about" element={<About />} />
                <Route path="*" element={<div>404. <Link to="/">go top</Link></div>} />
            </Route>
        </Routes>
    </HashRouter>;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <NostrWorkerProvider>
            <App />
            <Analytics />
        </NostrWorkerProvider>
    </React.StrictMode>,
);
