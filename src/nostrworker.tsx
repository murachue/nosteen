import { Emitter, Event, Filter, Mux, Relay, validateEvent, verifyEvent } from "nostr-mux";
import { SimpleEmitter } from "nostr-mux/dist/core/emitter"; // ugh
import { UnsignedEvent, finishEvent, matchFilter } from "nostr-tools";
import { FC, PropsWithChildren, createContext, useContext } from "react";
import invariant from "tiny-invariant";
import { DeletableEvent, EventMessageFromRelay, FilledEventMessagesFromRelay, FilledFilters, Kinds, Post } from "./types";
import { getmk, postindex, postupsertindex } from "./util";

export type MuxRelayEvent = {
    mux: Mux;
    relay: Relay;
};


// quick deep(?) equality that requires same order for arrays
const filtereq = (a: FilledFilters, b: FilledFilters): boolean => {
    // fastpath
    if (a === b) return true;

    if (a.length !== b.length) {
        return false;
    }

    const len = a.length;
    for (let i = 0; i < len; i++) {
        const af = a[i];
        const bf = b[i];
        // ks = af.keys | bf.keys
        const ks = new Set(Object.keys(af));
        for (const k of Object.keys(bf)) {
            ks.add(k);
        }

        for (const k of ks.values()) {
            type FilterValue = number | string[] | number[] | undefined;
            const ap = (af as any)[k] as FilterValue;
            const bp = (bf as any)[k] as FilterValue;
            if (Array.isArray(ap) && Array.isArray(bp)) {
                if (ap.length !== bp.length) {
                    return false;
                }
                const len2 = ap.length;
                for (let j = 0; j < len2; j++) {
                    if (ap[j] !== bp[j]) {
                        return false;
                    }
                }
            } else if (ap !== bp) {
                return false;
            }
        }
    }

    return true;
};

function uniq<T>(sorted: T[]) {
    let l = sorted.length;
    let o = sorted[0];
    for (let i = 1; i < l;) {
        if (sorted[i] !== o) {
            o = sorted[i];
            i++;
        } else {
            sorted.splice(i, 1);
        }
    }
    return sorted;
}

const repostedIdByTag = (e: Event): string | null => {
    let etag: string | null = null;
    for (const tag of e.tags) {
        if (tag[0] !== "e") {
            continue;
        }
        if (etag) {
            // which e is reposted??
            return null;
        }
        etag = tag[1];
    }
    return etag;
};

const objectFromContent = (content: string): object | null => {
    if (!content.startsWith("{")) {
        return null;
    }
    try {
        return JSON.parse(content);
    } catch (e) {
        return null;
    }
};

const repostedId = (e: Event): string | null => {
    const id = repostedIdByTag(e);
    if (id) {
        return id;
    }

    // also try content (Damus/Amethyst style https://github.com/nostr-protocol/nips/pull/397#issuecomment-1488867364 )
    const r = objectFromContent(e.content);
    if (r !== null && "id" in r && typeof r.id === "string") {
        // FIXME: trusting content!! but verifying needs async... how?
        //        invading verify to content on above async-verify?
        return r.id;
    }

    return null;
};

const reactedIdFromTag = (e: Event): string | null => {
    let etag: string | null = null;
    for (const tag of e.tags) {
        if (tag[0] !== "e") {
            continue;
        }
        // overwrite to take last
        etag = tag[1];
    }
    return etag;
};

const getPostId = (e: Event): string | null => {
    switch (e.kind) {
        case Kinds.reaction: {
            return reactedIdFromTag(e);
        }
        case Kinds.delete: {
            // delete is another layer; no originate event.
            return null;
        }
        case Kinds.profile:
        case Kinds.contacts:
        case Kinds.relays: {
            // I think they are not a post.
            return null;
        }
        default: {
            // post, dm, repost or unknown... itself is a post.
            return e.id;
        }
    }
};

export type NostrWorkerListenerMessage = {
    name: string;
    type: "event" | "eose" | "hasread";
    events: DeletableEvent[];
    posts: Post[];
};

