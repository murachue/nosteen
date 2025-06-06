import { Event, Filter, Kind, matchFilter, validateEvent, verifySignature } from "nostr-tools";
import { FC, PropsWithChildren, createContext, useContext } from "react";
import invariant from "tiny-invariant";
import { MuxPool, RelayWrap } from "./pool";
import { Relay } from "./relay";
import { DeletableEvent, EventMessageFromRelay, FilledFilters, Post } from "./types";
import { SimpleEmitter, getmk, postindex, postupsertindex, rescue } from "./util";

export type RelayWithMode = {
    relay: RelayWrap;
    url: string;  // relay is nullable... have a copy
    read: boolean;
    write: boolean;
};

export type MuxRelayEvent = {
    mux: MuxPool;
    relay: Relay;
    event: "connected" | "disconnected";
    reason?: unknown;
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
        case Kind.Reaction: {
            return reactedIdFromTag(e);
        }
        case Kind.EventDeletion: {
            // delete is another layer; no originate event.
            return null;
        }
        // case Kind.Metadata:
        // case Kind.Contacts:
        // case Kind.RelayList: {
        //     // I think they are not a post.
        //     return null;
        // }
        default: {
            // post, dm, repost or unknown... itself is a post.
            return e.id;
        }
    }
};

const validateCompleteEvent = (event: unknown): event is Event => {
    if (!validateEvent(event)) return false;
    if (!("id" in event)) return false;  // satisfy type
    if (typeof event.id !== "string") return false;
    if (!event.id.match(/^[a-f0-9]{64}$/)) return false;
    if (!("sig" in event)) return false;  // satisfy type
    if (typeof event.sig !== "string") return false;
    if (!event.sig.match(/^[a-f0-9]{128}$/)) return false;
    return true;
};

export type NostrWorkerListenerMessage = {
    name: string;
    type: "event";
    events: DeletableEvent[];
    posts: Post[];
} | {
    name: string;
    type: "eose";
} | {
    name: string;
    type: "hasread";
    hasRead: boolean;
    posts: Post[];
};

type CachedDeletableEvent = {
    event: DeletableEvent | null;
    fetchedAt: number;
};
type ProfileEvents = {
    profile: CachedDeletableEvent | null;
    contacts: CachedDeletableEvent | null;
    relays: CachedDeletableEvent | null;
};

export abstract class FetchPred {
    public uncached = false;
    constructor(uncached?: boolean) {
        if (uncached !== undefined) {
            this.uncached = uncached;
        }
    }
    abstract filter(): Filter[];
    abstract merge(other: FetchPred): FetchPred | null;
}
export class FetchId extends FetchPred {
    /* private */public ids: string[];
    constructor(id: string, uncached?: boolean) {
        super(uncached);
        this.ids = [id];
    }
    filter() { return [{ ids: this.ids, limit: this.ids.length }]; }
    merge(other: FetchPred) {
        if (!(other instanceof FetchId)) return null;
        const p = new FetchId(this.ids[0]);
        p.ids = [...new Set([...this.ids, ...other.ids]).values()];
        return p;
    }
}
export class FetchProfile extends FetchPred {
    /* private */public pks: string[];
    constructor(pk: string, uncached?: boolean) {
        super(uncached);
        this.pks = [pk];
    }
    filter() { return [{ authors: this.pks, kinds: [Kind.Metadata], limit: this.pks.length }]; };
    merge(other: FetchPred) {
        if (!(other instanceof FetchProfile)) return null;
        const p = new FetchProfile(this.pks[0]);
        p.pks = [...new Set([...this.pks, ...other.pks]).values()];
        return p;
    }
}
export class FetchContacts extends FetchPred {
    /* private */public pks: string[];
    constructor(pk: string, uncached?: boolean) {
        super(uncached);
        this.pks = [pk];
    }
    filter() { return [{ authors: this.pks, kinds: [Kind.Contacts], limit: this.pks.length }]; };
    merge(other: FetchPred) {
        if (!(other instanceof FetchContacts)) return null;
        const p = new FetchContacts(this.pks[0]);
        p.pks = [...new Set([...this.pks, ...other.pks]).values()];
        return p;
    }
}
export class FetchFollowers extends FetchPred {
    constructor(/* private */public pk: string, uncached?: boolean) {
        super(uncached);
    }
    filter() { return [{ "#p": [this.pk], kinds: [Kind.Contacts] /* no limit... nostr-filter? */ }]; };
    merge(other: FetchPred) {
        // if (!(other instanceof FetchFollowers)) return null;
        return null;
    }
}

