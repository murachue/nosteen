import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Mux, Relay } from "nostr-mux";
import { DeletableEvent } from "./types";

type Events = {
    byCreatedAt: DeletableEvent[];
    byEventId: Map<string, DeletableEvent>;
};

const emptyEvents = { byCreatedAt: [], byEventId: new Map() };
const emptyTab = { events: emptyEvents, selected: 0 } as const;

export default {
    preferences: {
        pubkey: atomWithStorage<string | null>("preferences.pubkey", null),
        relays: atomWithStorage<{
            url: string;
            read: boolean;
            write: boolean;
            public: boolean;
        }[]>("preferences.relays", []),
        colors: {
            normal: atomWithStorage("preferences.colors.normal", "#cccccc"),
            repost: atomWithStorage("preferences.colors.repost", "#44cc44"),
            reacted: atomWithStorage("preferences.colors.reacted", "#cc4444"),
            mypost: atomWithStorage("preferences.colors.mypost", "#000080"),
            replytome: atomWithStorage("preferences.colors.replytome", "#400000"),
            thempost: atomWithStorage("preferences.colors.thempost", "#004000"),
            themreplyto: atomWithStorage("preferences.colors.themreplyto", "#402000"),
        },
    },
    relays: atom(new Map<string, Relay>()),
    relaymux: atom(new Mux()),
    // uh?
    myprofile: atom(Event),
    mycontacts: atom(Event),
    //
    allevents: atom<Events>(emptyEvents),
    tabs: atom<{
        name: string;
        filter: "recent" |
        "reply" |
        "dm" |
        "favs" | Partial<{
            ids: string[];
            authors: string[];
            kinds: number[];
            "#e": string[];
            "#p": string[];
            since: number;
            until: number;
            limit: number;
        }>[];
        events: Events; // contains partial copy of allevents
        selected: number; // or event_id?
    }[]>([
        { ...emptyTab, name: "Recent", filter: "recent" },
        { ...emptyTab, name: "Reply", filter: "reply" },
        { ...emptyTab, name: "DM", filter: "dm" },
        { ...emptyTab, name: "Favs", filter: "favs" },
        {
            ...emptyTab,
            name: "me",
            filter: [
                { authors: ["eeef"], kinds: [1], limit: 20 },
                { "#p": ["eeef"], kinds: [1], limit: 20 },
            ],
        },
    ]),
    activetab: atom(0),
};