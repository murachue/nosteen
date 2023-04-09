import produce, { enableMapSet } from 'immer';
import { useImmerAtom } from 'jotai-immer';
import { useAtom } from 'jotai/react';
import { Event, Filter, Relay, SubscriptionOptions, verifyEvent } from 'nostr-mux';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Kinds, ReceivedEvent } from './types';
import { bsearchi, postindex } from './util';

enableMapSet();

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
                    const followingpks = mycontacts?.tags.filter(t => t[0] === "p").map(t => t[1]) || [];
                    const followingeq = JSON.stringify(((sub?.filters[1]?.authors || []))) === JSON.stringify(followingpks);
                    if (sub?.filters[0]?.authors?.[0] === prefaccount?.pubkey && followingeq) {
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
                            const okevs = new Map<string, ReceivedEvent>(); // don't taint allevents till updating setPosts
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
                                            const okev = okevs.get(event.id) || {
                                                event,
                                                receivedfrom: new Set(),
                                            };
                                            okevs.set(event.id, okev);
                                            okev.receivedfrom.add(relay);
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
                                            const okev = okevs.get(event.id) || {
                                                event,
                                                receivedfrom: new Set(),
                                            };
                                            okevs.set(event.id, okev);
                                            okev.receivedfrom.add(relay);
                                            // TODO: kind6.content
                                        }
                                    }
                                }
                            }

                            // then synchronous update
                            setPosts(produce(draft => {
                                const events = draft.allevents;
                                const posts = draft.allposts;
                                const tap = draft.bytab.get(tab.name);
                                invariant(tap, `no posts.bytab for ${tab.name}`);
                                const getPostId = (e: Event): string | null => {
                                    const k = e.kind;
                                    if (k === Kinds.repost) {
                                        const idByTag = ((e: Event) => {
                                            let etag: string | undefined = undefined;
                                            for (const tag of e.tags) {
                                                if (tag[0] !== "e") {
                                                    continue;
                                                }
                                                if (etag) {
                                                    // which e is reposted??
                                                    return undefined;
                                                }
                                                etag = tag[1];
                                            }
                                            return etag;
                                        })(e);
                                        if (idByTag) {
                                            return idByTag;
                                        }
                                        // also try content (Damus/Amethyst style https://github.com/nostr-protocol/nips/pull/397#issuecomment-1488867364 )
                                        const r = ((content: string): unknown => {
                                            if (content === "") {
                                                return undefined;
                                            }
                                            try {
                                                return JSON.parse(content);
                                            } catch (e) {
                                                return undefined;
                                            }
                                        })(e.content);
                                        if (typeof r === "object" && r !== null && "id" in r && typeof r.id === "string") {
                                            // FIXME: trusting content!! but verifying needs async... how?
                                            //        invading verify to content on above async-verify?
                                            return r.id;
                                        }
                                        return null;
                                    }
                                    if (k === Kinds.reaction) {
                                        const tid = ((e: Event) => {
                                            let etag: string | undefined = undefined;
                                            for (const tag of e.tags) {
                                                if (tag[0] !== "e") {
                                                    continue;
                                                }
                                                // overwrite to take last
                                                etag = tag[1];
                                            }
                                            return etag; // can be undefined but violating NIP-25
                                        })(e);
                                        if (!tid) {
                                            return null;
                                        }
                                        return tid;
                                    }
                                    if (k === Kinds.delete) {
                                        // delete is another layer; no originate event.
                                        return null;
                                    }
                                    // post, dm, repost or unknown... itself is a post.
                                    return e.id;
                                };
                                // TODO: merge okevs into events first, then update posts/tap
                                //       that will needs first flag for each post to be quick
                                for (const op of ops) {
                                    switch (op.type) {
                                        case 'delete': {
                                            const evid = op.id;

                                            const dev = events.get(evid) || {
                                                id: evid,
                                                event: null,
                                                deleteevent: null,
                                            };
                                            events.set(evid, dev);

                                            const known = dev.deleteevent;

                                            if (!known && dev.event && dev.event.event.pubkey !== op.event.pubkey) {
                                                // reject liar on first receive. ignore this delete event.
                                                // TODO: should log before null?
                                                // we don't modified object yet, objref is still consistent.
                                                // (if dev is just created, it's not listed (event=null), that is consistent)
                                                break;
                                            }

                                            dev.deleteevent = dev.deleteevent || {
                                                event: op.event,
                                                receivedfrom: new Set(),
                                            };
                                            dev.deleteevent.receivedfrom.add(op.relay);

                                            if (known) {
                                                // followings are already done. end.
                                                break;
                                            }

                                            if (!dev.event) {
                                                // nothing to do when target is unknown.
                                                // defer to later target receiving.
                                                break;
                                            }

                                            // update its target post (deleted or nullified)
                                            const oeid = getPostId(dev.event.event);
                                            if (!oeid) {
                                                // TODO: how any?
                                                break;
                                            }
                                            const post = posts.get(oeid) || {
                                                id: oeid,
                                                event: null,
                                                reposttarget: null,
                                                myreaction: null,
                                                hasread: false,
                                            };
                                            posts.set(oeid, post);

                                            if (dev.event.event.kind === Kinds.repost) {
                                                // TODO: see also okevs but cannot reuse purely (needs merging receivedfrom)
                                                const target = events.get(oeid);
                                                if (target) {
                                                    post.reposttarget = target;
                                                } else {
                                                    // TODO: fetch request with remembering ev.id (repost N:1 target)
                                                }
                                            } else if (dev.event.event.kind === Kinds.reaction) {
                                                post.myreaction = dev;
                                            } else {
                                                post.event = dev;
                                            }

                                            // update bytab to keep objref consistent and make component update
                                            if (!post.event?.event) {
                                                // not listed yet. no need to update objref
                                                break;
                                            }
                                            // TODO: update all tabs
                                            const i = postindex(tap, post.event!.event!.event);
                                            if (i !== null) {
                                                tap[i] = post;
                                            }

                                            break;
                                        }
                                        case 'event': {
                                            const ev = op.event;

                                            const dev = events.get(ev.id) || {
                                                id: ev.id,
                                                event: null,
                                                deleteevent: null,
                                            };
                                            events.set(ev.id, dev);

                                            const known = dev.event;
                                            dev.event = dev.event || {
                                                event: ev,
                                                receivedfrom: new Set(),
                                            };
                                            dev.event.receivedfrom.add(op.relay);

                                            if (known) {
                                                // followings are already done. end.
                                                break;
                                            }

                                            if (dev.deleteevent && dev.event.event.pubkey !== dev.deleteevent.event.pubkey) {
                                                // liar!! nullify delete
                                                // TODO: should log before null?
                                                dev.deleteevent = null;
                                                // fallthrough continue.
                                            }

                                            const evid = ev.id;

                                            const oeid = getPostId(ev);
                                            if (!oeid) {
                                                // TODO: how any?
                                                break;
                                            }

                                            const post = posts.get(evid) || {
                                                id: oeid,
                                                event: null,
                                                reposttarget: null,
                                                myreaction: null,
                                                hasread: false,
                                            };
                                            posts.set(evid, post);

                                            if (ev.kind === Kinds.repost) {
                                                post.event = dev;
                                                const target = events.get(oeid);
                                                if (target) {
                                                    post.reposttarget = target;
                                                } else {
                                                    // TODO: fetch request with remembering ev.id (repost N:1 target)
                                                }
                                            } else if (ev.kind === Kinds.reaction) {
                                                if (ev.pubkey === prefaccount?.pubkey) {
                                                    post.myreaction = dev;
                                                    if (!post.event) {
                                                        // TODO: fetch request with remembering ev.id (repost N:1 target)
                                                    }
                                                }
                                            } else {
                                                post.event = dev;
                                            }


                                            // update bytab to keep objref consistent and make component update
                                            if (!post.event?.event) {
                                                // don't list if main event is not ready. no need to update objref
                                                break;
                                            }
                                            // TODO: update all tabs
                                            const cat = post.event.event.event.created_at;
                                            const i = bsearchi(tap, p => cat < p.event!.event!.event.created_at);
                                            tap.splice(i, 0, post);

                                            break;
                                        }
                                    }
                                }
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

        {
            const k = "__mycontacts";
            const sub = subs.get(k);
            const tabfilt = ((): SubscriptionOptions["filters"] | null => {
                if (sub?.filters[0]?.authors?.[0] === prefaccount?.pubkey) {
                    return sub?.filters || null; // return as is, or null on unlogin
                } else if (!prefaccount) {
                    return null;
                } else {
                    return [
                        // my contacts
                        {
                            authors: [prefaccount.pubkey],
                            kinds: [Kinds.contacts],
                        },
                    ];
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
                        enableBuffer: { flushInterval: 100 },
                        onEvent: async receives => {
                            // TODO: copypasta. can be more shorter. but for unify?

                            // XXX: produce() don't support async??
                            //      [Immer] produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '[object Promise]'
                            //      try best. (ref'ing old events may cause extra verify which is sad but not fatal.)
                            // TODO: repost/reaction target fetching
                            // TODO: we may can use batch schnorr verify (if library supports) but bothered if some fail.
                            const allevents = postsRef.current.allevents;
                            type OpEv = { type: "event"; event: Event; relay: Relay; };
                            type OpDel = { type: "delete"; event: Event; relay: Relay; id: string; };
                            const okevs = new Map<string, ReceivedEvent>(); // don't taint allevents till updating setPosts
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
                                            const okev = okevs.get(event.id) || {
                                                event,
                                                receivedfrom: new Set(),
                                            };
                                            okevs.set(event.id, okev);
                                            okev.receivedfrom.add(relay);
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
                                            const okev = okevs.get(event.id) || {
                                                event,
                                                receivedfrom: new Set(),
                                            };
                                            okevs.set(event.id, okev);
                                            okev.receivedfrom.add(relay);
                                            // TODO: kind6.content
                                        }
                                    }
                                }
                            }

                            // then synchronous update
                            setPosts(produce(draft => {
                                const events = draft.allevents;

                                for (const op of ops) {
                                    switch (op.type) {
                                        case 'delete': {
                                            const evid = op.id;

                                            const dev = events.get(evid) || {
                                                id: evid,
                                                event: null,
                                                deleteevent: null,
                                            };
                                            events.set(evid, dev);

                                            const known = dev.deleteevent;

                                            if (!known && dev.event && dev.event.event.pubkey !== op.event.pubkey) {
                                                // reject liar on first receive. ignore this delete event.
                                                // TODO: should log before null?
                                                // we don't modified object yet, objref is still consistent.
                                                // (if dev is just created, it's not listed (event=null), that is consistent)
                                                break;
                                            }

                                            dev.deleteevent = dev.deleteevent || {
                                                event: op.event,
                                                receivedfrom: new Set(),
                                            };
                                            dev.deleteevent.receivedfrom.add(op.relay);

                                            if (known) {
                                                // followings are already done. end.
                                                break;
                                            }

                                            if (!dev.event) {
                                                // nothing to do when target is unknown.
                                                // defer to later target receiving.
                                                break;
                                            }

                                            // FIXME: so hacky
                                            // if (dev.event.event.kind === 3 && dev.event.event.pubkey === prefaccount?.pubkey) {
                                            //     setMycontacts(dev.event.event);
                                            //     break;
                                            // }
                                        }
                                        case 'event': {
                                            const ev = op.event;

                                            const dev = events.get(ev.id) || {
                                                id: ev.id,
                                                event: null,
                                                deleteevent: null,
                                            };
                                            events.set(ev.id, dev);

                                            const known = dev.event;
                                            dev.event = dev.event || {
                                                event: ev,
                                                receivedfrom: new Set(),
                                            };
                                            dev.event.receivedfrom.add(op.relay);

                                            if (known) {
                                                // followings are already done. end.
                                                break;
                                            }

                                            if (dev.deleteevent && dev.event.event.pubkey !== dev.deleteevent.event.pubkey) {
                                                // liar!! nullify delete
                                                // TODO: should log before null?
                                                dev.deleteevent = null;
                                                // fallthrough continue.
                                            }

                                            // FIXME: so hacky
                                            if (dev.event.event.kind === 3 && dev.event.event.pubkey === prefaccount?.pubkey) {
                                                setMycontacts(dev.event.event);
                                                break;
                                            }

                                            break;
                                        }
                                    }
                                }
                            }));
                        },
                    });
                    ops.push({
                        op: "set",
                        sub: {
                            name: k,
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

    const [relayinfo, setRelayinfo] = useAtom(state.relayinfo);
    // FIXME: should mux healthy events but nostr-mux don't provide it (yet)...
    setRelayinfo(useMemo(() => ({ all: mux.allRelays.length, healthy: mux.healthyRelays.length }),
        [mux.allRelays.length, mux.healthyRelays.length]));

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
