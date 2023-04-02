export type Event = {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
};

export type InnerEvent = {
    event: Event;
    deleteevent: Event | null;
    repostevent: Event | null;
};