type FetchWill = {
    pred: FetchPred;
    onEvent?: (receives: DeletableEvent[]) => void;
    onEnd?: () => void;
};

// XXX: you may think eose as {ok:[],ng:[]} but consider just a kind5 with all-known. nah.
type VerifiedHandler = (result: {
    ok: Set<DeletableEvent>;
    ng: Event[];
} | null) => void;

type SubHandlers = {
    onEvent: (receives: EventMessageFromRelay[]) => void | Promise<void>;
    onEose?: () => void | Promise<void>;
};

// MuxPool with mutating note pool of subs, maintaining relays/subs in idenpotent style.
export class NostrWorker {
    mux = new MuxPool();
    relays = new Map<string, RelayWithMode>();
    subs = new Map<string, { sid: ReturnType<MuxPool["sub"]>; filters: FilledFilters; handlers: SubHandlers; } | { sid: null; filters: null; }>();
    exsubs = new Map<string, FilledFilters | null>();
    insubs = new Map<string, { filters: FilledFilters | null; handlers: SubHandlers; }>();
    // TODO: GC/LRUify events and posts. copy-gc from postStreams?
    events = new Map<string, DeletableEvent>();
    posts = new Map<string, Post>();
    nunreads = 0;
    postStreams = new Map<string, { posts: Post[], eose: boolean, nunreads: number; }>(); // order by created_at ASC,id DESC TODO: also received_at for LRU considering fetching older post that is mentioned?
    pubkey: string | null = null;
    profiles = new Map<string, ProfileEvents>();
    profsid: ReturnType<MuxPool["sub"]> | null = null;
    onHealthy = new SimpleEmitter<MuxRelayEvent>();
    onMyContacts = new SimpleEmitter<DeletableEvent>();
    onMyRelayList = new SimpleEmitter<DeletableEvent>();
    onMyMetadata = new SimpleEmitter<DeletableEvent>();
    onAuth = new SimpleEmitter<{ relay: Relay; challenge: string; }>();
    onNotice = new SimpleEmitter<{ relay: Relay; msg: string; }>();
    onFetch = new SimpleEmitter<{ length: number; }>();
    onSetSubscribes = new SimpleEmitter<{}>();
    recentNotices = new Map<Relay, { msg: string, receivedAt: number; }[]>();
    receiveEmitter = new Map<string, SimpleEmitter<NostrWorkerListenerMessage>>();
    verifyq: { receivedAt: number; messages: EventMessageFromRelay[] | null; onVerified: VerifiedHandler; }[] = [];
    fetchq: FetchWill[] = [];

