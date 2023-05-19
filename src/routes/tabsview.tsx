import Identicon from "identicon.js";
import produce from "immer";
import { useAtom } from "jotai";
import { Event, Kind, nip19 } from "nostr-tools";
import { FC, ForwardedRef, forwardRef, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, CSSProperties, memo, ReactHTMLElement } from "react";
import { Helmet } from "react-helmet";
import { Link, useNavigate, useParams } from "react-router-dom";
import ListView, { TBody, TD, TH, TR } from "../components/listview";
import Tab from "../components/tab";
import { MuxRelayEvent, NostrWorker, NostrWorkerListenerMessage, useNostrWorker } from "../nostrworker";
import { Relay } from "../relay";
import state, { Tabdef, newtabstate } from "../state";
import { DeletableEvent, Kinds, MetadataContent, Post } from "../types";
import { NeverMatch, bsearchi, expectn, getmk, postindex, rescue } from "../util";
import TextInput from "../components/textinput";

const jsoncontent = (ev: DeletableEvent) => rescue(() => JSON.parse(ev.event!.event.content), undefined);
const metadatajsoncontent = (ev: DeletableEvent): MetadataContent | null => {
    const json = jsoncontent(ev);
    if (typeof json === "object" && json !== null) {
        return json as MetadataContent;
    }
    return null;
};

const TheRow = /* memo */(forwardRef<HTMLDivElement, { post: Post; mypubkey: string | undefined; selected: Post | null; }>(({ post, mypubkey, selected }, ref) => {
    const noswk = useNostrWorker();
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [colorrepost] = useAtom(state.preferences.colors.repost);
    const [colorreacted] = useAtom(state.preferences.colors.reacted);
    const [colormypost] = useAtom(state.preferences.colors.mypost);
    const [colorreplytome] = useAtom(state.preferences.colors.replytome);
    const [colorthempost] = useAtom(state.preferences.colors.thempost);
    const [colorthemreplyto] = useAtom(state.preferences.colors.themreplyto);
    const [colorselbg] = useAtom(state.preferences.colors.selectedbg);
    const [colorseltext] = useAtom(state.preferences.colors.selectedtext);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [identiconStore] = useAtom(state.identiconStore);

    const ev = post.event!.event!.event;
    const derefev = post.reposttarget || post.event!;

    const [author, setAuthor] = useState(() => {
        const cached = noswk!.getProfile(derefev.event!.event.pubkey, Kinds.profile, ev => setAuthor(metadatajsoncontent(ev)));
        return cached && metadatajsoncontent(cached);
    });
    const [rpauthor, setRpauthor] = useState(() => {
        if (!post.reposttarget) return null;
        const cached = noswk!.getProfile(ev.pubkey, Kinds.profile, ev => setRpauthor(metadatajsoncontent(ev)));
        return cached && metadatajsoncontent(cached);
    });

    const [bg, text] = (() => {
        if (post === selected) {
            return [colorselbg, colorseltext];
        }

        let bg = undefined;
        let text = colornormal;

        if (post.event!.event!.event.kind === (6 as Kind)) {
            text = colorrepost;
        }
        if (post.myreaction?.event) {
            text = colorreacted;
            // TODO: also check for reposted
        }

        const evpub = ev.pubkey;
        const evid = ev.id;
        const selev = !selected ? undefined : (selected.reposttarget || selected.event!).event!.event;
        const selpub = selev?.pubkey;
        if (derefev.event!.event.pubkey === selpub) {
            bg = colorthempost;
        }
        if (evpub === mypubkey) {
            bg = colormypost;
        }
        // XXX: O(NM) is heavy
        if (selev && selev.tags.findIndex(t => t[0] === "e" && t[1] === evid) !== -1) {
            bg = colorthemreplyto;
        }
        if (ev.tags.findIndex(t => t[0] === "p" && t[1] === mypubkey) !== -1) {
            bg = colorreplytome;
        }

        return [bg, text];
    })();

    return <div ref={ref} style={{ display: "flex", width: "100%", alignItems: "center", background: bg, color: text, font: fonttext }}>
        <TR>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                    {ev.tags.find(t => t[0] === "p" || t[0] === "e") ? "→" : ""}
                    {post.event!.deleteevent ? "×" : ""}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                    {post.hasread ? "" : "★"}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {<img style={{ maxWidth: "16px" }} src={identiconStore.png(derefev.event!.event.pubkey)} />}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {post.reposttarget
                        ? `${author?.name || post.reposttarget.event!.event.pubkey} (RP: ${rpauthor?.name || ev.pubkey})`
                        : (author?.name || ev.pubkey)
                    }
                </div>
            </TD>
            <TD renderNode={(width, children) => <div style={{ width, position: "relative", alignSelf: "stretch", display: "flex", alignItems: "center" }}>{children}</div>}>
                {/* <div style={{ position: "relative" }}> */}
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {derefev.event!.event.content}
                </div>
                {(() => {
                    const cw = derefev.event!.event.tags.find(t => t[0] === "content-warning");
                    return !cw ? null : <div style={{
                        position: "absolute",
                        top: "0",
                        left: "0",
                        right: "0",
                        bottom: "0",
                        backdropFilter: "blur(0.3em)",
                        display: "flex",
                        alignItems: "center",
                    }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cw[1]}</div>
                    </div>;
                })()}
                {/* </div> */}
            </TD>
        </TR>
    </div>;
}));

const setref = function <T>(ref: ForwardedRef<T> | undefined, value: T | null) {
    if (!ref) return;
    if (typeof ref === "function") {
        ref(value);
        return;
    }
    ref.current = value;
};

// XXX: vscode 1.77.2 highlighting fails if inlined
type TheListProps = {
    posts: Post[];
    mypubkey: string | undefined;
    selection: number | null;
    onSelect?: (i: number) => void;
    onScroll?: React.DOMAttributes<HTMLDivElement>["onScroll"];
    scrollTo?: { pixel: number; } | { index: number; toTop?: boolean; } | { lastIfVisible: boolean; };
};
const TheList = forwardRef<HTMLDivElement, TheListProps>(({ posts, mypubkey, selection, onSelect, onScroll, scrollTo }, ref) => {
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fontui] = useAtom(state.preferences.fonts.ui);
    const selpost = selection !== null ? posts[selection] : null;

    const listref = useRef<HTMLDivElement | null>(null);
    const itemsref = useRef<HTMLDivElement>(null);
    const rowref = useRef<HTMLDivElement>(null);
    const rowh = rowref.current?.offsetHeight || 100; // FIXME: small value make UI slow, but using some fixed value is just wrong.
    const listh = rowh * posts.length;
    const [scrollTop, setScrollTop] = useState(0);
    const [clientHeight, setClientHeight] = useState(0);

    useEffect(() => {
        const listel = listref.current;  // copy current to avoid mutation on cleanup
        if (!listel) return;
        setClientHeight(listel.clientHeight);
        const ro = new ResizeObserver(es => setClientHeight(es[0].target.clientHeight));
        ro.observe(listel);
        return () => { ro.unobserve(listel); };
    }, []);
    useEffect(() => {
        if (!scrollTo) return;
        if ("pixel" in scrollTo) listref.current?.scrollTo(0, scrollTo.pixel);
        if ("index" in scrollTo) {
            const lel = listref.current;
            if (!lel) return;
            const iel = itemsref.current;
            if (!iel) return;

            const ix = scrollTo.index;
            if (ix * rowh < lel.scrollTop) {
                lel.scrollTo(0, ix * rowh);
                return;
            }
            const listScrollBottom = lel.scrollTop + lel.clientHeight;
            const selOffsetBottom = (ix + 1) * rowh + iel.offsetTop;
            // TODO: if toTop, just last also scrolled to top. off-by-one.
            if (listScrollBottom < selOffsetBottom) {
                if (scrollTo.toTop) {
                    lel.scrollTo(0, ix * rowh);
                } else {
                    lel.scrollTo(0, selOffsetBottom - lel.clientHeight);
                }
                return;
            }
        }
        if ("lastIfVisible" in scrollTo) {
            const lel = listref.current;
            if (!lel) {
                return;
            }
            const listScrollBottom = lel.scrollTop + lel.clientHeight;
            const SecondLastOffsetTop = (posts.length - 1) * rowh;
            if (SecondLastOffsetTop < listScrollBottom) {
                lel.scrollTo(0, lel.scrollHeight);
                return;
            }
        }
    }, [scrollTo]);

    return <div style={{ flex: "1 0 0px", height: "0" }}>
        <ListView>
            <div
                ref={el => { listref.current = el; setref(ref, el); }}
                tabIndex={0}
                style={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "scroll", position: "relative" }}
                onScroll={e => {
                    setScrollTop((e.nativeEvent.target as HTMLDivElement).scrollTop);
                    onScroll && onScroll(e);
                }}
            >
                <div style={{ display: "flex", position: "sticky", width: "100%", top: 0, background: coloruibg, zIndex: 1 /* ugh */ }}>
                    <TH>
                        <TD width="20px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>m</div></TD>
                        <TD width="20px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>u</div></TD>
                        <TD width="20px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>icon</div></TD>
                        <TD width="100px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>username</div></TD>
                        <TD width="600px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>text</div></TD>
                    </TH>
                </div>
                <div ref={itemsref} style={{ display: "flex", flexDirection: "column", width: "100%", height: `${listh}px`, position: "relative" }}>
                    {!posts[0] ? null : <div style={{ visibility: "hidden", position: "absolute" }}>
                        <TheRow ref={rowref} post={posts[0]} mypubkey={mypubkey} selected={null} />
                    </div>}
                    <TBody>
                        {posts.slice(Math.floor(scrollTop / rowh), Math.floor(scrollTop + clientHeight) / rowh).map((p, ri) => {
                            const i = ri + Math.floor(scrollTop / rowh);
                            const evid = p.event!.event!.event.id;
                            return <div
                                key={evid}
                                onPointerDown={e => e.isPrimary && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && onSelect && onSelect(i)}
                                style={{ position: "absolute", top: `${rowh * i}px` }}
                            >
                                <TheRow post={p} mypubkey={mypubkey} selected={selpost} />
                            </div>;
                        })}
                    </TBody>
                </div>
            </div>
        </ListView>
    </div>;
});

