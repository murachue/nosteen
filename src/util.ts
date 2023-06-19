import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { Event, EventTemplate, finishEvent, nip19, utils } from "nostr-tools";
import { CSSProperties } from "react";
import { ContactsContent, DeletableEvent, MetadataContent, Post } from "./types";
import { MuxPub } from "./pool";
import { NostrWorker } from "./nostrworker";

export const bsearchi = <T>(arr: T[], comp: (x: T) => boolean): number => {
    let left = 0;
    let right = arr.length;

    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (comp(arr[mid])) {
            right = mid;
        } else {
            left = mid + 1;
        }
    }

    return left;
};

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

export const getmk = <K, V>(map: Map<K, V>, key: K, make: () => V) => {
    const val = map.get(key);
    // don't support falsy value
    if (val) {
        return val;
    }

    const newval = make();
    map.set(key, newval);

    return newval;
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

export const rescue = <T>(fn: () => T, rescue: T | ((err: unknown) => T)) => {
    try {
        return fn();
    } catch (err) {
        if (typeof rescue === "function") {
            return (rescue as ((err: unknown) => T))(err); // ugh
        } else {
            return rescue;
        }
    }
};

export const binarystringToUint8array = (bs: string): Uint8Array => {
    const l = bs.length;
    const ab = new Uint8Array(l);
    for (let i = 0; i < l; i++) {
        ab[i] = bs.charCodeAt(i);
    }
    return ab;
};

const utf8encoder = new TextEncoder();
export const sha256str = (str: string) => bytesToHex(sha256(utf8encoder.encode(str)));

export const seleltext = (el: HTMLElement) => {
    // https://stackoverflow.com/a/987376
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    // FIXME: Chrome 114 is ok without setTimeout but Firefox 114 clears selection... with setTimeout both works.
    setTimeout(() => {
        selection.addRange(range);
    }, 0);
};

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

export const NeverMatch = /(?!)/;

export const shortstyle: CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
};

// XXX: it should have true "event" multiplex
export class SimpleEmitter<T> {
    private listeners = new Set<(value: T) => void>();
    on(event: string, fn: (value: T) => void) { this.listeners.add(fn); }
    off(event: string, fn: (value: T) => void) { this.listeners.delete(fn); }
    emit(event: string, value: T) { this.listeners.forEach(fn => fn(value)); }
}
