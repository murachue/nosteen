import { enableMapSet } from 'immer';
import { useAtom } from 'jotai/react';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { NostrWorkerProvider, useNostrWorker } from './nostrworker';
import About from './routes/about';
import ErrorPage from './routes/errorpage';
import Global from './routes/global';
import Preferences from './routes/preferences';
import Root from './routes/root';
import TabsView from './routes/tabsview';
import state from './state';
import { DeletableEvent, FilledFilters } from './types';

enableMapSet();

const App = () => {
    const [prefrelays] = useAtom(state.preferences.relays);
    const [prefaccount] = useAtom(state.preferences.account);
    const [tabs] = useAtom(state.tabs);
    const [globalOnKeyDown, setGlobalOnKeyDown] = useState<React.DOMAttributes<HTMLDivElement>["onKeyDown"]>(undefined);
    const [globalOnPointerDown, setGlobalOnPointerDown] = useState<React.DOMAttributes<HTMLDivElement>["onPointerDown"]>(undefined);
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
        return () => { noswk.onMyContacts.off("", onMyContacts); };
    }, [tabs, prefaccount]);

    return <HashRouter>
        <Routes>
            <Route element={<Global onKeyDown={globalOnKeyDown} onPointerDown={globalOnPointerDown} />} errorElement={<ErrorPage />}>
                <Route path="/" element={<Root />} />
                <Route path="/tab/*" element={<TabsView
                    setGlobalOnKeyDown={setGlobalOnKeyDown}
                    setGlobalOnPointerDown={setGlobalOnPointerDown}
                />} />
                <Route path="/preferences" element={<Preferences />} />
                <Route path="/about" element={<About />} />
            </Route>
        </Routes>
    </HashRouter>;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <NostrWorkerProvider>
            <App />
        </NostrWorkerProvider>
    </React.StrictMode>,
);
