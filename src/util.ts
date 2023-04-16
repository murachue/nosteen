import { WritableDraft } from "immer/dist/internal";
import { Post } from "./types";
import { Event } from "nostr-mux";

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
    for (
        let i = bsearchi(posts, p => cat <= p.event!.event!.event.created_at);
        posts[i].event!.event!.event.created_at === cat;
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
    while (posts[i].event!.event!.event.created_at === cat) {
        if (posts[i].event!.event!.event.id === evid) {
            return { type: "update", index: i };
        }
        i++;
    }
    return { type: "insert", index: i };
};