const isFilledEventMessagesFromRelay = (ms: EventMessageFromRelay[]): ms is FilledEventMessagesFromRelay => 0 < ms.length;

type ProfileEvents = {
    profile: DeletableEvent | null;
    contacts: DeletableEvent | null;
    relays: DeletableEvent | null;
};

export class NostrWorker {
    mux = new Mux();
    relays = new Map<string, Relay>();
    subs = new Map<string, { sid: string; filters: FilledFilters; } | { sid: null; filters: null; }>();
    // TODO: GC/LRUify events and posts. copy-gc from postStreams?
    events = new Map<string, DeletableEvent>();
    posts = new Map<string, Post>();
    nunreads = 0;
    postStreams = new Map<string, { posts: Post[], nunreads: number; }>(); // order by created_at TODO: also received_at for LRU considering fetching older post that is mentioned?
    pubkey: string | null = null;
    profiles = new Map<string, ProfileEvents>();
    profsid: string | null = null;
    onHealthy = new SimpleEmitter<MuxRelayEvent>();
    onMyContacts = new SimpleEmitter<DeletableEvent>();
    receiveEmitter = new Map<string, Emitter<NostrWorkerListenerMessage>>();
    addq: { name: string, messages: EventMessageFromRelay[]; }[] = [];
    fetchq: { filter: Filter, onComplete: (receives: EventMessageFromRelay | null) => void; }[] = [];