    constructor() {
        this.mux.on("health", ({ relay, event, reason }) => {
            this.onHealthy.emit("", { mux: this.mux, relay, event, reason });
        });
        this.mux.on("auth", ev => {
            // TODO: some auth?
            this.onAuth.emit("", ev);
        });
        this.mux.on("notice", ev => {
            const rns = getmk(this.recentNotices, ev.relay, () => []);
            rns.splice(4);
            rns.unshift({ msg: ev.msg, receivedAt: Date.now() });
            this.onNotice.emit("", ev);
        });
    }
    getRelays() {
        return this.getLivingRelays().map(r => ({
            ...r,
            healthy: r.relay.relay.status === WebSocket.OPEN,
            recentNotices: this.recentNotices.get(r.relay.relay) || [],
        }));
    }
    setRelays(newrelays: { url: string, read: boolean, write: boolean; }[]) {
        const pre = new Map(this.getLivingRelays().map(r => [r.url, r]));
        const cur = new Map(newrelays.map(r => [r.url, r]));

        for (const [url, relopt] of cur.entries()) {
            const rly = pre.get(url);
            if (rly) {
                // modified
                rly.read = relopt.read;
                rly.write = relopt.write;
                rly.relay.wantweak();
            } else {
                // added
                const relay = this.mux.getrelay(relopt.url);
                const rm: RelayWithMode = { relay: relay, url, read: relopt.read, write: relopt.write };
                this.relays.set(relopt.url, rm);
                relay.wantweak();  // need for booting
            }
        }

        // removed
        for (const url of pre.keys()) {
            if (cur.has(url)) continue;

            // XXX: (immediate) close? or forget()?
            //      we close now for give priority to reduce transport cost.
            this.mux.close([url]);
        }

        // update subs
        // TODO: relays per sid... what to do?
        this.subs.forEach(({ sid, filters }) => filters?.every(f => !f.relays) && sid?.sub(
            this.getLivingRelays().filter(r => r.read).map(r => r.url),
            null,
        ));
    }
    setIdentity(pubkey: string | null) {
        this.pubkey = pubkey;

        // TODO: myaction should be wiped if pubkey changed
        // TODO: recent, reply, etc. should be wiped if pubkey changed, but it is callers resp?

        // getProfile is oneshot. but need continuous...
        // this.getProfile(pubkey, Kind.Contacts).catch(console.error);
        const insubs: [string, { filters: FilledFilters | null; handlers: SubHandlers; }][] =
            !pubkey
                ? []
                : [["_myprofile", {
                    filters: [{
                        authors: [pubkey],
                        kinds: [Kind.Contacts, Kind.RelayList, Kind.Metadata],
                        // limit: 1,  // for each relay. some relays (ex. nostr-filter) notice "limit must be <=500"
                    }],
                    handlers: {
                        onEvent: receives => this.enqueueVerify(receives, r => {
                            if (!r) return;
                            for (const dev of r.ok.values()) {
                                const ev = dev.event?.event;
                                if (!ev) continue;
                                if (ev.pubkey !== pubkey || ![Kind.Contacts, Kind.RelayList, Kind.Metadata].includes(ev.kind)) {
                                    // !?
                                    continue;
                                }
                                const newer = this.putProfile(dev);
                                if (!newer) continue;
                                // if eosed?
                                if (ev.kind === Kind.Contacts) {
                                    this.onMyContacts.emit("", dev);
                                }
                                if (ev.kind === Kind.RelayList) {
                                    this.onMyRelayList.emit("", dev);
                                }
                                if (ev.kind === Kind.Metadata) {
                                    this.onMyMetadata.emit("", dev);
                                }
                            }
                        }),
                        // onEose: () => this.enqueueVerify(null, r => {
                        //     const dev = this.profiles.get(pubkey)?.contacts;
                        //     if (dev) {
                        //         this.onMyContacts.emit(dev);
                        //         eosed = true;
                        //     }
                        // }),
                    }
                }]];
        // XXX: sub on here seems ugly
        this.setInSubscribes(new Map(insubs));
    }
    getIdentity() {
        if (!this.pubkey) return null;
        const profs = this.profiles.get(this.pubkey);
        if (!profs) return null;
        return {
            ...profs,
            pubkey: this.pubkey,
        };
    }
    // must return arrays in predictable order to easier deep-compare.
    getFilter(type: "recent" | "reply" | "dm" | "favs"): FilledFilters | null {
        switch (type) {
            case "recent": {
                if (!this.pubkey) {
                    return null;
                }
                const followingpks = this.profiles.get(this.pubkey)?.contacts?.event?.event?.event?.tags?.filter(t => t[0] === "p")?.map(t => t[1]) || [];
                return [
                    // my events and following events
                    // following events but we don't need their reactions
                    {
                        authors: uniq([this.pubkey, ...followingpks].sort()),
                        kinds: [Kind.Text, Kind.EventDeletion, Kind.Repost],
                        limit: 100,
                    },
                    // reply to (tagged) me XXX: duped "reply"
                    {
                        "#p": [this.pubkey],
                        kinds: [Kind.Text, Kind.EventDeletion, Kind.Repost],
                        limit: 30,
                    },
                    // and my reactions (duped with "favs")
                    {
                        authors: [this.pubkey],
                        kinds: [Kind.Reaction],
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
                        kinds: [Kind.Text, Kind.EventDeletion, Kind.Zap],
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
                        kinds: [Kind.EncryptedDirectMessage],
                        limit: 30,
                    },
                    {
                        "#p": [this.pubkey],
                        kinds: [Kind.EncryptedDirectMessage],
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
                        kinds: [Kind.Reaction],
                        limit: 30,
                    },
                ];
            }
            default:
                throw new Error(`invariant failed: unknown filter type ${type}`);
        }
    }
    setSubscribes(subs: Map<string, FilledFilters | null>) {
        this.exsubs = subs;
        this.updateSubscribes();
        this.onSetSubscribes.emit("", {});
    }
    private setInSubscribes(subs: Map<string, { filters: FilledFilters | null; handlers: SubHandlers; }>) {
        this.insubs = subs;
        this.updateSubscribes();
    }
    private updateSubscribes() {
        const subs = new Map<string, { filters: FilledFilters | null; handlers: SubHandlers; }>();
        for (const [name, filters] of this.exsubs) {
            subs.set(name, {
                filters,
                handlers: {
                    onEvent: receives => this.enqueueVerify(receives, async r => {
                        invariant(r);
                        this.delevToPost(name, r.ok);
                    }),
                    onEose: () => this.enqueueVerify(null, r => {
                        invariant(!r);
                        this.receiveEmitter.get(name)?.emit("", { name, type: "eose" });
                    })
                },
            });
        }
        for (const [name, fandh] of this.insubs.entries()) {
            subs.set(name, fandh);
        }

        for (const [name, sub] of this.subs.entries()) {
            if (subs.has(name)) continue;

            // removed
            if (sub.filters) {
                sub.sid.unsub();
            }
            this.subs.delete(name);
            this.postStreams.delete(name);
        }

        for (const [name, fandh] of subs.entries()) {
            const sub = this.subs.get(name);
            if (sub) {
                // existing: unsub only if filters is changed. (noop, keep sub if not changed)
                if ((!sub.filters && !fandh.filters) || (sub.filters && fandh.filters && filtereq(sub.filters, fandh.filters))) {
                    if (sub.sid) {
                        sub.sid.off("event", sub.handlers.onEvent);
                        if (sub.handlers.onEose) {
                            sub.sid.off("eose", sub.handlers.onEose);
                        }

                        sub.sid.on("event", fandh.handlers.onEvent);
                        if (fandh.handlers.onEose) {
                            sub.sid.on("eose", fandh.handlers.onEose);
                        }
                    }
                    if (sub.filters) {
                        sub.handlers.onEvent = fandh.handlers.onEvent;
                        sub.handlers.onEose = fandh.handlers.onEose;
                    }

                    continue;
                }

                // changed; unsubscribe to override (nostr protocol supports override but nostr-mux silently rejects it)
                if (sub.filters) {
                    sub.sid.unsub();
                }
            } else {
                // new
                this.postStreams.set(name, { posts: [], eose: false, nunreads: 0 });
            }

            const su = (() => {
                if (!fandh.filters) return { filters: null, sid: null };

                const relays = fandh.filters.reduce<string[]>((p, { relays }) => !relays ? p : Array.isArray(relays) ? relays : [relays], this.getLivingRelays().filter(r => r.read).map(r => r.url));
                const sid = this.mux.sub(
                    relays,
                    fandh.filters.map(({ relays, mute, ...rest }) => rest),
                    { skipVerification: true },  // don't do this on nostr-tools' Pool/Relay; this is vulnerable for knownIds/seenOn
                );
                sid.on("event", fandh.handlers.onEvent);
                if (fandh.handlers.onEose) {
                    sid.on("eose", fandh.handlers.onEose);
                }
                return {
                    filters: fandh.filters,
                    handlers: fandh.handlers,
                    sid,
                };
            })();
            this.subs.set(name, su);
        }
    }
    getSubscribeFilters(name: string) {
        return this.subs.get(name)?.filters;
    }
    getAllPosts() {
        return this.posts;
    }
    getPostStream(name: string) {
        return this.postStreams.get(name);
    }
    postEvent(ev: Event, forcerelays?: string[]) {
        if (!verifySignature(ev)) throw new Error(`event not valid: ${JSON.stringify(ev)}`);
        const relays = forcerelays
            ? forcerelays.map(url => {
                const r = this.mux.getrelay(url);
                r.wantweak();
                return r;
            })
            : this.getLivingRelays().filter(r => r.write).map(r => r.relay);
        return {
            relays,
            pub: this.mux.publish(relays.map(r => r.relay.url), ev),
        };
    }
    addListener(name: string, fn: (msg: NostrWorkerListenerMessage) => void) {
        const emitter = this.receiveEmitter.get(name) || new SimpleEmitter();
        this.receiveEmitter.set(name, emitter);
        emitter.on("", fn);
    }
    removeListener(name: string, fn: (msg: NostrWorkerListenerMessage) => void) {
        const emitter = this.receiveEmitter.get(name);
        if (!emitter) {
            return;
        }
        emitter.off("", fn);
    }
    enqueueFetchEventFor(fetches: FetchWill[]) {
        const first = this.fetchq.length === 0;
        this.fetchq.push(...fetches);
        if (first) {
            this.fetchEvent().catch(e => {
                console.error(e);
                this.fetchq.splice(0);
            });
        }
    }
    fetchqlen() {
        return this.fetchq.length;
    }
    getPost(id: string) {
        return this.posts.get(id);
    }
    getDelev(id: string) {
        return this.events.get(id);
    }
    overwritePosts(name: string, posts: Post[]) {
        const strm = getmk(this.postStreams, name, () => ({ posts: [], eose: false, nunreads: 0 }));
        strm.posts.splice(0, strm.posts.length, ...posts);
        strm.nunreads = posts.reduce((p, c) => p + (c.hasread ? 1 : 0), 0);
    }
    setHasread(spec: { id: string; } | { stream: string; beforeIndex: number; } | { stream: string; afterIndex: number; }, hasRead: boolean) {
        const dhr = hasRead ? -1 : 1;
        if ("id" in spec) {
            const post = this.posts.get(spec.id);
            if (!post) {
                return;
            }
            if (post.hasread === hasRead) {
                return;
            }
            const ev = post.event?.event?.event;
            if (!ev) {
                return;
            }

            post.hasread = hasRead;
            this.nunreads += dhr;

            for (const [name, tab] of this.postStreams.entries()) {
                const cursor = postindex(tab.posts, ev);
                if (cursor === null) {
                    continue;
                }
                tab.nunreads += dhr;
                this.receiveEmitter.get(name)?.emit("", { name, type: "hasread", hasRead, posts: [post] });
            }
            return;
        }
        if ("stream" in spec) {
            const strm = this.postStreams.get(spec.stream);
            if (!strm) return;
            const posts = strm.posts;
            let i: number;
            let e: number;
            const l = posts.length;
            if ("beforeIndex" in spec) { i = 0; e = Math.min(spec.beforeIndex, l); }
            else { i = spec.afterIndex + 1; e = l; }
            const changed = [];
            // TODO: unread other streams is N*M. we currently re-scan later but it is slow.
            for (; i < e; i++) {
                if (posts[i].hasread === hasRead) continue;
                posts[i].hasread = hasRead;
                // strm.nunreads += dhr;
                this.nunreads += dhr;
                changed.push(posts[i]);
            }
            if (0 < changed.length) {
                this.receiveEmitter.get(spec.stream)?.emit("", { name: spec.stream, type: "hasread", hasRead, posts: changed });

                for (const [name, s] of this.postStreams.entries()) {
                    if (name === spec.stream) continue;
                    const nunrs = s.posts.reduce((p, c) => p + (c.hasread ? 0 : 1), 0);
                    if (s.nunreads !== nunrs) {
                        s.nunreads = nunrs;
                        // FIXME: posts is empty...
                        this.receiveEmitter.get(name)?.emit("", { name, type: "hasread", hasRead, posts: [] });
                    }
                }
            }
        }
    }
    tryGetProfile(pk: string, kind: typeof Kind[keyof typeof Kind]) {
        return this.profiles.get(pk)?.[this.profkey(kind)];
    }
    getProfile(pk: string, kind: typeof Kind[keyof typeof Kind], onEvent: (ev: DeletableEvent) => void, onEnd?: () => void, ttl?: number): DeletableEvent | null {
        const profkey = this.profkey(kind);
        const pcache = this.profiles.get(pk)?.[profkey];
        if (pcache && Date.now() < pcache.fetchedAt + (ttl ?? Infinity)) {
            return pcache.event;
        }

        const pred = (() => {
            switch (kind) {
                case Kind.Metadata: return new FetchProfile(pk, true);
                case Kind.Contacts: return new FetchContacts(pk, true);
                // case Kind.RelayList: return new FetchRelays(key, true);
                default: throw new Error(`getprofile pred not supported ${kind}: ${pk}`);
            }
        })();
        this.enqueueFetchEventFor([{
            pred,
            onEvent: (evs: DeletableEvent[]) => {
                for (const ev of evs) {
                    this.putProfile(ev);
                }
                const pcache = this.profiles.get(pk)?.[profkey];
                if (pcache?.event) {
                    onEvent(pcache.event);
                }
            },
            onEnd: () => {
                const pf = getmk(this.profiles, pk, () => ({ profile: null, contacts: null, relays: null }));
                const pcache = pf[profkey];
                if (!pcache) {
                    pf[profkey] = { event: null, fetchedAt: Date.now() };
                }
                onEnd?.();
            },
        }]);

        // stale-while-revalidate
        return pcache?.event || null;
    }

