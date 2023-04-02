import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Mux, Relay } from "nostr-mux";
import { AnEvent } from "./types";

type EventList = {
    byCreatedAt: AnEvent[];
    byEventId: Map<string, AnEvent>;
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
            normal: atomWithStorage("preferences.colors.normal", "#ccc"),
            repost: atomWithStorage("preferences.colors.repost", "#4c4"),
            reacted: atomWithStorage("preferences.colors.reacted", "#c22"),
            base: atomWithStorage("preferences.colors.base", "#444"),
            mypost: atomWithStorage("preferences.colors.mypost", "#008"),
            replytome: atomWithStorage("preferences.colors.replytome", "#420"),
            thempost: atomWithStorage("preferences.colors.thempost", "#040"),
            themreplyto: atomWithStorage("preferences.colors.themreplyto", "#400"),
            uitext: atomWithStorage("preferences.colors.uitext", "#000"),
            uibg: atomWithStorage("preferences.colors.uibg", "#ccc"),
            selectedtext: atomWithStorage("preferences.colors.selectedtext", "selecteditemtext"),
            selectedbg: atomWithStorage("preferences.colors.selectedbg", "selecteditem"),
        },
        fonts: {
            text: atomWithStorage("preferences.fonts.text", "1em sans-serif"),
            ui: atomWithStorage("preferences.fonts.ui", "1em ui-sans-serif"),
        },
    },
    relays: atom(new Map<string, Relay>()),
    relaymux: atom(new Mux()),
    // uh?
    myprofile: atom(Event),
    mycontacts: atom(Event),
    //
    allevents: atom(emptyEvents),
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
        events: EventList; // contains partial copy of allevents
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
};
