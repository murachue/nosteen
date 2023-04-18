import { enableMapSet } from 'immer';
import { useAtom } from 'jotai/react';
import { RelayEvent } from 'nostr-mux';
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { NostrWorkerProvider, useNostrWorker } from './nostrworker';
import ErrorPage from './routes/errorpage';
import Global from './routes/global';
import MainLayout from './routes/mainlayout';
import Preferences from './routes/preferences';
import Root from './routes/root';
import TabsView from './routes/tabsview';
import TestApp from './routes/test';
import state from './state';
import { FilledFilters } from './types';

enableMapSet();

const App = () => {
    const [prefrelays] = useAtom(state.preferences.relays);
    const [prefaccount] = useAtom(state.preferences.account);
    const [mux] = useAtom(state.relaymux);
    const [tabs] = useAtom(state.tabs);
    const [globalOnKeyDown, setGlobalOnKeyDown] = useState<React.DOMAttributes<HTMLDivElement>["onKeyDown"]>(undefined);
    const noswk = useNostrWorker();

    // TODO: unsub on unload, but useEffect.return is overkill
    useEffect(() => {
        noswk!.setIdentity(prefaccount?.pubkey || null);
        noswk!.setSubscribes(new Map(tabs
            .map<[string, FilledFilters | null]>(e => [
                e.name,
                typeof e.filter === "string" ? (noswk!.getFilter(e.filter) || null) : (e.filter as FilledFilters)
            ])
            .filter((e): e is [string, FilledFilters] => !!e[1])));
    }, [tabs, prefaccount]);
    useEffect(() => {
        noswk!.setRelays(prefrelays);
    }, [prefrelays]);

    // FIXME: SyncExternalStore requires return same object-equality when not changed
    //        (or render-loop) how to do it? (want to return {all,health})
    const nrelays = useSyncExternalStore(
        useCallback((onStoreChange) => {
            const caller = (e: RelayEvent) => onStoreChange();
            noswk!.onHealthy.listen(caller);
            return () => noswk!.onHealthy.stop(caller);
        }, [noswk]),
        useCallback(() => {
            return mux.allRelays.length;
        }, [mux]),
    );
    const nhealthrelays = useSyncExternalStore(
        useCallback((onStoreChange) => {
            const caller = (e: RelayEvent) => onStoreChange();
            noswk!.onHealthy.listen(caller);
            return () => noswk!.onHealthy.stop(caller);
        }, [noswk]),
        useCallback(() => {
            return mux.healthyRelays.length;
        }, [mux]),
    );
    const [relayinfo, setRelayinfo] = useAtom(state.relayinfo);
    setRelayinfo(useMemo(() => ({ all: nrelays, healthy: nhealthrelays }), [nrelays, nhealthrelays]));

    return <HashRouter>
        <Routes>
            <Route element={<Global onKeyDown={globalOnKeyDown} />} errorElement={<ErrorPage />}>
                <Route path="/" element={<Root />} />
                <Route element={<MainLayout />}>
                    <Route path="/tab/:name?" element={<TabsView setGlobalOnKeyDown={setGlobalOnKeyDown} />} />
                    <Route path="test" element={<TestApp />} />
                </Route>
                <Route path="/preferences" element={<Preferences />} />
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