    private getLivingRelays() {
        return [...this.relays.values()].filter(r => r.relay.wantonline || r.relay.relay.status !== WebSocket.CLOSED);
    }

    private putProfile(event: DeletableEvent): boolean {
        if (!event.event) return false;
        const ev = event.event.event;
        const pf = getmk(this.profiles, ev.pubkey, () => ({ profile: null, contacts: null, relays: null }));
        const k = this.profkey(ev.kind);
        const knownev = pf[k]?.event?.event?.event;
        // drop older. accept same for renewing fetchedAt
        if (knownev && ev.created_at < knownev.created_at) return false;
        pf[k] = { event, fetchedAt: Date.now() };
        return true;
    }

    private profkey(kind: number): keyof ProfileEvents {
        switch (kind) {
            case Kind.Metadata: return "profile";
            case Kind.Contacts: return "contacts";
            case Kind.RelayList: return "relays";
            default: throw new Error(`profkey with unknown kind ${kind}`);
        }
    }

    private async fetchEvent() {
        while (this.fetchq.length) {
            let i = 0;
            const l = this.fetchq.length;
            const wills: (FetchWill & { filters: Filter[]; })[] = [];
            const predsbag = new Map<string, FetchPred[]>();
            let nfilters = 0;
            for (; i < l; i++) {
                const f = this.fetchq[i];

                // cached?
                // TODO: cache checking in derivatives of FetchPred
                if (f.pred instanceof FetchId && !f.pred.uncached) {
                    const dev = this.events.get(f.pred.ids[0]);
                    if (dev) {
                        // return if it is not deleted, or id is kind5 event itself
                        if ((dev?.event && !dev?.deleteevent) || dev.deleteevent?.event?.id === f.pred.ids[0]) {
                            f.onEvent?.([dev]);
                            f.onEnd?.();
                        }
                        continue;
                    }
                }
                // XXX: this intros mergeability of prof/contact/relays...?
                if (f.pred instanceof FetchProfile && !f.pred.uncached) {
                    const prof = this.profiles.get(f.pred.pks[0])?.profile;
                    if (prof) {
                        if (prof.event?.event && !prof.event?.deleteevent) {
                            f.onEvent?.([prof.event]);
                        }
                        f.onEnd?.();
                        continue;
                    }
                }
                if (f.pred instanceof FetchContacts && !f.pred.uncached) {
                    const cont = this.profiles.get(f.pred.pks[0])?.contacts;
                    if (cont) {
                        if (cont.event?.event && !cont.event?.deleteevent) {
                            f.onEvent?.([cont.event]);
                        }
                        f.onEnd?.();
                        continue;
                    }
                }
                // no cache for FetchFollowers

                const preds = predsbag.get(f.pred.constructor.name) || [];
                const plast = preds[preds.length - 1];
                const merged = plast?.merge(f.pred);
                if (merged) {
                    preds[preds.length - 1] = merged;
                } else {
                    nfilters++;
                    // any relay must accept these many filters...
                    if (20 < nfilters) {
                        break;
                    }
                    preds.push(f.pred);
                }
                wills.push({ ...f, filters: f.pred.filter() });
                // we don't want set if nfilters over (with empty preds), so we can't getmk()
                predsbag.set(f.pred.constructor.name, preds);
            }

            if (0 < predsbag.size) {
                await new Promise<void>((resolve, reject) => {
                    let sid: ReturnType<MuxPool["sub"]>;
                    // TODO: use list() instead of sub()?
                    sid = this.mux.sub(
                        this.getLivingRelays().filter(r => r.read).map(r => r.url),
                        [...predsbag.values()].flatMap(e => e.flatMap(f => f.filter())) as FilledFilters,
                        { skipVerification: true },  // FIXME: this is vulnerable for knownIds/seenOn
                    );
                    sid.on("event", receives => this.enqueueVerify(receives, async r => {
                        try {
                            invariant(r);
                            const one = new Map<(receives: DeletableEvent[]) => void, DeletableEvent[]>();
                            for (const ev of r.ok.values()) {
                                const eve = ev.event;
                                if (!eve) continue; // just delete event

                                // umm O(NM)
                                const ms = wills.filter(f => f.filters.some(g => matchFilter(g, eve.event)));
                                for (const w of ms) {
                                    if (w.onEvent) {
                                        getmk(one, w.onEvent, () => []).push(ev);
                                    }
                                }
                            }
                            for (const [f, evs] of one.entries()) {
                                f(evs);
                            }
                        } catch (e) { reject(e); }
                    }));
                    sid.on("eose", () => this.enqueueVerify(null, r => {
                        try {
                            invariant(!r);
                            for (const w of wills) {
                                w.onEnd?.();
                            }
                            sid.unsub();
                            resolve();
                        } catch (e) { reject(e); }
                    }));
                });
            }
            this.fetchq.splice(0, i);
            this.onFetch.emit("", { length: this.fetchq.length });
        }
    }

