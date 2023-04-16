import { Emitter, Event, EventMessage, Filter, Mux, Relay, RelayMessageEvent, validateEvent, verifyEvent } from "nostr-mux";
import { SimpleEmitter } from "nostr-mux/dist/core/emitter"; // ugh
import { UnsignedEvent, finishEvent } from "nostr-tools";
import { FC, PropsWithChildren, createContext, useContext } from "react";
import { DeletableEvent, EventMessageFromRelay, FilledEventMessagesFromRelay, FilledFilters, Kinds, Post } from "./types";
import invariant from "tiny-invariant";
import { postupsertindex } from "./util";

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
    const k = e.kind;
    if (k === Kinds.repost) {
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
    }
    if (k === Kinds.reaction) {
        const tid = reactedIdFromTag(e);
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

export class NostrWorker {
    mux = new Mux();
    relays = new Map<string, Relay>();
    subs = new Map<string, { sid: string; filters: FilledFilters; }>();
    // TODO: GC/LRUify events and posts. copy-gc from postStreams?
    events = new Map<string, DeletableEvent>();
    posts = new Map<string, Post>();
    postStreams = new Map<string, Post[]>(); // order by created_at TODO: also received_at for LRU considering fetching older post that is mentioned?
    pubkey: string | null = null;
    profiles = new Map<string, { profile: Event | null, contacts: Event | null; relays: Event | null; }>();
    onHealthy = new SimpleEmitter<MuxRelayEvent>();
    receiveEmitter = new Map<string, Emitter<null>>();
    addq: { name: string, messages: FilledEventMessagesFromRelay; }[] = [];
    fetchq: { filter: Filter, onComplete: (receives: EventMessageFromRelay) => void; }[] = [];

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
        this.pubkey = pubkey;
        // TODO: myaction should be wiped
        // TODO: recent, reply, etc. should be wiped
        // TODO: fetch?
    }
    // must return arrays in predictable order to easier deep-compare.
    getFilter(type: "recent" | "reply" | "dm" | "favs"): FilledFilters | null {
        switch (type) {
            case "recent": {
                if (!this.pubkey) {
                    return null;
                }
                const followingpks = this.profiles.get(this.pubkey)?.contacts?.tags?.filter(t => t[0] === "p")?.map(t => t[1]) || [];
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
                    // and my reactions... processed by "favs" tab
                    // {
                    //     authors: [this.pubkey],
                    //     kinds: [Kinds.reaction],
                    //     limit: 30,
                    // },
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
    setSubscribes(subs: Map<string, FilledFilters>) {
        for (const [name, sub] of this.subs.entries()) {
            if (subs.has(name)) continue;

            // removed
            this.mux.unSubscribe(sub.sid);
            this.subs.delete(name);
        }

        for (const [name, filters] of subs.entries()) {
            const sub = this.subs.get(name);
            if (sub) {
                if (filtereq(sub.filters, filters)) continue;

                // changed; unsubscribe to override (nostr protocol supports override but nostr-mux silently rejects it)
                this.mux.unSubscribe(sub.sid);
            }

            // TODO: we should intro global async verify/add queue?
            const sid = this.mux.subscribe({
                filters: filters,
                enableBuffer: { flushInterval: 50 },
                onEvent: receives => this.onReceive(name, receives),
            });
            this.subs.set(name, {
                filters,
                sid,
            });
        }
    }
    getPostStream(name: string) {
        return this.postStreams.get(name);
    }
    postEvent(etl: UnsignedEvent, sk: string) {
        const ev = finishEvent(etl, sk);
        // TODO
    }
    addListener(name: string, fn: () => void) {
        const emitter = this.receiveEmitter.get(name) || new SimpleEmitter();
        this.receiveEmitter.set(name, emitter);
        emitter.listen(fn);
    }
    removeListener(name: string, fn: () => void) {
        const emitter = this.receiveEmitter.get(name);
        if (!emitter) {
            return;
        }
        emitter.stop(fn);
    }
    enqueueFetchEventFor(filter: Filter, onComplete: (e: EventMessageFromRelay) => void) {
        const first = this.fetchq.length === 0;
        this.fetchq.push({ filter, onComplete });
        if (first) {
            this.fetchEvent().catch(e => {
                console.error(e);
                this.fetchq.splice(0);
            });
        }
    }

    private async fetchEvent() {
        while (this.fetchq.length) {
            let i = 0;
            const l = this.fetchq.length;
            const fetchs = [];
            for (; i < l; i++) {
                const f = this.fetchq[i];

                // cached?
                const ids = f.filter.ids;
                if (ids) {
                    const dev = this.events.get(ids[0])?.event;
                    if (dev?.event) {
                        f.onComplete({ received: { type: "EVENT", subscriptionID: "", event: dev.event }, relay: dev.receivedfrom.values().next().value });
                        continue;
                    }
                }

                fetchs.push(f);
            }

            if (0 < fetchs.length) {
                // this.mux.subscribe({
                //     filters: fetchs.map(e => e.filter) as FilledFilters,
                //     onEvent:,
                //     onEose:,
                //     enableBuffer: { flushInterval: 100 },
                //     eoseTimeout: 3000,
                // });
            }
        }
    }

    private onReceive(name: string, messages: FilledEventMessagesFromRelay) {
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
            await this.receiveOneProc(name, messages);

            this.addq.splice(0, 1);
        }
    }

    private async receiveOneProc(name: string, messages: FilledEventMessagesFromRelay) {
        // TODO: repost/reaction target fetching
        // TODO: we may can use batch schnorr verify (if library supports) but bothered if some fail.

        // first, event (with deletion) layer.
        const okrecv = new Map<string, DeletableEvent>;
        for (const { received: { event }, relay } of messages) {
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
                        // no need to "okrecv" we already done.
                        // TODO: we also do okrecv if we want to update UI on "received from" changed

                        // FIXME: this prohibits event update on multiple tab except first!!
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
                    // all are known; skip
                    // TODO: remember to events and make fastpath-able?
                    continue;
                }

                const r = await verifyEvent(event);
                if (typeof r === "string") {
                    // TODO: invalid sig!?
                    continue;
                }

                for (const did of dels) {
                    const tdev = this.events.get(did) || {
                        id: did,
                        event: null,
                        deleteevent: null,
                    };
                    this.events.set(did, tdev);

                    if (tdev.event && tdev.event.event.pubkey !== event.pubkey) {
                        // reject liar on first receive. ignore this delete event.
                        // FIXME: NIP-26 (as of 2023-04-13) states that delegator has a power to delete delegatee event.
                        //        this logic also prohibit that... but treating it needs more complex...
                        // TODO: should log before null?
                        this.events.delete(event.id);
                        continue;
                    }

                    this.events.set(event.id, tdev); // delete->dev map

                    tdev.deleteevent = {
                        event,
                        receivedfrom: new Set(),
                    };
                    tdev.deleteevent.receivedfrom.add(relay);
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
                        // no need to "okrecv" we already done.
                        // TODO: we also do okrecv if we want to update UI on "received from" changed
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

                tdev.event = {
                    event,
                    receivedfrom: new Set(),
                };
                tdev.event.receivedfrom.add(relay);

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
                        if (event.sig === sdev.event.event.sig) {
                            sdev.event.receivedfrom.add(relay);
                            // no need to "okrecv" we already done.
                            // TODO: we also do okrecv if we want to update UI on "received from" changed
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

                    stdev.event = {
                        event: subevent,
                        receivedfrom: new Set(),
                    };
                    stdev.event.receivedfrom.add(relay); // ?

                    if (stdev.deleteevent && stdev.deleteevent.event.pubkey !== event.pubkey) {
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

        // then post layer.
        const tap = this.postStreams.get(name);
        invariant(tap, `no postStream for ${name}`);
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
            const post = this.posts.get(pid) || {
                id: pid,
                event: null,
                reposttarget: null,
                myreaction: null,
                hasread: false,
            };
            this.posts.set(pid, post);

            if (recv.event.event.kind === Kinds.repost) {
                post.event = recv;
                const target = this.events.get(pid);
                if (target) {
                    post.reposttarget = target;
                } else {
                    // TODO: fetch request with remembering ev.id (repost N:1 target)
                }
            } else if (recv.event.event.kind === Kinds.reaction) {
                if (recv.event.event.pubkey === this.pubkey) {
                    post.myreaction = recv;
                    if (!post.event) {
                        // TODO: fetch request with remembering ev.id (repost N:1 target)
                    }
                }
            } else {
                post.event = recv;
            }

            // to support pop up events like reacting completely unrelated event, we must not premise that "post appears only on event is just filled."
            if (post.event) {
                const cursor = postupsertindex(tap, post.event.event!.event);
                if (cursor.type === "insert") {
                    tap.splice(cursor.index, 0, post);
                }
            }
        }
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
