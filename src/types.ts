import { Event, Filter, Kind } from "nostr-tools";
import { Relay } from "./relay";

export type ReceivedEvent = {
    event: Event;
    receivedfrom: Set<Relay>;
    lastreceivedat: number;
};

export type DeletableEvent = {
    id: string; // event.id, the event can be null when received delete first (then event, or never)
    event: ReceivedEvent | null;
    deleteevent: ReceivedEvent | null; // kind5 may also maintained by this type, but deleting-delete can be ignored as in NIP-09.
};

export type Post = {
    id: string;
    event: DeletableEvent | null; // null on just got only delete event
    reposttarget: DeletableEvent | null; // reposted event; shared by other Posts
    myreaction: DeletableEvent | null; // kind7 may be posted more than 2...? pick first-received one. and it may be dislikes...
    hasread: boolean;
};

export type Filled<T extends unknown[]> = [T[number], ...T];
export type FilledFilters = Filled<Filter[]>;
export type EventMessageFromRelay = { event: Event, relay: Relay; };

export type MetadataContent = {
    // NIP-01
    name?: string;
    about?: string;
    picture?: string;
    // NIP-05
    nip05?: string;
    // de-facto
    display_name?: string;
    banner?: string;
    website?: string;
    lud06?: string;
    lud16?: string;
};

export const Kinds = {
    profile: Kind.Metadata,
    post: Kind.Text,
    contacts: Kind.Contacts,
    dm: Kind.EncryptedDirectMessage,
    delete: Kind.EventDeletion,
    repost: 6,
    reaction: Kind.Reaction,
    relays: Kind.RelayList,
};
