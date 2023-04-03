import { Relay } from "nostr-mux";

export type Event = {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
};

export type ReceivedEvent = {
    event: Event;
    receivedfrom: Set<Relay>;
};

export type Post = {
    id: string;
    event: ReceivedEvent | null; // null on just got only delete event
    deleteevent: ReceivedEvent | null;
    repostevent: ReceivedEvent | null;
};