    private delevToPost(name: string, okrecv: Set<DeletableEvent>) {
        // TODO: repost/reaction target fetching

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

            // FIXME: when we recv deleter->deletee in an instant which deleter matches filter but deletee is not, we accidentally adds to posts.
            //        so we should check matchFilter the recv.event...

            const post = getmk(this.posts, pid, () => ({
                id: pid,
                event: null,
                reposttarget: null,
                myreaction: null,
                hasread: false,
            }));

            posted.push(post);
            const wasempty = !post.event;

            if (recv.event.event.kind === Kind.Repost || recv.event.event.kind === 16 as Kind/* FIXME nostr-tools */) {
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
            } else if (recv.event.event.kind === Kind.Reaction) {
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
            this.receiveEmitter.get(name)?.emit("", { name, type: "event", events: okevs, posts: posted });
        }
    }

    enqueueVerify(messages: EventMessageFromRelay[] | null, onVerified: VerifiedHandler) {
        const first = this.verifyq.length === 0;
        this.verifyq.push({ receivedAt: Date.now(), messages, onVerified });
        if (first) {
            this.verifyMessages().catch(e => {
                // bailout
                console.error(e);
                this.verifyq.forEach(v => {
                    try {
                        v.onVerified(null);
                    } catch (e) {
                        console.error(e);
                    }
                });
                this.verifyq.splice(0);
            });
        }
    }

