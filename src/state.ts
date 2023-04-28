import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Mux, Relay } from "nostr-mux";
import { Kinds } from "./types";

const tabstate = () => ({
    selected: null,
    scroll: 0,
    replypath: [],
});
const tabinit: {
    id: string;
    name: string;
    filter: "recent" |
    "reply" |
    "dm" |
    "favs" |
    Partial<{
        ids: string[];
        authors: string[];
        kinds: number[];
        "#e": string[];
        "#p": string[];
        since: number;
        until: number;
        limit: number;
    }>[] |
    null;
    selected: number | null;
    scroll: number;
    replypath: string[];
}[] = [
        { ...tabstate(), id: "recent", name: "Recent", filter: "recent" },
        { ...tabstate(), id: "reply", name: "Reply", filter: "reply" },
        { ...tabstate(), id: "dm", name: "DM", filter: "dm" },
        { ...tabstate(), id: "favs", name: "Favs", filter: "favs" },
        // {
        //     name: "me",
        //     filter: [
        //         { authors: ["eeef"], kinds: [1], limit: 20 },
        //         { "#p": ["eeef"], kinds: [1], limit: 20 },
        //     ],
        //     selected: "",
        // },
        { ...tabstate(), id: "global", name: "global", filter: [{ kinds: [Kinds.post, Kinds.delete, Kinds.repost], limit: 100 }] },
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
            // following: boolean;
            // dm: boolean;
            // publicchat: boolean;
            // global: boolean;
        }[]>("preferences.relays", []),
        colors: {
            normal: atomWithStorage("preferences.colors.normal", "#ccc"),
            repost: atomWithStorage("preferences.colors.repost", "#494"),
            reacted: atomWithStorage("preferences.colors.reacted", "#c22"),
            base: atomWithStorage("preferences.colors.base", "#004"),
            mypost: atomWithStorage("preferences.colors.mypost", "#008"),
            replytome: atomWithStorage("preferences.colors.replytome", "#420"),
            thempost: atomWithStorage("preferences.colors.thempost", "#030"),
            themreplyto: atomWithStorage("preferences.colors.themreplyto", "#400"),
            linktext: atomWithStorage("preferences.colors.linktext", "#77f"),
            uitext: atomWithStorage("preferences.colors.uitext", "#000"),
            uibg: atomWithStorage("preferences.colors.uibg", "#ccc"),
            selectedtext: atomWithStorage("preferences.colors.selectedtext", "selecteditemtext"),
            selectedbg: atomWithStorage("preferences.colors.selectedbg", "selecteditem"),
        },
        fonts: {
            text: atomWithStorage("preferences.fonts.text", "1em sans-serif"),
            ui: atomWithStorage("preferences.fonts.ui", "1em ui-sans-serif"),
        },
        // should be "list" not special "mute"
        // TODO: levels: just user, repost, mention
        mute: {
            userpublic: atomWithStorage<string[]>("preferences.mute.userpublic", []),
            userprivate: atomWithStorage<string[]>("preferences.mute.userprivate", []),
            userlocal: atomWithStorage<string[]>("preferences.mute.userlocal", []),
            regexlocal: atomWithStorage<string[]>("preferences.mute.regexlocal", []),
        },
    },
    // relays: atom(new Map<string, Relay>()),
    relaymux: atom(new Mux()),
    relayinfo: atom({ all: 0, healthy: 0 }),
    // uh?
    myprofile: atom(Event),
    mycontacts: atom(Event),
    //
    // posts: atom({
    //     allevents: new Map<string, DeletableEvent>(),  // to make least verifying
    //     allposts: new Map<string, Post>(),  // Post events contain same Event instances of allevents
    //     bytab: new Map<string, Post[]>(tabinit.map(t => [t.name, []])),  // contains same Post instance of allposts
    // }),
    tabs: atom(tabinit),
    activetab: atom(""),
};