const timefmt0 = (v: number, t: string) => v.toString().padStart(t.length, "0");
const timefmt = (date: Date, fmt: string) => {
    let str = "";
    const re = /Y+|M+|D+|h+|m+|s+|S+|[^YMDhmsS]+/g;
    while (true) {
        const grp = re.exec(fmt);
        if (!grp) return str;
        const token = grp[0];
        switch (token[0]) {
            case "Y": {
                str += timefmt0(date.getFullYear(), token);
                break;
            }
            case "M": {
                str += timefmt0(date.getMonth() + 1, token);
                break;
            }
            case "D": {
                str += timefmt0(date.getDate(), token);
                break;
            }
            case "h": {
                str += timefmt0(date.getHours(), token);
                break;
            }
            case "m": {
                str += timefmt0(date.getMinutes(), token);
                break;
            }
            case "s": {
                str += timefmt0(date.getSeconds(), token);
                break;
            }
            case "S": {
                str += Math.floor(date.getMilliseconds() / 1000 * (10 ** token.length));
                break;
            }
            default: {
                str += token;
                break;
            }
        }
    }
};

const reltime = (from: number, to: number) => {
    const bidelta = to - from;
    const delta = Math.abs(bidelta);
    return (bidelta < 0 ? "-" : "+") + (() => {
        if (delta < 1000) {
            return `${delta}ms`;
        } else if (delta < 10 * 1000) {
            return `${(delta / 1000).toFixed(2)}s`;
        } else if (delta < 60 * 1000) {
            return `${(delta / 1000).toFixed(1)}s`;
        } else if (delta < 60 * 60 * 1000) {
            return `${(delta / 60 / 1000).toFixed(1)}m`;
        } else if (delta < 24 * 60 * 60 * 1000) {
            return `${(delta / 60 / 60 / 1000).toFixed(1)}h`;
        } else {
            return `${(delta / 24 / 60 / 60 / 1000).toFixed(1)}d`;
        }
    })();
};

class PostStreamWrapper {
    private readonly listeners = new Map<string, Map<(msg: NostrWorkerListenerMessage) => void, (msg: NostrWorkerListenerMessage) => void>>();
    private readonly streams = new Map<string, ReturnType<typeof NostrWorker.prototype.getPostStream>>();
    private readonly emptystream = { posts: [], eose: false, nunreads: 0 }; // fixed reference is important
    private muteusers: RegExp = NeverMatch;
    private mutepatterns: RegExp = NeverMatch;
    constructor(private readonly noswk: NostrWorker) { }
    addListener(name: string, onChange: (msg: NostrWorkerListenerMessage) => void) {
        const listener = (msg: NostrWorkerListenerMessage): void => {
            const { name, type } = msg;
            if (type !== "eose") {
                this.refreshPosts(name);
            }
            onChange(msg);
        };
        getmk(this.listeners, name, () => new Map()).set(onChange, listener);
        this.noswk.addListener(name, listener);
    }
    removeListener(name: string, onChange: (msg: NostrWorkerListenerMessage) => void) {
        const listenersforname = this.listeners.get(name);
        if (!listenersforname) {
            return;
        }
        const listener = listenersforname.get(onChange);
        if (!listener) {
            return;
        }
        this.noswk.removeListener(name, listener);
        listenersforname.delete(onChange);
        if (listenersforname.size === 0) {
            this.streams.delete(name);
        }
    }
    getPostStream(name: string): ReturnType<typeof NostrWorker.prototype.getPostStream> {
        // return cached
        const istream = this.streams.get(name);
        if (istream) {
            return istream;
        }

        return this.refreshPosts(name);
    }
    getAllPosts() {
        // TODO: make immutable and listenable that needs noswk support
        return this.noswk.getAllPosts();
    }
    getNunreads() {
        return this.noswk.nunreads;
    }

    // TODO: impl setHasread considering mutes

    setMutes({ users, regexs }: { users: string[], regexs: string[]; }) {
        // https://stackoverflow.com/a/9213411
        this.muteusers = users.length === 0 ? NeverMatch : new RegExp(users.map(e => `(${e})`).join("|"));
        this.mutepatterns = regexs.length === 0 ? NeverMatch : new RegExp(regexs.map(e => `(${e})`).join("|"));
    }

    refreshPosts(name: string) {
        const stream = this.noswk.getPostStream(name);
        if (!stream) {
            return this.emptystream;
        }
        const filteredPosts = stream.posts.filter(p => {
            const ev = p.event!.event!.event;
            if (this.muteusers.test(ev.pubkey) || this.mutepatterns.test(ev.content)) {
                return false;
            }
            const rpev = p.reposttarget?.event?.event;
            if (rpev && (this.muteusers.test(rpev.pubkey) || this.mutepatterns.test(rpev.content))) {
                return false;
            }
            return true;
        });
        // shallow copy "posts" to notify immutable change
        // FIXME: each element mutates, and that post may not re-rendered
        const news = {
            posts: filteredPosts,
            eose: stream.eose,
            nunreads: filteredPosts.reduce((p, c) => p + (c.hasread ? 0 : 1), 0) /* stream.nunreads */, // TODO: minus mute?
        };
        this.streams.set(name, news);
        return news;
    }
}

const seleltext = (el: HTMLElement) => {
    // https://stackoverflow.com/a/987376
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
};