    private async verifyMessages() {
        while (this.verifyq.length) {
            // peek not pop to avoid launch receive proc while processing last.
            const v = this.verifyq[0];
            if (v.messages) {
                const r = await this.msgsToDelableEvent(v.receivedAt, v.messages);
                v.onVerified(r);
            } else {
                v.onVerified(null);
            }

            this.verifyq.splice(0, 1);
        }
    }

    private async msgsToDelableEvent(receivedAt: number, messages: EventMessageFromRelay[]) {
        // TODO: we may can use batch schnorr verify (if library supports) but bothered if some fail.
        const ok = new Set<DeletableEvent>;
        const ng = [];
        for (const { event, relay } of messages) {
            // TODO: unify these del,post,repost.
            if (event.kind === Kind.EventDeletion) {
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
                        getmk(dev.deleteevent.receivedfrom, relay, () => receivedAt);
                        ok.add(dev); // update my tab too
                    } else {
                        ng.push(event);
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
                    // this is not a badrecv.
                    // TODO: remember to events and make fastpath-able?
                    continue;
                }

                // TODO: this can be async... nostr-tools only exports sync ver.
                if (!verifySignature(event)) {
                    // TODO: invalid sig!?
                    ng.push(event);
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

                        // keep tdev.

                        // delete kind5 link
                        this.events.delete(event.id);
                        ng.push(event); // XXX: what if this kind5 contain both ok and bad??

                        continue;
                    }

                    this.events.set(event.id, tdev); // delete->dev map

                    tdev.deleteevent ||= {
                        event,
                        receivedfrom: new Map(),
                    };
                    getmk(tdev.deleteevent.receivedfrom, relay, () => receivedAt);

                    // delete event is for multi events...
                    // put to okrecv? but not kind6 subevent??
                    ok.add(tdev);
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
                        getmk(dev.event.receivedfrom, relay, () => receivedAt);
                        ok.add(dev); // update my tab too
                    } else {
                        ng.push(event);
                    }
                    continue;
                }

