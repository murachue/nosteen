import { WritableDraft } from "immer/dist/internal";
import { Event } from "nostr-mux";
import { nip19 } from "nostr-tools";
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

// FIXME: ugh type. how to eliminate WritableDefault?
export const postindex = <T extends Post | WritableDraft<Post>, U extends Event | WritableDraft<Event>>(posts: T[], event: U): number | null => {
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

// FIXME: ugh type. how to eliminate WritableDefault?
export const postupsertindex = <T extends Post | WritableDraft<Post>, U extends Event | WritableDraft<Event>>(posts: T[], event: U): { type: "insert" | "update"; index: number; } => {
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

export const expectn = (s: string, tag: ReturnType<typeof nip19.decode>["type"]) => {
    try {
        const d = nip19.decode(s);
        return d.type === tag;
    } catch {
        return false;
    }
};

export const NeverMatch = /(?!)/;
