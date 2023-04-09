import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Mux, Relay } from "nostr-mux";
import { DeletableEvent, Post, ReceivedEvent } from "./types";

const tabinit: {
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
    selected: string;
}[] = [
        { name: "Recent", filter: "recent", selected: "" },
        { name: "Reply", filter: "reply", selected: "" },
        { name: "DM", filter: "dm", selected: "" },
        { name: "Favs", filter: "favs", selected: "" },
        // {
        //     name: "me",
        //     filter: [
        //         { authors: ["eeef"], kinds: [1], limit: 20 },
        //         { "#p": ["eeef"], kinds: [1], limit: 20 },
        //     ],
        //     selected: "",
        // },
        { name: "global", filter: [{ kinds: [1, 6, 7], limit: 20 }], selected: "" },
    ];
export default {
    preferences: {
        account: atomWithStorage<
            null
            | { pubkey: string; }
            | { pubkey: string, privkey: string; }
            | { pubkey: string, nip07: true; }
        >("preferences.pubkey", null),
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
    relayinfo: atom({ all: 0, healthy: 0 }),
    // uh?
    myprofile: atom(Event),
    mycontacts: atom(Event),
    //
    posts: atom({
        allevents: new Map<string, DeletableEvent>(),  // to make least verifying
        allposts: new Map<string, Post>(),  // Post events contain same Event instances of allevents
        bytab: new Map<string, Post[]>(tabinit.map(t => [t.name, []])),  // contains same Post instance of allposts
    }),
    tabs: atom(tabinit),
    activetab: atom(""),
};