    getRelays() {
        return [...this.relays.values()].map(r => ({ url: r.url, read: r.isReadable, write: r.isWritable }));
    }
    setRelays(newrelays: { url: string, read: boolean, write: boolean; }[]) {
        const pre = new Map(this.relays); // taking a (shallow) copy for direct modify
        const cur = new Map(newrelays.map(r => [r.url, r]));

        // added
        for (const [url, relopt] of cur.entries()) {
            if (pre.has(url)) continue;

            const relay = new Relay(relopt.url, {
                read: relopt.read,
                write: relopt.write,
                watchDogInterval: 3600000,
            });
            relay.onHealthy.listen(e => this.onHealthy.emit({ mux: this.mux, relay: e.relay }));
            this.relays.set(relopt.url, relay);
            this.mux.addRelay(relay);
        }

        // removed
        for (const url of pre.keys()) {
            if (cur.has(url)) continue;

            this.mux.removeRelay(url);
            this.relays.delete(url);
        }
    }
    setIdentity(pubkey: string | null) {
        const pkchanged = this.pubkey !== pubkey;

        if (pkchanged && this.profsid) {
            this.mux.unSubscribe(this.profsid);
            this.profsid = null;
        }

        this.pubkey = pubkey;
        if (pkchanged && pubkey) {
            let first = true;
            // XXX: sub on here is ugly
            this.profsid = this.mux.subscribe({
                filters: [{ authors: [pubkey], kinds: [Kinds.contacts] }],
                enableBuffer: { flushInterval: 500 },
                onEvent: async res => {
                    // FIXME: use the single queue to avoid race...
                    const okrecv = await this.msgsToDelableEvent(res);
                    for (const dev of okrecv.values()) {
                        const newer = this.putProfile(dev);
                        if (!newer) continue;
                        const ev = dev.event?.event;
                        if (!ev) continue;
                        if (!first) continue;
                        first = false;
                        if (ev.pubkey !== pubkey || ev.kind !== Kinds.contacts) {
                            // !?
                            continue;
                        }
                        this.onMyContacts.emit(dev);
                    }
                },
            });
            this.getProfile(pubkey, Kinds.contacts).catch(console.error);
        }
        // TODO: myaction should be wiped
        // TODO: recent, reply, etc. should be wiped, but it is callers resp?
    }
    // must return arrays in predictable order to easier deep-compare.
    getFilter(type: "recent" | "reply" | "dm" | "favs"): FilledFilters | null {
        switch (type) {
            case "recent": {
                if (!this.pubkey) {
                    return null;
                }
                const followingpks = this.profiles.get(this.pubkey)?.contacts?.event?.event?.tags?.filter(t => t[0] === "p")?.map(t => t[1]) || [];
                return [
                    // my events and following events
                    // following events but we don't need their reactions
                    {
                        authors: uniq([this.pubkey, ...followingpks].sort()),
                        kinds: [Kinds.post, Kinds.delete, Kinds.repost],
                        limit: 100,
                    },
                    // reply to (tagged) me XXX: duped "reply"
                    {
                        "#p": [this.pubkey],
                        kinds: [Kinds.post, Kinds.delete, Kinds.repost],
                        limit: 30,
                    },
                    // and my reactions (duped with "favs")
                    {
                        authors: [this.pubkey],
                        kinds: [Kinds.reaction],
                        limit: 30,
                    },
                ];
            }
            case "reply": {
                if (!this.pubkey) {
                    return null;
                }
                // tagged me
                return [
                    {
                        "#p": [this.pubkey],
                        kinds: [Kinds.post, Kinds.delete, Kinds.repost],
                        limit: 30,
                    },
                ];
            }
            case "dm": {
                if (!this.pubkey) {
                    return null;
                }
                // dm from me and to me
                return [
                    {
                        authors: [this.pubkey],
                        kinds: [Kinds.dm],
                        limit: 30,
                    },
                    {
                        "#p": [this.pubkey],
                        kinds: [Kinds.dm],
                        limit: 30,
                    },
                ];
            }
            case "favs": {
                if (!this.pubkey) {
                    return null;
                }
                // tagged me
                return [
                    {
                        authors: [this.pubkey],
                        kinds: [Kinds.reaction],
                        limit: 30,
                    },
                ];
            }
            default:
                throw new Error(`invariant failed: unknown filter type ${type}`);
        }
    }
    setSubscribes(subs: Map<string, FilledFilters | null>) {
        for (const [name, sub] of this.subs.entries()) {
            if (subs.has(name)) continue;

            // removed
            if (sub.filters) {
                this.mux.unSubscribe(sub.sid);
            }
            this.subs.delete(name);
            this.postStreams.delete(name);
        }

        for (const [name, filters] of subs.entries()) {
            const sub = this.subs.get(name);
            if (sub) {
                // existing: unsub only if filters is changed. (noop, keep sub if not changed)
                if ((!sub.filters && !filters) || (sub.filters && filters && filtereq(sub.filters, filters))) continue;

                // changed; unsubscribe to override (nostr protocol supports override but nostr-mux silently rejects it)
                if (sub.filters) {
                    this.mux.unSubscribe(sub.sid);
                }
            } else {
                // new
                this.postStreams.set(name, { posts: [], nunreads: 0 });
            }

            // TODO: we should intro global async verify/add queue?
            const su = (() => {
                if (!filters) return { filters: null, sid: null };

                const sid = this.mux.subscribe({
                    filters: filters,
                    enableBuffer: { flushInterval: 50 },
                    onEvent: receives => this.onReceive(name, receives),
                    onEose: subid => this.onReceive(name, []),
                });
                return {
                    filters,
                    sid,
                };
            })();
            this.subs.set(name, su);
        }
    }
    getAllPosts() {
        return this.posts;
    }
    getPostStream(name: string) {
        return this.postStreams.get(name);
    }
    postEvent(etl: UnsignedEvent, sk: string) {
        const ev = finishEvent(etl, sk);
        // TODO
    }
    addListener(name: string, fn: (msg: NostrWorkerListenerMessage) => void) {
        const emitter = this.receiveEmitter.get(name) || new SimpleEmitter();
        this.receiveEmitter.set(name, emitter);
        emitter.listen(fn);
    }
    removeListener(name: string, fn: (msg: NostrWorkerListenerMessage) => void) {
        const emitter = this.receiveEmitter.get(name);
        if (!emitter) {
            return;
        }
        emitter.stop(fn);
    }
    enqueueFetchEventFor(fetches: typeof this.fetchq) {
        const first = this.fetchq.length === 0;
        this.fetchq.push(...fetches);
        if (first) {
            this.fetchEvent().catch(e => {
                console.error(e);
                this.fetchq.splice(0);
            });
        }
    }
    getPost(id: string) {
        return this.posts.get(id);
    }
    overwritePosts(name: string, posts: Post[]) {
        const strm = getmk(this.postStreams, name, () => ({ posts: [], nunreads: 0 }));
        strm.posts.splice(0, strm.posts.length, ...posts);
        strm.nunreads = posts.reduce((p, c) => p + (c.hasread ? 1 : 0), 0);
    }
    setHasread(spec: { id: string; } | { stream: string; beforeIndex: number; } | { stream: string; afterIndex: number; }, hasRead: boolean) {
        const dhr = hasRead ? -1 : 1;
        if ("id" in spec) {
            const post = this.posts.get(spec.id);
            if (!post) {
                return undefined;
            }
            if (post.hasread === hasRead) {
                return post;
            }
            const ev = post.event?.event?.event;
            if (!ev) {
                return undefined;
            }

            post.hasread = hasRead;
            this.nunreads += dhr;

            for (const [name, tab] of this.postStreams.entries()) {
                const cursor = postindex(tab.posts, ev);
                if (cursor === null) {
                    continue;
                }
                tab.nunreads += dhr;
                this.receiveEmitter.get(name)?.emit({ name, type: "hasread", events: [], posts: [post] });
            }
            return;
        }
        if ("stream" in spec) {
            const strm = this.postStreams.get(spec.stream);
            if (!strm) return undefined;
            const posts = strm.posts;
            let i: number;
            let e: number;
            const l = posts.length;
            if ("beforeIndex" in spec) { i = 0; e = Math.min(spec.beforeIndex, l); }
            else { i = spec.afterIndex + 1; e = l; }
            const changed = [];
            // TODO: unread other streams is N*M
            for (; i < e; i++) {
                if (posts[i].hasread === hasRead) continue;
                posts[i].hasread = hasRead;
                strm.nunreads += dhr;
                this.nunreads += dhr;
                changed.push(posts[i]);
            }
            if (0 < changed.length) {
                this.receiveEmitter.get(spec.stream)?.emit({ name: spec.stream, type: "hasread", events: [], posts: changed });
            }
            for (const [name, s] of this.postStreams.entries()) {
                if (name === spec.stream) continue;
                const nunrs = s.posts.reduce((p, c) => p + (c.hasread ? 0 : 1), 0);
                if (s.nunreads !== nunrs) {
                    s.nunreads = nunrs;
                    // FIXME: posts is empty...
                    this.receiveEmitter.get(name)?.emit({ name, type: "hasread", events: [], posts: [] });
                }
            }
        }
    }
    async getProfile(pk: string, kind: typeof Kinds[keyof typeof Kinds]) {
        return this.profiles.get(pk);
    }

