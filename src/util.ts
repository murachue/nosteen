import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { Event, nip19 } from "nostr-tools";
import { CSSProperties } from "react";
import { Post } from "./types";

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
    selection.addRange(range);
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