                if (!verifySignature(event)) {
                    // TODO: invalid sig!?
                    ng.push(event);
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
                    receivedfrom: new Map(),
                };
                getmk(tdev.event.receivedfrom, relay, () => receivedAt);

                if (tdev.deleteevent && tdev.deleteevent.event.pubkey !== event.pubkey) {
                    // reject liar on first receive. nullify the delete event.
                    // FIXME: NIP-26 (as of 2023-04-13) states that delegator has a power to delete delegatee event.
                    //        this logic also prohibit that... but treating it needs more complex...
                    // XXX: badrecv?
                    // TODO: should log before null?
                    this.events.delete(tdev.deleteevent.event.id);
                    tdev.deleteevent = null;
                    // fallthrough
                }

                ok.add(tdev);

                // hack: repost.
                //       verify and remember as events but not okrecv to not pop up as originated (not reposted)
                if ([Kind.Repost, 16 as Kind/* FIXME nostr-tools */].includes(event.kind)) {
                    const subevent: unknown = rescue(() => JSON.parse(event.content), undefined);
                    if (!subevent) {
                        continue;
                    }

                    if (!validateCompleteEvent(subevent)) {
                        // does not form of an Event...
                        // even not a badrecv.
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
                            getmk(sdev.event.receivedfrom, relay, () => receivedAt);
                            // but no okrecv.
                        }
                        // else badrecv?
                        continue;
                    }

                    if (!verifySignature(subevent)) {
                        // TODO: invalid sig...
                        // badrecv?
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
                        receivedfrom: new Map(),
                    };
                    getmk(stdev.event.receivedfrom, relay, () => receivedAt);  // really received from?

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
        return { ok, ng };
    }
}

const GlobalNostrWorker = new NostrWorker();
const NostrWorkerContext = createContext<NostrWorker | null>(null);
export const NostrWorkerProvider: FC<PropsWithChildren<{}>> = ({ children }) => {
    return <NostrWorkerContext.Provider value={GlobalNostrWorker}>{children}</NostrWorkerContext.Provider>;
};
export const useNostrWorker = () => {
    const wk = useContext(NostrWorkerContext);
    if (!wk) throw new Error("useNostrWorker without NostrWorkerProvider");
    return wk;
};