    private putProfile(event: DeletableEvent): boolean {
        if (!event.event) return false;
        const ev = event.event.event;
        const pf = getmk(this.profiles, ev.pubkey, () => ({ profile: null, contacts: null, relays: null }));
        const k = this.profkey(ev.kind);
        const knownev = pf[k]?.event?.event;
        if (knownev && ev.created_at <= knownev.created_at) return false;
        pf[k] = event;
        return true;
    }

    private profkey(kind: number): keyof ProfileEvents {
        switch (kind) {
            case Kinds.profile: return "profile";
            case Kinds.contacts: return "contacts";
            case Kinds.relays: return "relays";
            default: throw new Error(`profkey with unknown kind ${kind}`);
        }
    }

    private async fetchEvent() {
        while (this.fetchq.length) {
            let i = 0;
            const l = this.fetchq.length;
            const fetchs: typeof this.fetchq = [];
            for (; i < l; i++) {
                const f = this.fetchq[i];

                // cached?
                const ids = f.filter.ids;
                if (ids) {
                    const ev = this.events.get(ids[0])?.event;
                    if (ev) {
                        f.onComplete({ received: { type: "EVENT", subscriptionID: "", event: ev.event }, relay: ev.receivedfrom.values().next().value });
                        continue;
                    }
                    if (fetchs.find(fe => fe.filter.ids?.[0] === ids[0])) {
                        continue;
                    }
                }
                // XXX: this intros mergeability of prof/contact/relays...
                const authors = f.filter.authors;
                const kinds = f.filter.kinds;
                if (authors && kinds && [Kinds.profile, Kinds.contacts, Kinds.relays].includes(kinds[0])) {
                    const k = this.profkey(kinds[0]);
                    const ev = this.profiles.get(authors[0])?.[k]?.event;
                    if (ev) {
                        f.onComplete({ received: { type: "EVENT", subscriptionID: "", event: ev.event }, relay: ev.receivedfrom.values().next().value });
                        continue;
                    }
                    if (fetchs.find(fe => fe.filter.authors?.[0] === authors[0] && fe.filter.kinds?.[0] === kinds[0])) {
                        continue;
                    }
                }

                fetchs.push(f);
            }

            if (0 < fetchs.length) {
                await new Promise<void>((resolve, reject) => {
                    const fmap = new Map(fetchs.map(f => [f.filter, f]));
                    let sid: string;
                    sid = this.mux.subscribe({
                        filters: fetchs.map(e => e.filter) as FilledFilters,
                        onEvent: evs => {
                            try {
                                for (const ev of evs) {
                                    const eve = ev.received.event;
                                    const ms = [...fmap.values()].filter(f => matchFilter(f.filter, eve));
                                    for (const m of ms) {
                                        m.onComplete(ev);
                                        fmap.delete(m.filter);
                                    }
                                }
                            } catch (e) { reject(e); }
                        },
                        onEose: () => {
                            try {
                                for (const m of fmap.values()) {
                                    m.onComplete(null);
                                }
                                this.mux.unSubscribe(sid);
                                resolve();
                            } catch (e) { reject(e); }
                        },
                        enableBuffer: { flushInterval: 100 },
                        eoseTimeout: 3000,
                    });
                });
            }
            this.fetchq.splice(0, i);
        }
    }