const spans = (tev: Event): (
    { rawtext: string; type: "url"; href: string; auto: boolean; }
    | { rawtext: string; type: "ref"; tagindex: number; tag: string[] | undefined; text?: string; }
    | { rawtext: string; type: "hashtag"; text: string; tagtext: string | undefined; auto: boolean; }
    | { rawtext: string; type: "nip19"; text: string; auto: boolean; }
    | { rawtext: string; type: "text"; text: string; }
)[] => {
    const text = tev.content;
    const ixs = new Set([0]);
    // TODO: handle domain names? note1asvxwepy2v83mrvfet9yyq0klc4hwsucdn3dlzuvaa9szltw6gqqf5w8p0
    for (const m of text.matchAll(/\bhttps?:\/\/\S+|#\S+|\b(nostr:)?(note|npub|nsec|nevent|nprofile|nrelay|naddr)1[0-9a-z]+/g)) {
        ixs.add(m.index!);
        ixs.add(m.index! + m[0].length);
    }
    ixs.add(text.length);
    const ixa = [...ixs.values()].sort((a, b) => a - b);
    const tspans = Array(ixs.size - 1).fill(0).map((_, i) => text.slice(ixa[i], ixa[i + 1]));
    return tspans.map(t => {
        const murl = t.match(/^https?:\/\/\S+/);
        if (murl) {
            const tag = tev.tags.find(t => t[0] === "r" && t[1] === murl[0]);
            return { rawtext: t, type: "url", href: t, auto: !tag } as const;
        };
        const mref = t.match(/^#\[(\d+)\]/);
        if (mref) {
            const ti = Number(mref[1]);
            const tag = tev.tags[ti] satisfies string[] as string[] | undefined;
            if (tag && tag[0] === "p") return { rawtext: t, type: "ref", tagindex: ti, tag, text: nip19.npubEncode(tag[1]) } as const;
            if (tag && tag[0] === "e") return { rawtext: t, type: "ref", tagindex: ti, tag, text: nip19.noteEncode(tag[1]) } as const;
            return { rawtext: t, type: "ref", tagindex: ti, tag } as const;
        }
        const mhash = t.match(/^#(\S+)/);
        if (mhash) {
            // hashtag t-tag may be normalized to smallcase
            const tag = tev.tags.find(t => t[0] === "t" && t[1].localeCompare(mhash[1]) === 0);
            return { rawtext: t, type: "hashtag", text: mhash[1], tagtext: tag?.[1] || mhash[1], auto: !tag } as const;
        }
        const mnostr = t.match(/^(?:nostr:)?((?:note|npub|nsec|nevent|nprofile|nrelay|naddr)1[0-9a-z]+)/);
        if (mnostr) {
            const tt = ((): (((t: string[]) => boolean) | undefined) => {
                const d = (() => { try { return nip19.decode(mnostr[1]); } catch { return undefined; } })();
                if (!d) return undefined;
                switch (d.type) {
                    case "nprofile": {
                        return t => t[0] === "p" && t[1] === d.data.pubkey;
                    }
                    case "nevent": {
                        return t => t[0] === "e" && t[1] === d.data.id;
                    }
                    case "naddr": {
                        return; // TODO
                    }
                    case "nsec": {
                        return; // TODO
                    }
                    case "npub": {
                        return t => t[0] === "p" && t[1] === d.data;
                    }
                    case "note": {
                        return t => t[0] === "e" && t[1] === d.data;
                    }
                }
                return undefined;
            })();
            const tag = tt && tev.tags.find(tt);
            return { rawtext: t, type: "nip19", text: mnostr[1], auto: !tag } as const;
        }
        return { rawtext: t, type: "text", text: t } as const;
    });
};

const Tabsview: FC<{
    setGlobalOnKeyDown: React.Dispatch<React.SetStateAction<React.DOMAttributes<HTMLDivElement>["onKeyDown"]>>;
    setGlobalOnPointerDown: React.Dispatch<React.SetStateAction<React.DOMAttributes<HTMLDivElement>["onPointerDown"]>>;
}> = ({ setGlobalOnKeyDown, setGlobalOnPointerDown }) => {
    const navigate = useNavigate();
    const data = useParams();
    const tabid = data["*"] || "";
    const [account] = useAtom(state.preferences.account);
    const [tabs, setTabs] = useAtom(state.tabs);
    const [tabstates, setTabstates] = useAtom(state.tabstates);
    const [closedtabs, setClosedtabs] = useAtom(state.closedTabs);
    const [tabzorder, setTabzorder] = useAtom(state.tabzorder);
    const [colorbase] = useAtom(state.preferences.colors.base);
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [colorrepost] = useAtom(state.preferences.colors.repost);
    const [colorlinktext] = useAtom(state.preferences.colors.linktext);
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [fontui] = useAtom(state.preferences.fonts.ui);
    const [muteuserpublic] = useAtom(state.preferences.mute.userpublic);
    const [muteuserprivate] = useAtom(state.preferences.mute.userprivate);
    const [muteuserlocal] = useAtom(state.preferences.mute.userlocal);
    const [muteregexlocal] = useAtom(state.preferences.mute.regexlocal);
    const noswk = useNostrWorker();
    const streams = useMemo(() => noswk && new PostStreamWrapper(noswk), [noswk]);
    const listref = useRef<HTMLDivElement>(null);
    const textref = useRef<HTMLDivElement>(null);
    const [postdraft, setPostdraft] = useState("");
    const posteditor = useRef<HTMLTextAreaElement>(null);
    const [listscrollto, setListscrollto] = useState<Parameters<typeof TheList>[0]["scrollTo"]>(undefined);
    const [evinfopopping, setEvinfopopping] = useState(false);
    const evinfopopref = useRef<HTMLDivElement>(null);
    const [linkpop, setLinkpop] = useState<{ text: string; auto: boolean; }[]>([]);
    const linkpopref = useRef<HTMLDivElement>(null);
    const [linksel, setLinksel] = useState<number | null>(null);
    const linkselref = useRef<HTMLDivElement>(null);
    const [flash, setFlash] = useState<{ msg: string, bang: boolean; } | null>(null);
    const [tryclosetab, setTryclosetab] = useState({ tid: "", time: 0 });
    const [profpopping, setProfpopping] = useState(false);
    const profpopref = useRef<HTMLDivElement>(null);
    const [author, setAuthor] = useState<MetadataContent | null>(null);
    const [rpauthor, setRpauthor] = useState<MetadataContent | null>(null);
    const [prof, setProf] = useState<{ metadata?: DeletableEvent | null; contacts?: DeletableEvent | null; }>({});
    const [tabpopping, setTabpopping] = useState(false);
    const [tabnameedit, setTabnameedit] = useState<string | null>(null);
    const [tabedit, setTabedit] = useState<string>("");
    const tabpopref = useRef<HTMLDivElement>(null);
    const [tabpopsel, setTabpopsel] = useState(-999);
    const [tabpopseldelay, setTabpopseldelay] = useState(-999);  // FIXME: SUPER hacky
    const tabpopselref = useRef<HTMLDivElement>(null);
    const tabnameeditref = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState("status...");

    const relayinfo = useSyncExternalStore(
        useCallback(storeChange => {
            const handler = (ev: MuxRelayEvent): void => storeChange();
            noswk!.onHealthy.on("", handler);
            return () => { noswk!.onHealthy.off("", handler); };
        }, []),
        useCallback((() => {
            let v: { all: number, healthy: number; } | null = null;
            return () => {
                const rs = noswk!.getRelays();
                const all = rs.length;
                const healthy = rs.filter(r => r.healthy).length;
                if (!v || v.all !== all || v.healthy !== healthy) {
                    v = { all, healthy };
                }
                return v;
            };
        })(), [])
    );

    const tab = useCallback(() => {
        const tab = tabs.find(t => t.id === tabid);
        if (tab) {
            if (tabzorder[tabzorder.length - 1] !== tabid) {
                setTabzorder([...tabzorder.filter(t => t !== tabid), tabid]);
            }
            return tab;
        }
        {
            const mp = tabid.match(/^p\/((npub|nprofile)1[a-z0-9]+|[0-9A-Fa-f]{64})$/);
            if (mp) {
                const pk = (() => {
                    if (mp[1].match(/[0-9A-Fa-f]{64}/)) {
                        return mp[1];
                    }
                    const d = (() => { try { return nip19.decode(mp[1]); } catch { return undefined; } })();
                    if (!d) return null;
                    if (d.type === "npub") return d.data;
                    if (d.type === "nprofile") return d.data.pubkey;
                    return null;
                })();
                if (pk) {
                    // TODO: relay from nprofile
                    const newt: Tabdef = {
                        id: `p/${pk}`,
                        name: `p/${pk.slice(0, 8)}`,
                        filter: [{ authors: [pk], kinds: [Kinds.post, Kinds.delete, Kinds.repost], limit: 50 }],
                    };
                    setTabs([...tabs, newt]);
                    setTabstates(produce(draft => { draft.set(newt.id, newtabstate()); }));
                    navigate(`/tab/p/${pk}`, { replace: true });
                    return newt;
                }
            }
        }
        {
            const me = tabid.match(/^e\/((note|nevent)1[a-z0-9]+|[0-9A-Fa-f]{64})$/);
            if (me) {
                const nid = (() => {
                    if (me[1].match(/[0-9A-Fa-f]{64}/)) {
                        return me[1];
                    }
                    const d = (() => { try { return nip19.decode(me[1]); } catch { return undefined; } })();
                    if (!d) return null;
                    if (d.type === "note") return d.data;
                    if (d.type === "nevent") return d.data.id;
                    return null;
                })();
                if (nid) {
                    // TODO: relay from nevent
                    const newt: Tabdef = {
                        id: `e/${nid}`,
                        name: `e/${nid.slice(0, 8)}`,
                        filter: [{ ids: [nid], /* kinds: [Kinds.post], */ limit: 1 }],
                    };
                    setTabs([...tabs, newt]);
                    setTabstates(produce(draft => { draft.set(newt.id, newtabstate()); }));
                    navigate(`/tab/e/${nid}`, { replace: true });
                    return newt;
                }
            }
        }
    }, [tabs, tabid, tabzorder])();

    const tap = useSyncExternalStore(
        useCallback((onStoreChange) => {
            if (!tab) return () => { };
            const onChange = (msg: NostrWorkerListenerMessage) => { msg.type !== "eose" && msg.name === tab.id && onStoreChange(); };
            streams!.addListener(tab.id, onChange);
            return () => streams!.removeListener(tab.id, onChange);
        }, [streams, tab?.id]),
        useCallback(() => {
            if (!tab) return undefined;
            return streams!.getPostStream(tab.id);
        }, [streams, tab?.id]),
    );
    useEffect(() => {
        if (!tab) return;
        const onChange = (msg: NostrWorkerListenerMessage) => {
            if (msg.type !== "event") return;
            if (msg.name !== tab.id) return;
            setListscrollto({ lastIfVisible: true });
        };
        streams!.addListener(tab.id, onChange);
        return () => streams!.removeListener(tab.id, onChange);
    }, [streams, tab?.id]);
    useEffect(() => {
        streams!.setMutes({ users: [...muteuserpublic, ...muteuserprivate, ...muteuserlocal], regexs: muteregexlocal });
    }, [streams, muteuserpublic, muteuserprivate, muteuserlocal, muteregexlocal]);
    const tas = !tab ? undefined : tabstates.get(tab.id);
    const selpost = (tas?.selected ?? null) === null ? undefined : tap?.posts[tas!.selected!];
    const selev = selpost?.event;
    const selrpev = selpost?.reposttarget;
    const onselect = useCallback((i: number, toTop?: boolean) => {
        if (!tab || !tap) return;
        if (tap) {
            noswk!.setHasread({ id: tap.posts[i].id }, true);
        }
        setTabstates(produce(draft => {
            getmk(draft, tab.id, newtabstate).selected = i;
        }));
        setListscrollto({ index: i, toTop });
        textref.current?.scrollTo(0, 0);
    }, [tap, noswk]);
    useEffect(() => {
        if (!tas) return;
        // TODO: when fonttext changes?
        setListscrollto({ pixel: tas.scroll });
    }, [tab?.id]); // !!
    useEffect(() => {
        const el = linkselref.current;
        if (!el) return;
        el.focus();
    }, [linksel]);  // !!
    useEffect(() => {
        // FIXME: SUPER hacky
        setTabpopseldelay(tabpopsel);
    }, [tabpopsel]);
    useEffect(() => {
        const el = tabpopselref.current;
        if (!el) return;
        el.focus();
    }, [tabpopseldelay]);  // !!!!
    useEffect(() => {
        const el = tabnameeditref.current;
        if (!el) return;
        el.focus();
    }, [tabnameedit]);  // !!
    const nextunread = useCallback(() => {
        // TODO: search other tabs, jump to last note of first tab if all tabs has read.
        if (!tap) return false;
        const tapl = tap.posts.length;
        let i: number;
        for (i = 0; i < tapl; i++) {
            if (!tap.posts[i].hasread) {
                break;
            }
        }
        if (i < tapl) {
            onselect(i, true);
        }
        return true;
    }, [tap]);
    const restoretab = useCallback(() => {
        const t = closedtabs[tabpopsel - 1];
        if (!t) {
            debugger;
            return;
        }
        setClosedtabs(produce(draft => { draft.splice(tabpopsel - 1, 1); }));
        setTabpopping(false);
        setTabpopsel(-999);
        setTabs(tabs => [...tabs, t]);
        navigate(`/tab/${t.id}`);
        listref.current?.focus();
    }, [closedtabs, tabpopsel]);
    const overwritetab = useCallback(() => {
        if (!tab) return;
        if (typeof tab.filter === "string" || tab.filter === null) {
            setFlash({ msg: "cannot overwrite this tab", bang: true });
            return;
        }
        setTabpopping(false);
        setTabpopsel(-999);
        setTabs(produce<Tabdef[]>(draft => { draft.find(t => t.id === tab.id)!.filter = JSON.parse(tabedit); }));
        listref.current?.focus();
    }, [tabedit]);
    const newtab = useCallback(() => {
        setTabpopping(false);
        setTabpopsel(-999);
        const id = crypto.randomUUID();
        const t = { id, name: id.slice(0, 8), filter: JSON.parse(tabedit) };
        setTabs([...tabs, t]);
        navigate(`/tab/${t.id}`);
        listref.current?.focus();
    }, [tabs, tabedit]);
    useEffect(() => {
        setGlobalOnKeyDown(() => (e: React.KeyboardEvent<HTMLDivElement>) => {
            const tagName = (((e.target as any).tagName as string) || "").toLowerCase(); // FIXME
            if (tagName === "input" || tagName === "textarea" || tagName === "button") {
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }
            if (e.nativeEvent.isComposing) {
                return;
            }
            if (tabpopping) {
                switch (e.key) {
                    case "Escape": {
                        setTabpopping(false);
                        setTabpopsel(-999);
                        listref.current?.focus();
                        break;
                    }
                    case "j": {
                        if (-2 < tabpopsel) {
                            setTabpopsel(tabpopsel - 1);
                        }
                        break;
                    }
                    case "k": {
                        if (tabpopsel < closedtabs.length) {
                            setTabpopsel(tabpopsel + 1);
                        }
                        break;
                    }
                    case "Enter": {
                        if (tabpopsel === 0) {
                            setTabnameedit(tab!.name);
                        } else if (tabpopsel === -1) {
                            newtab();
                        } else if (tabpopsel === -2) {
                            overwritetab();
                        } else {
                            restoretab();
                        }
                        break;
                    }
                }
                return;
            }
            if (0 < linkpop.length) {
                switch (e.key) {
                    case "Escape": {
                        setLinkpop([]);
                        setLinksel(null);
                        listref.current?.focus();
                        break;
                    }
                    case "j": {
                        if (linksel !== null && linksel < linkpop.length - 1) {
                            setLinksel(linksel + 1);
                        }
                        break;
                    }
                    case "k": {
                        if (linksel !== null && 0 < linksel) {
                            setLinksel(linksel - 1);
                        }
                        break;
                    }
                    case "Enter": {
                        // TODO: full support
                        if (linksel === null) {
                            break;
                        }

                        setLinkpop([]);
                        setLinksel(null);
                        listref.current?.focus();

                        const text = linkpop[linksel].text;
                        if (text.match(/^(npub|nprofile)1/)) {
                            if (!expectn(text, "npub") && !expectn(text, "nprofile")) { break; }
                            navigate(`/tab/p/${text}`);
                            break;
                        }
                        if (text.match(/^(note|nevent)1/)) {
                            if (!expectn(text, "note") && !expectn(text, "nevent")) { break; }
                            navigate(`/tab/e/${text}`);
                            break;
                        }
                        setFlash({ msg: "sorry not supported yet", bang: true });
                        break;
                    }
                }
                return;
            }
            if (profpopping) {
                switch (e.key) {
                    case "Escape": {
                        setProfpopping(false);
                        listref.current?.focus();
                        return;
                    }
                }
                // return;
            }
            if (evinfopopping) {
                switch (e.key) {
                    case "Escape": {
                        setEvinfopopping(false);
                        listref.current?.focus();
                        return;
                    }
                }
                // return;
            }
            switch (e.key) {
                case "a": {
                    if (!tab) break;
                    const i = tabs.indexOf(tab);
                    const n = tabs[i === 0 ? tabs.length - 1 : i - 1].id;
                    navigate(`/tab/${n}`);
                    break;
                }
                case "s": {
                    if (!tab) break;
                    const i = tabs.indexOf(tab);
                    const n = tabs[i === tabs.length - 1 ? 0 : i + 1].id;
                    navigate(`/tab/${n}`);
                    break;
                }
                case "j": {
                    if (!tas || !tap) break;
                    const i = tas.selected === null ? tap.posts.length - 1 : tas.selected + 1;
                    if (i < tap.posts.length) {
                        onselect(i);
                    }
                    break;
                }
                case "k": {
                    if (!tas || !tap) break;
                    const i = tas.selected === null ? tap.posts.length - 1 : tas.selected - 1;
                    if (0 <= i) {
                        onselect(i);
                    }
                    break;
                }
                case "h": {
                    if (!tas || !tap) break;
                    if (tas.selected === null) break;
                    const pk = tap.posts[tas.selected].event!.event!.event.pubkey;
                    for (let i = tas.selected - 1; 0 <= i; i--) {
                        if (tap.posts[i].event!.event!.event.pubkey === pk) {
                            onselect(i);
                            break;
                        }
                    }
                    break;
                }
                case "l": {
                    if (!tas || !tap) break;
                    if (tas.selected === null) break;
                    const l = tap.posts.length;
                    const pk = tap.posts[tas.selected].event!.event!.event.pubkey;
                    for (let i = tas.selected + 1; i < l; i++) {
                        if (tap.posts[i].event!.event!.event.pubkey === pk) {
                            onselect(i);
                            break;
                        }
                    }
                    break;
                }
                case "[": {
                    if (!tas || !tap || !tab) break;
                    if (tas.selected === null) break;
                    // const selpost = tap.posts[tas.selected];
                    if (!selpost) break;  //!?
                    const ev = selpost.reposttarget || selpost.event!;
                    // really last? (if no "reply" marker) NIP-10 states that but...
                    // 2nd? 2/3?? note18h28wvds25vsd8dlujt7p9cu3q5rnwgl47jrmmumhcmw2pxys63q7zee4e
                    const etag = ev.event!.event.tags.reduce<string[] | undefined>((p, c) => c[0] !== "e" ? p : p?.[3] === "reply" ? p : c, undefined);
                    const replye = etag?.[1];
                    if (!replye) break;
                    const lp = noswk!.getPost(replye);
                    if (!lp) break;

                    let rp = [...tas.replypath];
                    const oevid = selpost.event!.id;  // on repost, replypath holds repost itself
                    if (tas.replypath.indexOf(oevid) === -1) {
                        rp = [oevid];
                    }
                    if (rp.indexOf(replye) === -1) {
                        rp.unshift(replye);
                    }
                    setTabstates(produce(draft => { getmk(draft, tab.id, newtabstate).replypath = rp; }));
                    const ei = postindex(tap.posts, lp.event!.event!.event);
                    if (ei === null) break;  // TODO: may move tab? what if already closed?
                    onselect(ei);
                    break;
                }
                case "]": {
                    if (!tas || !tap || !tab) break;
                    if (tas.selected === null) break;
                    // const selpost = tap.posts[tas.selected];
                    if (!selpost) break;  //!?

                    const lid = (() => {
                        const rp = [...tas.replypath];

                        // potentially repost itself have priority
                        const i1 = rp.indexOf(selpost.event!.id);
                        if (i1 !== -1) {
                            const id1 = rp[i1 + 1];
                            if (id1) return id1;
                        }

                        const rtid = selpost.reposttarget?.id;
                        const i2 = !rtid ? -1 : rp.indexOf(rtid);
                        if (i2 !== -1) {
                            const id2 = rp[i2 + 1];
                            if (id2) return id2;
                        }

                        // find next referencing... but sometimes created_at swaps. offset.
                        // note1m4dx8m2tmp3nvpa7s4uav4m7p9h8pxyelxvn3y5j4peemsymvy5svusdte
                        const st = selpost.event!.event!.event.created_at - 60;
                        const si = bsearchi(tap.posts, p => st < p.event!.event!.event.created_at);
                        const l = tap.posts.length;
                        const id = selpost.id;
                        for (let i = si; i < l; i++) {
                            const p = tap.posts[i];
                            if (p.event!.event!.event.tags.find(t => t[0] === "e" && t[1] === id)) {
                                const nrp = (i1 === -1 && i2 === -1) ? [] : rp;
                                nrp.push(p.id);
                                setTabs(produce(draft => { draft.get(tab.id)!.replypath = nrp; }));
                                return p.id;
                            }
                        }

                        return null;
                    })();
                    if (!lid) {
                        // not found
                        break;
                    }

                    const lp = noswk!.getPost(lid);
                    if (!lp) break;
                    const ei = postindex(tap.posts, lp.event!.event!.event);
                    if (ei === null) break;  // TODO: may move tab? what if already closed?
                    onselect(ei);
                    break;
                }
                case "J": {
                    textref.current?.scrollBy(0, 10);
                    break;
                }
                case "K": {
                    textref.current?.scrollBy(0, -10);
                    break;
                }
                case "p": {
                    break;
                }
                case "n": {
                    break;
                }
                case "i": {
                    posteditor.current?.focus();
                    e.preventDefault();
                    break;
                }
                case "g": {
                    if (!tap) break;
                    const i = 0;
                    if (i < tap.posts.length) {
                        onselect(i);
                    }
                    break;
                }
                case "G": {
                    if (!tap) break;
                    const i = tap.posts.length - 1;
                    if (0 <= i) {
                        onselect(i);
                    }
                    break;
                }
                case "H": {
                    break;
                }
                case "M": {
                    break;
                }
                case "L": {
                    break;
                }
                case "e": {
                    if (!selpost) return;

                    const tev = (selrpev || selev!).event!.event;
                    const ss = spans(tev);
                    const specials = ss.filter(s => s.type !== "text");
                    const ls = new Map();
                    specials.forEach(s => {
                        switch (s.type) {
                            case "url": {
                                const text = s.href;
                                ls.set(text, { text, auto: s.auto });
                                break;
                            }
                            case "ref": {
                                const text = s.text || s.tag?.[1] || "";
                                ls.set(text, { text, auto: false });
                                break;
                            }
                            case "hashtag": {
                                const text = `#${s.tagtext || s.text}`;
                                ls.set(text, { text, auto: s.auto });
                                break;
                            }
                            case "nip19": {
                                const text = s.text;
                                ls.set(text, { text, auto: s.auto });
                                break;
                            }
                            case "text": {
                                const text = s.text;
                                ls.set(text, { text, auto: false });
                                break;
                            }
                        }
                    });
                    tev.tags.forEach(t => {
                        switch (t[0]) {
                            case "p": {
                                const text = nip19.npubEncode(t[1]);
                                ls.set(text, { text, auto: false });
                                break;
                            }
                            case "e": {
                                const text = nip19.noteEncode(t[1]);
                                ls.set(text, { text, auto: false });
                                break;
                            }
                            case "t": {
                                // doubled but why? (hashtag span key is tagtext which looks good?)
                                const text = `#${t[1]}`;
                                ls.set(text, { text, auto: false });
                                break;
                            }
                        }
                    });
                    if (0 < ls.size) {
                        // TODO: url first? ev, pub then hashtag?
                        setLinkpop([...ls.values()]);
                        setLinksel(0);
                    }
                    break;
                }
                case "1":
                case "2":
                case "3":
                case "4":
                case "5":
                case "6":
                case "7":
                case "8": {
                    const t = tabs[Number(e.key) - 1];
                    if (t) {
                        navigate(`/tab/${t.id}`);
                    }
                    break;
                }
                case "9": {
                    const t = tabs[tabs.length - 1];
                    navigate(`/tab/${t.id}`);
                    break;
                }
                case " ": {
                    if (nextunread()) {
                        e.preventDefault();
                    }
                    break;
                }
                case "m": {
                    setEvinfopopping(s => !s);
                    break;
                }
                case "b": {
                    if (!tas || !tab) break;
                    if (tas.selected === null) break;
                    // TODO: bug with mute
                    noswk!.setHasread({ stream: tab.id, afterIndex: tas.selected }, false);
                    break;
                }
                case "B": {
                    if (!tas || !tab) break;
                    if (tas.selected === null) break;
                    // TODO: bug with mute
                    noswk!.setHasread({ stream: tab.id, beforeIndex: tas.selected }, true);
                    break;
                }
                case "u": {
                    setProfpopping(s => !s);
                    break;
                }
                case "U": {
                    if (!tas || !tap) break;
                    if (tas.selected === null) break;
                    const post = tap.posts[tas.selected];
                    const pk = (post.reposttarget || post.event!).event!.event.pubkey;
                    navigate(`/tab/p/${pk}`);
                    break;
                }
                case "W": {
                    if (!tab) break;
                    if (typeof tab.filter === "string") {
                        setFlash({ msg: "Cannot close system tabs", bang: true });
                    } else {
                        if (tryclosetab.tid === tab.id && Date.now() < tryclosetab.time + 700) {
                            setTabs(tabs.filter(t => t.id !== tab.id));
                            setTabstates(produce(draft => { draft.delete(tab.id); }));
                            setClosedtabs([tab, ...closedtabs.filter(t => t.id !== tab.id).slice(0, 4)]);  // "unreads" etc. may dupe
                            const newzorder = tabzorder.filter(t => t !== tab.id);
                            setTabzorder(newzorder);
                            navigate(`/tab/${newzorder[newzorder.length - 1] || tabs[0].id}`);
                        } else {
                            setTryclosetab({ tid: tab.id, time: Date.now() });
                            setFlash({ msg: "One more to close the tab", bang: true });
                        }
                    }
                    break;
                }
                case "&": {
                    // if already exists, overwrite and move to last.
                    const id = "unreads";
                    setTabs([...tabs.filter(t => t.id !== id), {
                        id,
                        name: id,
                        filter: null,
                    }]);
                    setTabstates(produce(draft => { draft.set(id, newtabstate()); }));
                    noswk!.overwritePosts(id, tap!.posts.filter(p => !p.hasread));
                    navigate(`/tab/${id}`);
                    break;
                }
                case "t": {
                    if (!tab) break;
                    setTabpopping(s => !s);
                    if (!tabpopping) {
                        // tabpop is about to be shown
                        setTabpopsel(0);
                        const ft = tab.filter === null
                            ? ""
                            : JSON.stringify(typeof tab.filter === "string" ? noswk!.getFilter(tab.filter) : tab.filter, undefined, 1);
                        setTabedit(ft);
                    } else {
                        setTabpopsel(-999);
                    }
                    break;
                }
                case "T": {
                    // TODO: hashtag manager
                    break;
                }
                case ",": {
                    navigate("/preferences");
                    break;
                }
                case "/": {
                    break;
                }
                case "?": {
                    break;
                }
            }
        });
        return () => setGlobalOnKeyDown(undefined);
    }, [tabs, tab, tap, tas, onselect, evinfopopping, linkpop, linksel, tryclosetab, profpopping, nextunread, closedtabs, tabzorder, tabpopping, tabpopsel, restoretab, overwritetab, newtab]);
    useEffect(() => {
        setGlobalOnPointerDown(() => (e: React.PointerEvent<HTMLDivElement>) => {
            if (!evinfopopref.current?.contains(e.nativeEvent.target as any)) {
                setEvinfopopping(false);
            }
            if (!profpopref.current?.contains(e.nativeEvent.target as any)) {
                setProfpopping(false);
            }
            if (!tabpopref.current?.contains(e.nativeEvent.target as any)) {
                setTabpopping(false);
                setTabpopsel(-999);
            }
            if (!linkpopref.current?.contains(e.nativeEvent.target as any)) {
                setLinkpop([]);
                setLinksel(null);
            }
        });
        return () => setGlobalOnPointerDown(undefined);
    }, []);
    useEffect(() => {
        if (selev) {
            const cachedauthor = noswk!.getProfile(selev.event!.event.pubkey, Kinds.profile, ev => {
                setAuthor(jsoncontent(ev));
            });
            setAuthor(cachedauthor && jsoncontent(cachedauthor));
            let cachedrpauthor: DeletableEvent | null | undefined;
            if (selrpev) {
                cachedrpauthor = noswk!.getProfile(selrpev.event!.event.pubkey, Kinds.profile, ev => {
                    setRpauthor(jsoncontent(ev));
                });
                setRpauthor(cachedrpauthor && jsoncontent(cachedrpauthor));
            }

            if (profpopping) {
                if (cachedrpauthor || cachedauthor) {
                    setProf(p => ({ ...p, metadata: cachedrpauthor || cachedauthor }));
                } else {
                    setProf(p => ({ ...p, metadata: null, contacts: null }));
                }

                const cachedcontacts = noswk!.getProfile(selev.event!.event.pubkey, Kinds.contacts, ev => {
                    setProf(p => ({ ...p, contacts: ev }));
                });
                setProf(p => ({ ...p, contacts: cachedcontacts }));
            }
        }
    }, [selev, profpopping]);
    useEffect(() => {
        // set opacity/transition after a moment
        if (flash?.bang) {
            setFlash({ ...flash, bang: false });
        }
    }, [flash]);

    useEffect(() => {
        if (!tab) {
            // redirect to first
            navigate(`/tab/${tabs[0].id}`, { replace: true });
            console.log(tab, tabs[0]);
        }
    }, [tab]);

    return <>
        <Helmet>
            <title>{tab?.name || ""} - nosteen</title>
        </Helmet>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column", cursor: "default", position: "relative" }}>
                {<TheList
                    posts={tap?.posts || []}
                    mypubkey={account?.pubkey}
                    selection={tas?.selected ?? null}
                    ref={listref}
                    onSelect={onselect}
                    onScroll={() => {
                        if (!tab) return;
                        setTabstates(produce(draft => {
                            getmk(draft, tab.id, newtabstate).scroll = listref.current?.scrollTop || 0; // use event arg?
                        }));
                    }}
                    scrollTo={listscrollto}
                />}
                <div style={{
                    display: "flex",
                    alignItems: "flex-start",
                    overflow: "visible",
                    lineHeight: "1em",
                    backgroundColor: coloruibg,
                    border: "2px inset",
                    padding: "0 0 0 2px",
                }}>
                    <div style={{ flex: "1", display: "flex", alignItems: "flex-start", overflow: "visible" }}>
                        {tabs.map(t =>
                            <Tab key={t.id} style={{ overflow: "visible", padding: t.id === tab?.id ? `2px 2px 3px` : `1px 0 0` }} active={t.id === tab?.id} onClick={() => navigate(`/tab/${t.id}`)}>
                                <div style={{ position: "relative", padding: "0 0.5em" }}>
                                    {/* TODO: nunreads refresh only on active tab... */}
                                    <div style={{ position: "relative", color: 0 < streams!.getPostStream(t.id)!.nunreads ? "red" : undefined }}>
                                        {t.name}
                                    </div>
                                    {!tabpopping || t.id !== tab?.id ? null : (() => {
                                        const Tabln: FC<{ caption: string; i: number; style?: CSSProperties; onClick?: ReactHTMLElement<HTMLDivElement>["props"]["onClick"]; }> = ({ caption, i, style, onClick }) => {
                                            const selected = i === tabpopsel;
                                            return <div
                                                ref={selected ? tabpopselref : undefined}
                                                style={{
                                                    padding: "2px",
                                                    background: selected ? "highlight" : undefined,
                                                    color: selected ? "highlighttext" : undefined,
                                                    ...style
                                                }}
                                                tabIndex={0}
                                                onPointerDown={e => setTabpopsel(i)}
                                                onClick={onClick}
                                                onFocus={e => setTabpopsel(i)}
                                            >{caption}</div>;
                                        };

                                        return <div ref={tabpopref} style={{
                                            position: "absolute",
                                            left: "0",
                                            bottom: "100%",
                                            border: "2px outset",
                                            padding: "3px",
                                            display: "flex",
                                            flexDirection: "column",
                                            background: coloruibg,
                                            color: coloruitext,
                                            font: fontui,
                                        }}>
                                            <div>history:{0 < closedtabs.length ? "" : " (none)"}</div>
                                            {closedtabs
                                                .map((e, i) => [e, i + 1] as const)
                                                .reverse()
                                                .map(([t, i]) => <Tabln key={t.id} caption={t.name} i={i} onClick={e => restoretab()} />)}
                                            <hr style={{ margin: "2px 0" }} />
                                            <div>{
                                                tabnameedit === null
                                                    ? <Tabln caption={t.name} i={0} onClick={e => setTabnameedit(t.name)} />
                                                    : <input
                                                        ref={tabnameeditref}
                                                        value={tabnameedit}
                                                        style={{ font: fontui }}
                                                        onChange={e => setTabnameedit(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.ctrlKey || e.altKey || e.metaKey) {
                                                                return;
                                                            }
                                                            if (e.key === "Escape") {
                                                                setTabnameedit(null);
                                                            }
                                                            if (e.key === "Enter") {
                                                                setTabs(produce<Tabdef[]>(draft => { draft.find(t => t.id === tab.id)!.name = tabnameedit; }));
                                                                setTabnameedit(null);
                                                            }
                                                        }}
                                                        onBlur={e => setTabnameedit(null)}
                                                    />
                                            }</div>
                                            <TextInput
                                                value={tabedit}
                                                size={71}
                                                wrap={"off"}
                                                style={{
                                                    font: fontui,
                                                    fontFamily: "monospace",
                                                    maxHeight: "5em",
                                                }}
                                                onChange={text => { setTabedit(text); }}
                                            />
                                            <Tabln caption="open new" i={-1} onClick={newtab} />
                                            <Tabln caption="overwrite" i={-2} style={{ textDecoration: typeof t.filter === "string" ? "line-through" : undefined }} onClick={overwritetab} />
                                        </div>;
                                    })()}
                                </div>
                            </Tab>
                        )}
                    </div>
                    <div>
                        <Link to="/preferences" style={{
                            background: coloruibg,
                            color: coloruitext,
                            font: fontui,
                            margin: "0 0.3em",
                        }} tabIndex={-1}>
                            Prefs...
                        </Link>
                    </div>
                </div>
                {linksel === null && !evinfopopping && !profpopping ? null : <div style={{
                    position: "absolute",
                    top: "0",
                    left: "0",
                    right: "0",
                    bottom: "0",
                    background: "#0004",
                    backdropFilter: "blur(1px)",
                }} />}
            </div>
            <div style={{ display: "flex", flexDirection: "row", background: coloruibg }}>
                <div>
                    <div style={{ width: "48px", height: "48px", border: "1px solid", borderColor: coloruitext, margin: "2px" }}>
                        {/* npubhex identicon makes icon samely for vanity... */}
                        {!selev ? <></> : <img style={{ maxWidth: "100%" }} src={`data:image/png;base64,${new Identicon(selrpev?.event?.event?.pubkey || selev.event!.event.pubkey, { background: [0, 0, 0, 0] }).toString()}`} />}
                    </div>
                </div>
                <div style={{ flex: "1", minWidth: "0", /* display: "flex", flexDirection: "column" */ }}>
                    <div style={{ color: coloruitext, font: fontui, /* fontWeight: "bold", */ margin: "0 2px", display: "flex" }}>
                        <div style={{ flex: "1", minWidth: "0", position: "relative", height: "1em", display: "flex", alignItems: "center" }}>
                            <div style={{ cursor: "pointer", color: selpost?.reposttarget ? colorrepost : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={e => setProfpopping(s => !s)}>
                                {!selev ? "name..." : (
                                    selpost.reposttarget
                                        ? `${rpauthor ? `${rpauthor.name}/${rpauthor.display_name}` : selpost.reposttarget.event!.event.pubkey} (RP: ${author ? `${author.name}/${author.display_name}` : selev.event!.event.pubkey})`
                                        : (author ? `${author.name}/${author.display_name}` : selev.event!.event.pubkey)
                                )}
                            </div>
                            {!selev || !profpopping ? null : (() => {
                                const p: MetadataContent = !prof.metadata ? null : jsoncontent(prof.metadata);
                                return <div
                                    ref={profpopref}
                                    style={{
                                        display: profpopping ? "grid" : "none",
                                        // flexDirection: "column",
                                        position: "absolute",
                                        left: "0",
                                        bottom: "100%",
                                        padding: "5px",
                                        minWidth: "10em",
                                        maxWidth: "40em",
                                        border: "2px outset",
                                        background: coloruibg,
                                        color: coloruitext,
                                        font: fontui,
                                        gridTemplateColumns: "max-content 20em",
                                        columnGap: "0.5em",
                                    }}
                                >
                                    <div style={{ textAlign: "right" }}>pubkey:</div>
                                    <div>
                                        <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{(selrpev || selev).event?.event?.pubkey}</div>
                                        <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{(() => {
                                            const rev = (selrpev || selev).event;
                                            if (!rev) return "";
                                            return nip19.npubEncode(rev.event.pubkey);
                                        })()}</div>
                                        <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{(() => {
                                            const rev = (selrpev || selev).event;
                                            if (!rev) return "";
                                            const pk: Relay | undefined = rev.receivedfrom.values().next().value;
                                            // should we use kind0's receivedfrom or kind10002? but using kind1's receivedfrom that is _real_/_in use_
                                            return nip19.nprofileEncode({ pubkey: rev.event.pubkey, relays: pk ? [pk.url] : undefined });
                                        })()}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>name:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p?.name}</div>
                                    <div style={{ textAlign: "right" }}>display_name:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p?.display_name}</div>
                                    <div style={{ textAlign: "right" }}>last updated at (created_at):</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{!prof.metadata ? "?" : timefmt(new Date(prof.metadata.event!.event.created_at * 1000), "YYYY-MM-DD hh:mm:ss")}</div>
                                    <div style={{ textAlign: "right" }}>picture:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p?.picture}</div>
                                    <div style={{ textAlign: "right" }}>banner:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p?.banner}</div>
                                    <div style={{ textAlign: "right" }}>website:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p?.website}</div>
                                    <div style={{ textAlign: "right" }}>nip05:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p?.nip05}</div>
                                    <div style={{ textAlign: "right" }}>lud06/16:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p?.lud16 || p?.lud06}</div>
                                    <div style={{ textAlign: "right" }}>following?, followed?</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{
                                        !account?.pubkey
                                            ? ""
                                            : noswk!.tryGetProfile(account.pubkey, Kind.Contacts)?.event?.event?.event?.tags?.some(t => t[0] === "p" && t[1] === prof.metadata?.event?.event?.pubkey)
                                                ? "Following"
                                                : "NOT following"
                                    } / {
                                            !prof.contacts?.event
                                                ? "?"
                                                : (prof.contacts.event.event.tags.some(t => t[0] === "p" && t[1] === account?.pubkey)
                                                    ? "Followed"
                                                    : "NOT followed")
                                        }</div>
                                    {/* <div style={{ textAlign: "right" }}>follow/unfollow, show TL, block/unblock</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{ }</div> */}
                                    <div style={{ textAlign: "right" }}>desc...</div>
                                    <div style={{
                                        overflow: "hidden", /* textOverflow: "ellipsis", does not work for multiline... */
                                        maxHeight: "3.7em",
                                        // nasty prefix hell
                                        maskImage: "linear-gradient(to bottom, #000f 3em, #0000 3.5em)",
                                        WebkitMaskImage: "linear-gradient(to bottom, #000f 3em, #0000 3.5em)",
                                    }}>{p?.about}</div>
                                    {/* <div style={{ textAlign: "right" }}>recent note</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{ }</div> */}
                                    <div style={{ textAlign: "right" }}>followings, followers:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{prof.contacts?.event ? prof.contacts.event.event.tags.filter(t => t[0] === "p").length : "?"} / ENOTIMPL</div>
                                    {/* <div style={{ textAlign: "right" }}>notes, reactions</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{ }</div> */}
                                    <div style={{ textAlign: "right" }}>json:</div>
                                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "20em" }}>{!prof.metadata ? "?" : JSON.stringify(prof.metadata.event?.event)}</div>
                                </div>;
                            })()}
                        </div>
                        <div style={{ position: "relative" }}>
                            <div style={{ cursor: "pointer" }} onClick={e => setEvinfopopping(s => !s)}>
                                {!selev ? "time..." : (() => {
                                    const t = selrpev ? selrpev.event!.event.created_at : selev.event!.event.created_at;
                                    const d = new Date(t * 1000);
                                    return timefmt(d, "YYYY-MM-DD hh:mm:ss");
                                })()}
                            </div>
                            {(() => {
                                if (!selpost) return undefined;

                                const rev = selpost.event!.event!;
                                const froms = [...rev.receivedfrom.keys()].map(r => r.url);
                                const ev = rev.event;
                                return <div
                                    ref={evinfopopref}
                                    style={{
                                        display: evinfopopping ? "grid" : "none",
                                        position: "absolute",
                                        bottom: "100%",
                                        right: "0px",
                                        padding: "5px",
                                        minWidth: "10em",
                                        border: "2px outset",
                                        background: coloruibg,
                                        color: coloruitext,
                                        gridTemplateColumns: "max-content 25em",
                                        columnGap: "0.5em",
                                    }}
                                >
                                    <div style={{ textAlign: "right" }}>seen on:</div>
                                    <div>
                                        {(() => {
                                            const rf = [...rev.receivedfrom.entries()].sort((a, b) => a[1] - b[1]);
                                            const catms = ev.created_at * 1000;
                                            const i0 = bsearchi(rf, r => catms <= r[1]);
                                            const i = rf.length <= i0 ? 0 : i0;  // choose first if event is in future.
                                            const rfirst = rf[i];
                                            return rf.map(r => <div key={r[0].url} style={{ display: "flex", flexDirection: "row" }}>
                                                <div key={`u:${r[0].url}`} style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", flex: "1" }}>{r[0].url}</div>
                                                <div key={`a:${r[0].url}`} style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{r === rfirst ? timefmt(new Date(r[1]), "YYYY-MM-DD hh:mm:ss.SSS") : reltime(rfirst[1], r[1])}</div>
                                            </div>);
                                        })()}
                                    </div>
                                    <div style={{ textAlign: "right" }}>note id:</div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} tabIndex={0} onFocus={e => seleltext(e.target)}>{ev.id}</div>
                                    <div style={{ textAlign: "right" }}></div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} tabIndex={0} onFocus={e => seleltext(e.target)}>{nip19.noteEncode(ev.id)}</div>
                                    <div style={{ textAlign: "right" }}></div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} tabIndex={0} onFocus={e => seleltext(e.target)}>{nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: [froms[0]] })}</div>
                                    <div style={{ textAlign: "right" }}>json:</div><div style={{ overflow: "hidden", whiteSpace: "pre", textOverflow: "ellipsis" }} tabIndex={0} onFocus={e => seleltext(e.target)}>{[
                                        selpost.event!.event!.event,
                                        selpost.event?.deleteevent?.event,
                                        selpost.reposttarget?.event?.event,
                                        selpost.reposttarget?.deleteevent?.event,
                                        selpost.myreaction?.event?.event,
                                        selpost.myreaction?.deleteevent?.event,
                                    ].filter(e => e).map(e => `${JSON.stringify(e)}\n`)}</div>
                                </div>;
                            })()}
                        </div>
                    </div>
                    <div style={{ position: "relative" }}>
                        <div
                            ref={linkpopref}
                            style={{
                                display: 0 < linkpop.length ? "flex" : "none",
                                flexDirection: "column",
                                position: "absolute",
                                bottom: "100%",
                                left: "0px",
                                padding: "5px",
                                minWidth: "10em",
                                maxWidth: "40em",
                                border: "2px outset",
                                background: coloruibg,
                                color: coloruitext,
                                font: fontui,
                                gridTemplateColumns: "max-content 20em",
                                rowGap: "0.5em",
                            }}
                        >
                            {linkpop.map((l, i) =>
                                <div
                                    key={i}
                                    ref={i === linksel ? linkselref : null}
                                    style={{
                                        textDecoration: l.auto ? "underline dotted" : undefined,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        width: "100%",
                                        color: i === linksel ? "highlighttext" : undefined,
                                        background: i === linksel ? "highlight" : undefined,
                                        padding: "0 0 2px 2px",
                                    }}
                                    tabIndex={0}
                                    onFocus={e => {
                                        seleltext(e.target);
                                        setLinksel(i);
                                    }}
                                    onCopy={e => {
                                        // ugh. dismissing make fail to copy. copy it here...
                                        navigator.clipboard.writeText(l.text);
                                        setLinkpop([]);
                                        setLinksel(null);
                                        listref.current?.focus();
                                    }}
                                >
                                    {l.text}
                                </div>)}
                        </div>
                        <div ref={textref} style={{ height: "5.5em", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "2px", background: colorbase, font: fonttext }}>
                            <div>
                                {/* TODO: twemoji? */}
                                {!selev ? "text..." : (() => {
                                    return spans((selrpev || selev).event!.event).map((s, i) => {
                                        switch (s.type) {
                                            case "url": {
                                                return <a key={i} href={s.href} style={{ color: colorlinktext, textDecoration: s.auto ? "underline dotted" : "underline" }} tabIndex={-1}>{s.href}</a>;
                                            }
                                            case "ref": {
                                                if (s.text) {
                                                    return <span key={i} style={{
                                                        display: "inline-block",
                                                        textDecoration: "underline",
                                                        width: "8em",
                                                        height: "1em",
                                                        overflow: "hidden",
                                                        whiteSpace: "nowrap",
                                                        textOverflow: "ellipsis",
                                                        verticalAlign: "text-bottom"
                                                    }}>{s.text}</span>;
                                                } else {
                                                    return <span key={i} style={{ textDecoration: "underline dotted" }}>{JSON.stringify(s.tag)}</span>; // TODO nice display
                                                }
                                            }
                                            case "hashtag": {
                                                return <span key={i} style={{ textDecoration: s.auto ? "underline dotted" : "underline" }}>#{s.text}</span>;
                                            }
                                            case "nip19": {
                                                return <span key={i} style={{
                                                    display: "inline-block",
                                                    textDecoration: s.auto ? "underline dotted" : "underline",
                                                    width: "8em",
                                                    height: "1em",
                                                    overflow: "hidden",
                                                    whiteSpace: "nowrap",
                                                    textOverflow: "ellipsis",
                                                    verticalAlign: "text-bottom",
                                                }}>{s.text}</span>;
                                            }
                                            case "text": {
                                                return s.text;
                                            }
                                        }
                                    });
                                })()}
                            </div>
                            {!selev
                                ? null
                                : <div style={{ margin: "0.5em", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px" }}>
                                    {((selrpev || selev)?.event?.event?.tags || []).map((t, i) => <div key={i} style={{
                                        border: "1px solid",
                                        borderColor: colornormal,
                                        borderRadius: "2px",
                                    }}>
                                        <div style={{ display: "flex", flexDirection: "row" }}>
                                            <div style={{ padding: "0 0.3em", background: colornormal, color: colorbase }}>{t[0]}</div>
                                            <div style={{ padding: "0 0.3em" }}>{t[1]}</div>
                                            {t.length <= 2 ? null : <div style={{ padding: "0 0.3em", borderLeft: "1px solid", borderLeftColor: colornormal }}>{JSON.stringify(t.slice(2))}</div>}
                                        </div>
                                    </div>)}
                                </div>}
                        </div>
                    </div>
                </div>
                {/* <div style={{ width: "100px", border: "1px solid white" }}>img</div> */}
            </div>
            <div style={{ display: "flex", alignItems: "center", background: coloruibg }}>
                <textarea ref={posteditor} style={{ flex: "1", border: "2px inset", background: colorbase, color: colornormal, font: fonttext }} value={postdraft} rows={(postdraft.match(/\n/g)?.length || 0) + 1} onChange={e => {
                    if (e.target.value === " ") {
                        listref.current?.focus();
                        nextunread();
                        return;
                    }
                    setPostdraft(e.target.value);
                }} />
                <div style={{ minWidth: "3em", textAlign: "center", verticalAlign: "middle", color: coloruitext, font: fontui }}>{postdraft.length}</div>
                <button tabIndex={-1} style={{ padding: "0 0.5em", font: fontui }}>Post</button>
            </div>
            <div style={{ background: coloruibg, color: coloruitext, font: fontui, padding: "2px", display: "flex" }}>
                <div style={{ flex: "1" }}>tab {tap?.nunreads}/{tap?.posts?.length}, all {streams?.getNunreads()}/{streams?.getAllPosts()?.size} | post/fav/note /h | {status}</div>
                <div style={{ padding: "0 0.5em" }}>-</div>
                <div style={{ padding: "0 0.5em" }}>{relayinfo.healthy}/{relayinfo.all}</div>
                {/* <div style={{ position: "relative" }}>
                    #hashtag
                    <div style={{ display: "none", position: "absolute", bottom: "100%", right: "0px", padding: "5px", minWidth: "10em", border: "2px outset", background: coloruibg, color: coloruitext }}>
                        <div style={{ height: "1.5em" }}>#foo</div>
                        <div style={{ height: "1.5em" }}>#bar</div>
                        <div style={{ height: "1.5em", display: "flex", flexFlow: "row", alignItems: "center" }}>
                            #
                            <input type="text" value="" placeholder="hashtag" style={{ flex: "1", boxSizing: "border-box", font: fontui }} onChange={e => { }} />
                        </div>
                    </div>
                </div> */}
            </div>
            <div
                style={{
                    display: flash ? "flex" : "none",
                    position: "absolute",
                    top: "0",
                    left: "0",
                    bottom: "0",
                    right: "0",
                    background: "#0004",
                    backdropFilter: "blur(2px)",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: flash?.bang ? "1" : "0",
                    transition: flash?.bang ? undefined : "opacity 0.6s linear 0.2s",
                    zIndex: 1, /* ugh. without this, listview column overlaps. */
                }}
                onTransitionEnd={e => setFlash(null)}
            >
                <div style={{
                    background: "#000",
                    color: "#fff",
                    borderRadius: "1em",
                    padding: "1em",
                    minWidth: "10em",
                    textAlign: "center",
                }}>
                    {flash?.msg}
                </div>
            </div>
        </div>
    </>;
};
export default Tabsview;
