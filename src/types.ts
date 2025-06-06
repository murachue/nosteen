import { Event, EventTemplate, Filter, Kind } from "nostr-tools";
import { Relay } from "./relay";

export type ReceivedEvent = {
    event: Event<number>; // FIXME nostr-tools includes 16
    receivedfrom: Map<Relay, number>;
};

// FIXME: rename to EventTwin?
export type DeletableEvent = {
    id: string; // event.id, the event can be null when received delete first (then event, or never)
    event: ReceivedEvent | null;
    deleteevent: ReceivedEvent | null; // kind5 may also maintained by this type, but deleting-delete can be ignored as in NIP-09.
};
// FIXME: rename to DeletableEvent?
export type DellatchEvent = DeletableEvent & { event: NonNullable<DeletableEvent["event"]>; };

export type Post = {
    id: string;
    event: DeletableEvent | null; // null on just got only delete event
    reposttarget: DeletableEvent | null; // reposted event; shared by other Posts
    myreaction: DeletableEvent | null; // kind7 may be posted more than 2...? pick first-received one. and it may be dislikes...
    hasread: boolean;
};

export type Filled<T extends unknown[]> = [T[number], ...T];
export type ExFilter = Filter & {
    relays?: string | string[];
    mute?: boolean;
};
export type FilledFilters = Filled<ExFilter[]>;
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

export type ContactsContent = {
    [url: string]: { read: boolean; write: boolean; };
};

declare global {
    interface Window {
        // NIP-07
        readonly nostr?: {
            getPublicKey(): Promise<string>; // returns a public key as hex
            signEvent(event: /* Event */EventTemplate): Promise<Event>; // takes an event object, adds `id`, `pubkey` and `sig` and returns it
            getRelays?(): Promise<{ [url: string]: { read: boolean, write: boolean; }; }>; // returns a basic map of relay urls to relay policies
            nip04?: {
                encrypt?(pubkey: string, plaintext: string): Promise<string>; // returns ciphertext and iv as specified in nip-04
                decrypt?(pubkey: string, ciphertext: string): Promise<string>; // takes ciphertext and iv as specified in nip-04
            };
        };
    }
}