    private onReceive(name: string, messages: EventMessageFromRelay[]) {
        const first = this.addq.length === 0;
        this.addq.push({ name, messages });
        if (first) {
            this.receiveProc().catch(e => {
                console.error(e);
                this.addq.splice(0);
            });
        }
    }

    private async receiveProc() {
        while (this.addq.length) {
            // peek not pop to avoid launch receive proc while processing last.
            const { name, messages } = this.addq[0];
            if (isFilledEventMessagesFromRelay(messages)) {
                await this.receiveOneProc(name, messages);
            } else {
                this.receiveEmitter.get(name)?.emit({ name, type: "eose", events: [], posts: [] });
            }

            this.addq.splice(0, 1);
        }
    }

    private async receiveOneProc(name: string, messages: FilledEventMessagesFromRelay) {
        // TODO: repost/reaction target fetching
        // TODO: we may can use batch schnorr verify (if library supports) but bothered if some fail.

        // first, event (with deletion) layer.
        const okrecv = await this.msgsToDelableEvent(messages);

        // then post layer.
        const tap = this.postStreams.get(name);
        invariant(tap, `no postStream for ${name}`);
        const posted = [];
        for (const recv of okrecv.values()) {
            if (!recv.event) {
                // we cannot update stream without the event...
                continue;
            }
            // FIXME: delete itself is matched to filter, but target may not. we manually filter??

            const pid = getPostId(recv.event.event);
            if (!pid) {
                // sad
                continue;
            }

            const post = getmk(this.posts, pid, () => ({
                id: pid,
                event: null,
                reposttarget: null,
                myreaction: null,
                hasread: false,
            }));

            posted.push(post);
            const wasempty = !post.event;

            if (recv.event.event.kind === Kinds.repost) {
                post.event = recv;
                const tid = repostedId(recv.event.event);
                if (tid) {
                    const target = this.events.get(tid);
                    if (target) {
                        post.reposttarget = target;
                    } else {
                        // TODO: fetch request with remembering ev.id (repost N:1 target)
                    }
                }
            } else if (recv.event.event.kind === Kinds.reaction) {
                if (recv.event.event.pubkey === this.pubkey) {
                    post.myreaction = recv;
                    if (!post.event) {
                        // TODO: fetch request with remembering ev.id (repost N:1 target)
                    }
                }
            } else {
                // TODO: treat just ref'ing note as repost? note1qqqq9q6dm3z2swss94ul9qxxsysf3c4qemfwwlck8fyr4dqf4pyq2gzsxj
                post.event = recv;
            }

            this.nunreads += (wasempty && post.event) ? 1 : 0;

            // to support pop up events like reacting completely unrelated event, we must not premise that "post appears only on event is just filled."
            if (post.event) {
                const cursor = postupsertindex(tap.posts, post.event.event!.event);
                if (cursor.type === "insert") {
                    tap.posts.splice(cursor.index, 0, post);
                    tap.nunreads += (wasempty && post.event) ? 1 : 0;
                }
            }
        }

        // XXX: ignore only-delevs, is it ok?
        const okevs = [...okrecv.values()].filter(e => e.event);
        if (0 < okevs.length) {
            this.receiveEmitter.get(name)?.emit({ name, type: "event", events: okevs, posts: posted });
        }
    }

