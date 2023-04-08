import { Event, Relay } from "nostr-mux";

// export type Event = {
//     id: string;
//     pubkey: string;
//     created_at: number;
//     kind: number;
//     tags: string[][];
//     content: string;
//     sig: string;
// };

export type ReceivedEvent = {
    event: Event;
    receivedfrom: Set<Relay>;
};

export type DeletableEvent = {
    id: string; // event.id, the event can be null when received delete first (then event, or never)
    event: ReceivedEvent | null;
    deleteevent: ReceivedEvent | null; // kind5 may also maintained by this type, but deleting-delete can be ignored as in NIP-09.
};

export type Post = {
    id: string;
    event: DeletableEvent | null; // null on just got only delete event
    reposttargetevent: DeletableEvent | null; // shared by other Posts
    myreactionevent: DeletableEvent | null; // kind7 may be posted more than 2...? pick first-received one. and it may be dislikes...
    hasread: boolean;
};
