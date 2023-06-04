import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Event } from "nostr-tools";
import { IdenticonStore } from "./identicon";
import { MuxPub } from "./pool";

export type Tabdef = {
    id: string;
    name: string;
    filter: "recent" | "reply" | "dm" | "favs" | Partial<{
        ids: string[];
        authors: string[];
        kinds: number[];
        [k: `#${string}`]: string[];
        since: number;
        until: number;
        limit: number;
    }>[] | null;
};
const initTabdef: Tabdef[] = [
    { id: "recent", name: "Recent", filter: "recent" },
    { id: "reply", name: "Reply", filter: "reply" },
    { id: "dm", name: "DM", filter: "dm" },
    { id: "favs", name: "Favs", filter: "favs" },
    // { id: "global", name: "global", filter: [{ kinds: [Kinds.post, Kinds.delete, Kinds.repost], limit: 100 }] },
];

type Tabstate = {
    selected: { id: string | null, index: number | null; };
    scroll: number;
    replypath: string[];
};
export const newtabstate: () => Tabstate = () => ({ selected: { id: null, index: null }, scroll: 0, replypath: [] });

export type RecentPost = {
    desc: string;
    event: Event;
    postAt: number;
    postByRelay: Map<string, {
        relay: string;
        recvAt: number;
        ok: boolean;
        reason: string;
    } | null>;
    pub: MuxPub;
};

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
    tabs: atomWithStorage<Tabdef[]>("tabs", initTabdef),
    tabstates: atom(new Map<string, Tabstate>([])),
    closedTabs: atom<Tabdef[]>([]),
    tabzorder: atom<string[]>([]),
    identiconStore: atom(new IdenticonStore()),
    recentPubs: atom<RecentPost[]>([]),
};