    private async msgsToDelableEvent(messages: FilledEventMessagesFromRelay) {
        const now = Date.now();
        const okrecv = new Map<string, DeletableEvent>;
        for (const { received: { event }, relay } of messages) {
            // TODO: unify these del,post,repost.
            if (event.kind === 5) {
                // delete: verify only if it's new and some are unknown
                // this maps any DeletableEvent (almost last #e but not limited to)
                // XXX: this fails when we got some kind5s for the same event and older kind5 arrives...
                //      but it only cause extra verify.
                const dev = this.events.get(event.id);
                if (dev?.deleteevent) {
                    // we already know valid/treated that event...
                    // simple check and trust: they send the same event (incl. sig) to many relays.
                    //                         same sig: treat other properties also same, use VERIFIED event.
                    //                         diff sig: treat as bad. (same id can have other sig though...)
                    if (event.sig === dev.deleteevent.event.sig) {
                        dev.deleteevent.receivedfrom.add(relay);
                        okrecv.set(dev.id, dev); // update my tab too
                    }
                    continue;
                }

                const dels: string[] = [];
                for (const tag of event.tags) {
                    if (tag[0] !== "e") {
                        // !? ignore
                        continue;
                    }
                    const evid = tag[1];
                    const tdev = this.events.get(evid);
                    if (!tdev || !tdev.deleteevent) {
                        dels.push(evid);
                    }
                }
                if (dels.length === 0) {
                    // all are known (1:N delete event?); skip
                    // TODO: remember to events and make fastpath-able?
                    continue;
                }

                const r = await verifyEvent(event);
                if (typeof r === "string") {
                    // TODO: invalid sig!?
                    continue;
                }

                for (const did of dels) {
                    const tdev = getmk(this.events, did, () => ({
                        id: did,
                        event: null,
                        deleteevent: null,
                    }));

                    if (tdev.event && tdev.event.event.pubkey !== event.pubkey) {
                        // reject liar on first receive. ignore this delete event.
                        // FIXME: NIP-26 (as of 2023-04-13) states that delegator has a power to delete delegatee event.
                        //        this logic also prohibit that... but treating it needs more complex...
                        // TODO: should log before null?
                        this.events.delete(event.id);
                        continue;
                    }

                    this.events.set(event.id, tdev); // delete->dev map

                    tdev.deleteevent ||= {
                        event,
                        receivedfrom: new Set(),
                        lastreceivedat: 0,
                    };
                    tdev.deleteevent.receivedfrom.add(relay);
                    tdev.deleteevent.lastreceivedat = now;
                    okrecv.set(did, tdev);
                }
            } else {
                // others
                const dev = this.events.get(event.id);
                if (dev?.event) {
                    // we already know valid/treated that event...
                    // simple check and trust: they send the same event (incl. sig) to many relays.
                    //                         same sig: treat other properties also same, use VERIFIED event.
                    //                         diff sig: treat as bad. (same id can have other sig though...)
                    if (event.sig === dev.event.event.sig) {
                        dev.event.receivedfrom.add(relay);
                        okrecv.set(event.id, dev); // update my tab too
                    }
                    continue;
                }

                const r = await verifyEvent(event);
                if (typeof r === "string") {
                    // TODO: invalid sig!?
                    continue;
                }

                const tdev = dev || {
                    id: event.id,
                    event: null,
                    deleteevent: null,
                };
                this.events.set(event.id, tdev);

                tdev.event ||= {
                    event,
                    receivedfrom: new Set(),
                    lastreceivedat: 0,
                };
                tdev.event.receivedfrom.add(relay);
                tdev.event.lastreceivedat = now;

                if (tdev.deleteevent && tdev.deleteevent.event.pubkey !== event.pubkey) {
                    // reject liar on first receive. nullify the delete event.
                    // FIXME: NIP-26 (as of 2023-04-13) states that delegator has a power to delete delegatee event.
                    //        this logic also prohibit that... but treating it needs more complex...
                    // TODO: should log before null?
                    this.events.delete(tdev.deleteevent.event.id);
                    tdev.deleteevent = null;
                    // fallthrough
                }

                okrecv.set(event.id, tdev);

                // hack: repost.
                //       verify and remember as events but not okrecv to not pop up as originated (not reposted)
                if (event.kind === 6) {
                    const cobj = (() => { try { return JSON.parse(event.content); } catch { return undefined; } })();
                    if (!cobj) {
                        continue;
                    }

                    const subevent = validateEvent(cobj);
                    if (typeof subevent === "string") {
                        // does not form of an Event...
                        continue;
                    }

                    const sdev = this.events.get(subevent.id);
                    // expects not kind5
                    if (sdev?.event) {
                        // we already know valid/treated that event...
                        // simple check and trust: they send the same event (incl. sig) to many relays.
                        //                         same sig: treat other properties also same, use VERIFIED event.
                        //                         diff sig: treat as bad. (same id can have other sig though...)
                        if (subevent.sig === sdev.event.event.sig) {
                            sdev.event.receivedfrom.add(relay);
                            okrecv.set(subevent.id, sdev); // update my tab too
                        }
                        continue;
                    }

                    const sr = await verifyEvent(subevent);
                    if (typeof sr === "string") {
                        // TODO: invalid sig...
                        continue;
                    }

                    const stdev = sdev || {
                        id: subevent.id,
                        event: null,
                        deleteevent: null,
                    };
                    this.events.set(subevent.id, stdev);

                    stdev.event ||= {
                        event: subevent,
                        receivedfrom: new Set(),
                        lastreceivedat: 0,
                    };
                    stdev.event.receivedfrom.add(relay); // ?
                    stdev.event.lastreceivedat = now;

                    if (stdev.deleteevent && stdev.deleteevent.event.pubkey !== subevent.pubkey) {
                        // reject liar on first receive. nullify the delete event.
                        // FIXME: NIP-26 (as of 2023-04-13) states that delegator has a power to delete delegatee event.
                        //        this logic also prohibit that... but treating it needs more complex...
                        // TODO: should log before null?
                        this.events.delete(stdev.deleteevent.event.id);
                        stdev.deleteevent = null;
                        // fallthrough
                    }

                    // but no okrecv.
                }
            }
        }
        return okrecv;
    }
}

const GlobalNostrWorker = new NostrWorker();
const NostrWorkerContext = createContext<NostrWorker | null>(null);
export const NostrWorkerProvider: FC<PropsWithChildren<{}>> = ({ children }) => {
    return <NostrWorkerContext.Provider value={GlobalNostrWorker}>{children}</NostrWorkerContext.Provider>;
};
export const useNostrWorker = () => {
    return useContext(NostrWorkerContext);
};
