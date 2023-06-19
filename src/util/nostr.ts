import { Event, EventTemplate, finishEvent, nip19, utils } from "nostr-tools";
import { NostrWorker } from "../nostrworker";
import { MuxPub } from "../pool";
import { ContactsContent, DeletableEvent, MetadataContent, Post } from "../types";
import { bsearchi, rescue } from "./pure";

export const postindex = <T extends Post, U extends Event>(posts: T[], event: U): number | null => {
    const evid = event.id;
    const cat = event.created_at;
    const l = posts.length;
    for (
        let i = bsearchi(posts, p => cat <= p.event!.event!.event.created_at);
        i < l && posts[i].event!.event!.event.created_at === cat;
        i++
    ) {
        if (posts[i].event!.event!.event.id === evid) {
            return i;
        }
    }
    return null;
};

export const postupsertindex = <T extends Post, U extends Event>(posts: T[], event: U): { type: "insert" | "update"; index: number; } => {
    const evid = event.id;
    const cat = event.created_at;
    let i = bsearchi(posts, p => cat <= p.event!.event!.event.created_at);
    const l = posts.length;
    while (i < l && posts[i].event!.event!.event.created_at === cat) {
        if (posts[i].event!.event!.event.id === evid) {
            return { type: "update", index: i };
        }
        i++;
    }
    return { type: "insert", index: i };
};

export const expectn = <T extends ReturnType<typeof nip19.decode>["type"]>(s: string, tag: T): (ReturnType<typeof nip19.decode> & { type: T; }) | null => {
    try {
        const d = nip19.decode(s);
        if (d.type !== tag) {
            return null;
        }
        return d as (ReturnType<typeof nip19.decode> & { type: T; }); // cannot type...
    } catch {
        return null;
    }
};

export const reventof = (ev: DeletableEvent) => ev.deleteevent ? null : ev.event;

export const jsoncontent = (ev: DeletableEvent) => rescue(() => JSON.parse(ev.event!.event.content), undefined);

export const metadatajsoncontent = (ev: DeletableEvent): MetadataContent | null => {
    const json = jsoncontent(ev);
    if (typeof json === "object" && json !== null) {
        return json as MetadataContent;
    }
    return null;
};

export const contactsjsoncontent = (ev: DeletableEvent): ContactsContent | null => {
    const json = jsoncontent(ev);
    if (typeof json === "object" && json !== null && Object.values(json).every(v => typeof v === "object" && v !== null)) {
        return json as ContactsContent;
    }
    return null;
};

export type RelayPosts = {
    event: Event;
    postAt: number;
    postByRelay: Map<string, null | { relay: string; recvAt: number; ok: boolean; reason: string; }>;
    pub: MuxPub;
};

export const broadcast = (noswk: NostrWorker, event: Event, onRealize: (repo: RelayPosts) => void, relays?: string[]): RelayPosts => {
    const postAt = Date.now();
    const post = noswk.postEvent(event, relays);

    const repo: RelayPosts = {
        event,
        postAt,
        postByRelay: new Map(post.relays.map(r => [utils.normalizeURL(r.relay.url), null])),
        pub: post.pub,
    };
    post.pub.on("ok", recv => {
        const recvAt = Date.now();
        for (const r of recv) {
            repo.postByRelay.set(utils.normalizeURL(r.relay.url), { relay: r.relay.url, recvAt, ok: true, reason: r.reason });
        }
        onRealize(repo);
    });
    post.pub.on("failed", recv => {
        const recvAt = Date.now();
        repo.postByRelay.set(utils.normalizeURL(recv.relay), { relay: recv.relay, recvAt, ok: false, reason: String(recv.reason) });
        onRealize(repo);
    });
    // TODO: timeout? pub.on("forget", () => { });

    // repo.pub.forget() is callers responsibility.
    return repo;
};

export const signevent = async (account: null | { pubkey: string; } | { privkey: string; }, tev: EventTemplate) => {
    if (account && "privkey" in account) {
        return finishEvent(tev, account.privkey);
    } else if (window.nostr?.signEvent) {
        const sev = await window.nostr.signEvent(tev);
        if (account?.pubkey && sev.pubkey !== account.pubkey) {
            throw new Error(`NIP-07 set unexpected pubkey: pk=${sev.pubkey}, expected=${account.pubkey}`);
        }
        return sev;
    } else {
        throw new Error("could not sign: no private key nor NIP-07 signEvent");
    }
};

export const emitevent = async (noswk: NostrWorker, account: null | { pubkey: string; } | { privkey: string; }, tev: EventTemplate, onRealize: (repo: ReturnType<typeof broadcast>) => void, relays?: string[]) => {
    const event = await signevent(account, tev);
    return broadcast(noswk, event, onRealize, relays);
};
