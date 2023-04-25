import Identicon from "identicon.js";
import produce from "immer";
import { useAtom } from "jotai";
import { encodeBech32ID } from "nostr-mux/dist/core/utils";
import { Event, nip19 } from "nostr-tools";
import { FC, ForwardedRef, forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Helmet } from "react-helmet";
import { Link, useNavigate, useParams } from "react-router-dom";
import ListView, { TBody, TD, TH, TR } from "../components/listview";
import Tab from "../components/tab";
import { NostrWorker, NostrWorkerListenerMessage, useNostrWorker } from "../nostrworker";
import state from "../state";
import { Post } from "../types";
import { NeverMatch, bsearchi, getmk, postindex } from "../util";

const TheRow = /* memo */(forwardRef<HTMLDivElement, { post: Post; mypubkey: string | undefined; selected: Post | null; }>(({ post, mypubkey, selected }, ref) => {
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

    const ev = post.event!.event!.event;
    const derefev = post.reposttarget || post.event!;

    const [bg, text] = (() => {
        if (post === selected) {
            return [colorselbg, colorseltext];
        }

        let bg = undefined;
        let text = colornormal;

        if (post.event!.event!.event.kind === 6) {
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
        if (evpub === selpub) {
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
                    {<img style={{ maxWidth: "16px" }} src={`data:image/png;base64,${new Identicon(
                        derefev.event!.event.pubkey,
                        { background: [0, 0, 0, 0] }).toString()}`} />}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {post.reposttarget ? `${post.reposttarget.event!.event.pubkey} (RT: ${ev.pubkey})` : ev.pubkey}
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
    const rowh = rowref.current?.offsetHeight || 0;
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
                        {/* TODO: this can be sT..sT+cH not wholescan */}
                        {posts.map((p, i) => {
                            if (rowh * (i + 1) < scrollTop || scrollTop + clientHeight < rowh * i) return null;
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
    const re = /Y+|M+|D+|h+|m+|s+|[^YMDhms]+/g;
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
            default: {
                str += token;
                break;
            }
        }
    }
};

class PostStreamWrapper {
    private readonly listeners = new Map<string, Map<(msg: NostrWorkerListenerMessage) => void, (msg: NostrWorkerListenerMessage) => void>>();
    private readonly streams = new Map<string, ReturnType<typeof NostrWorker.prototype.getPostStream>>();
    private readonly emptystream = { posts: [], nunreads: 0 }; // fixed reference is important
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
    setMutes({ users, regexs }: { users: string[], regexs: string[]; }) {
        // https://stackoverflow.com/a/9213411
        this.muteusers = users.length === 0 ? NeverMatch : new RegExp(users.map(e => `(${e})`).join("|"));
        this.mutepatterns = regexs.length === 0 ? NeverMatch : new RegExp(regexs.map(e => `(${e})`).join("|"));
    }

    private refreshPosts(name: string) {
        const stream = this.noswk.getPostStream(name);
        if (!stream) {
            return this.emptystream;
        }
        // shallow copy "posts" to notify immutable change
        // FIXME: each element mutates, and that post may not re-rendered
        const news = {
            posts: stream.posts.filter(p => {
                const ev = p.event!.event!.event;
                if (this.muteusers.test(ev.pubkey) || this.mutepatterns.test(ev.content)) {
                    return false;
                }
                const rpev = p.reposttarget?.event?.event;
                if (rpev && (this.muteusers.test(rpev.pubkey) || this.mutepatterns.test(rpev.content))) {
                    return false;
                }
                return true;
            }),
            nunreads: stream.nunreads, // TODO: minus mute?
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
            const tag = tev.tags[ti];
            if (tag[0] === "p") return { rawtext: t, type: "ref", tagindex: ti, tag, text: nip19.npubEncode(tag[1]) } as const;
            if (tag[0] === "e") return { rawtext: t, type: "ref", tagindex: ti, tag, text: nip19.noteEncode(tag[1]) } as const;
            return { rawtext: t, type: "ref", tagindex: ti, tag } as const;
        }
        const mhash = t.match(/^#(\S+)/);
        if (mhash) {
            // hashtag t-tag may be normalized to smallcase
            const tag = tev.tags.find(t => t[0] === "t" && t[1].localeCompare(mhash[1]) === 0);
            return { rawtext: t, type: "hashtag", text: mhash[1], tagtext: tag?.[1], auto: !tag } as const;
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
    const name = data.name || "";
    const [account] = useAtom(state.preferences.account);
    const [tabs, setTabs] = useAtom(state.tabs);
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
    const [relayinfo] = useAtom(state.relayinfo);
    const listref = useRef<HTMLDivElement>(null);
    const textref = useRef<HTMLDivElement>(null);
    const [listscrollto, setListscrollto] = useState<Parameters<typeof TheList>[0]["scrollTo"]>(undefined);
    const [evinfopopping, setEvinfopopping] = useState(false);
    const evinfopopref = useRef<HTMLDivElement>(null);
    const [linkpop, setLinkpop] = useState<{ text: string; auto: boolean; }[]>([]);
    const linkpopref = useRef<HTMLDivElement>(null);
    const [linksel, setLinksel] = useState<number | null>(null);
    const linkselref = useRef<HTMLDivElement>(null);

    const [status, setStatus] = useState("status...");

    const tab = tabs.find(t => t.name === name);
    if (!tab) {
        navigate(`/tab/${tabs[0].name}`, { replace: true });
        return <></>;
    }

    const [postdraft, setPostdraft] = useState("");
    const posteditor = useRef<HTMLInputElement>(null);

    const tap = useSyncExternalStore(
        useCallback((onStoreChange) => {
            const onChange = (msg: NostrWorkerListenerMessage) => { msg.type !== "eose" && msg.name === name && onStoreChange(); };
            streams!.addListener(name, onChange);
            return () => streams!.removeListener(name, onChange);
        }, [streams, name]),
        useCallback(() => {
            return streams!.getPostStream(name);
        }, [streams, name]),
    );
    useEffect(() => {
        const onChange = (msg: NostrWorkerListenerMessage) => {
            if (msg.type !== "event") return;
            if (msg.name !== name) return;
            setListscrollto({ lastIfVisible: true });
        };
        streams!.addListener(name, onChange);
        return () => streams!.removeListener(name, onChange);
    }, [name, streams]);
    useEffect(() => {
        streams!.setMutes({ users: [...muteuserpublic, ...muteuserprivate, ...muteuserlocal], regexs: muteregexlocal });
    }, [streams, muteuserpublic, muteuserprivate, muteuserlocal, muteregexlocal]);
    const selpost = tab.selected === null ? undefined : tap?.posts[tab.selected];
    const selev = selpost?.event;
    const selrpev = selpost?.reposttarget;
    const onselect = useCallback((i: number, toTop?: boolean) => {
        if (tap) {
            noswk!.setHasread({ id: tap.posts[i].id }, true);
        }
        setTabs(produce(draft => {
            const tab = draft.find(t => t.name === name)!;
            tab.selected = i;
        }));
        setListscrollto({ index: i, toTop });
        textref.current?.scrollTo(0, 0);
    }, [tap, noswk]);
    useEffect(() => {
        // TODO: when fonttext changes?
        setListscrollto({ pixel: tab.scroll });
    }, [name]); // !!
    useEffect(() => {
        const el = linkselref.current;
        if (!el) return;
        el.focus();
    }, [linksel]);
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
                        // TODO
                        break;
                    }
                }
                return;
            }
            if (evinfopopping) {
                switch (e.key) {
                    case "Escape": {
                        setEvinfopopping(false);
                        listref.current?.focus();
                        break;
                    }
                }
                // return;
            }
            switch (e.key) {
                case "a": {
                    const i = tabs.indexOf(tab);
                    const n = tabs[i === 0 ? tabs.length - 1 : i - 1].name;
                    navigate(`/tab/${n}`);
                    break;
                }
                case "s": {
                    const i = tabs.indexOf(tab);
                    const n = tabs[i === tabs.length - 1 ? 0 : i + 1].name;
                    navigate(`/tab/${n}`);
                    break;
                }
                case "j": {
                    if (!tap) break;
                    const i = tab.selected === null ? tap.posts.length - 1 : tab.selected + 1;
                    if (i < tap.posts.length) {
                        onselect(i);
                    }
                    break;
                }
                case "k": {
                    if (!tap) break;
                    const i = tab.selected === null ? tap.posts.length - 1 : tab.selected - 1;
                    if (0 <= i) {
                        onselect(i);
                    }
                    break;
                }
                case "h": {
                    if (!tap) break;
                    if (tab.selected === null) break;
                    const pk = tap.posts[tab.selected].event!.event!.event.pubkey;
                    for (let i = tab.selected - 1; 0 <= i; i--) {
                        if (tap.posts[i].event!.event!.event.pubkey === pk) {
                            onselect(i);
                            break;
                        }
                    }
                    break;
                }
                case "l": {
                    if (!tap) break;
                    if (tab.selected === null) break;
                    const l = tap.posts.length;
                    const pk = tap.posts[tab.selected].event!.event!.event.pubkey;
                    for (let i = tab.selected + 1; i < l; i++) {
                        if (tap.posts[i].event!.event!.event.pubkey === pk) {
                            onselect(i);
                            break;
                        }
                    }
                    break;
                }
                case "[": {
                    if (!tap) break;
                    if (tab.selected === null) break;
                    const selpost = tap.posts[tab.selected];
                    if (!selpost) break;  //!?
                    const ev = selpost.reposttarget || selpost.event!;
                    // really last? NIP-10 states (we fails marker yet) but...
                    // 2nd? 2/3?? note18h28wvds25vsd8dlujt7p9cu3q5rnwgl47jrmmumhcmw2pxys63q7zee4e
                    const laste = ev.event!.event.tags.reduce<string | undefined>((p, c) => c[0] === "e" ? c[1] : p, undefined);
                    if (!laste) break;
                    const lp = noswk!.getPost(laste);
                    if (!lp) break;

                    let rp = [...tab.replypath];
                    const oevid = selpost.event!.id;  // on repost, replypath holds repost itself
                    if (tab.replypath.indexOf(oevid) === -1) {
                        rp = [oevid];
                    }
                    if (rp.indexOf(laste) === -1) {
                        rp.unshift(laste);
                    }
                    setTabs(produce(draft => {
                        draft.forEach(t => {
                            if (t.name !== tab.name) return;
                            t.replypath = rp;
                        });
                    }));
                    const ei = postindex(tap.posts, lp.event!.event!.event);
                    if (ei === null) break;  // TODO: may move tab? what if already closed?
                    onselect(ei);
                    break;
                }
                case "]": {
                    if (!tap) break;
                    if (tab.selected === null) break;
                    const selpost = tap.posts[tab.selected];
                    if (!selpost) break;  //!?

                    const lid = (() => {
                        const rp = [...tab.replypath];

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
                                setTabs(produce(draft => {
                                    draft.forEach(t => {
                                        if (t.name !== tab.name) return;
                                        t.replypath = nrp;
                                    });
                                }));
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
                                const text = `#${t[1]}`;
                                ls.set(text, { text, auto: false });
                                break;
                            }
                        }
                    });
                    // TODO: url first? ev, pub then hashtag?
                    setLinkpop([...ls.values()]);
                    setLinksel(0);
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
                        navigate(`/tab/${t.name}`);
                    }
                    break;
                }
                case "9": {
                    const t = tabs[tabs.length - 1];
                    navigate(`/tab/${t.name}`);
                    break;
                }
                case " ": {
                    if (!tap) break;
                    const tapl = tap.posts.length;
                    let i: number;
                    for (i = 0; i < tapl; i++) {
                        if (!tap.posts[i].hasread) {
                            break;
                        }
                    }
                    if (i < tapl) {
                        onselect(i, true);
                        e.preventDefault();
                    }
                    break;
                }
                case "m": {
                    setEvinfopopping(s => !s);
                    break;
                }
                case "b": {
                    if (tab.selected === null) return;
                    noswk!.setHasread({ stream: name, afterIndex: tab.selected }, false);
                    break;
                }
                case "B": {
                    if (tab.selected === null) return;
                    noswk!.setHasread({ stream: name, beforeIndex: tab.selected }, true);
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
    }, [tabs, tab, tap, onselect, evinfopopping, linkpop, linksel]);
    useEffect(() => {
        setGlobalOnPointerDown(() => (e: React.PointerEvent<HTMLDivElement>) => {
            if (!evinfopopref.current?.contains(e.nativeEvent.target as any)) {
                setEvinfopopping(false);
            }
            if (!linkpopref.current?.contains(e.nativeEvent.target as any)) {
                setLinkpop([]);
                setLinksel(null);
            }
        });
        return () => setGlobalOnPointerDown(undefined);
    }, []);
    return <>
        <Helmet>
            <title>{name} - nosteen</title>
        </Helmet>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column", cursor: "default" }}>
                {<TheList
                    posts={tap?.posts || []}
                    mypubkey={account?.pubkey}
                    selection={tab.selected}
                    ref={listref}
                    onSelect={onselect}
                    onScroll={() => {
                        setTabs(produce(draft => {
                            const tab = draft.find(t => t.name === name)!;
                            tab.scroll = listref.current?.scrollTop || 0; // use event arg?
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
                        {tabs.map(t => <Tab key={t.name} active={t.name === name} onClick={() => navigate(`/tab/${t.name}`)}>{t.name}</Tab>)}
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
                        <div style={{ flex: "1", color: selpost?.reposttarget ? colorrepost : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {!selev ? "name..." : (
                                selpost.reposttarget
                                    ? `${selpost.reposttarget.event!.event.pubkey} (RP: ${selev.event!.event.pubkey})`
                                    : selev.event!.event.pubkey
                            )}
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
                                const froms = [...rev.receivedfrom.values()].map(r => r.url);
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
                                        gridTemplateColumns: "max-content 20em",
                                        columnGap: "0.5em",
                                    }}
                                >
                                    <div style={{ textAlign: "right" }}>received from:</div><div>
                                        {[...rev.receivedfrom.values()].map(r => (<div key={r.url}>{r.url}</div>))}
                                    </div>
                                    <div style={{ textAlign: "right" }}>note id:</div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} tabIndex={0} onFocus={e => seleltext(e.target)}>{ev.id}</div>
                                    <div style={{ textAlign: "right" }}></div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} tabIndex={0} onFocus={e => seleltext(e.target)}>{encodeBech32ID("note", ev.id)}</div>
                                    <div style={{ textAlign: "right" }}></div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} tabIndex={0} onFocus={e => seleltext(e.target)}>{nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: froms })}</div>
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
                <input ref={posteditor} type="text" style={{ flex: "1", border: "2px inset", background: colorbase, color: colornormal, font: fonttext }} value={postdraft} onChange={e => setPostdraft(e.target.value)} />
                <div style={{ minWidth: "3em", textAlign: "center", verticalAlign: "middle", color: coloruitext, font: fontui }}>{postdraft.length}</div>
                <button tabIndex={-1} style={{ padding: "0 0.5em", font: fontui }}>Post</button>
            </div>
            <div style={{ background: coloruibg, color: coloruitext, font: fontui, padding: "2px", display: "flex" }}>
                <div style={{ flex: "1" }}>tab {tap?.nunreads}/{tap?.posts?.length}, all {streams?.getNunreads()}/{streams?.getAllPosts()?.size} | {status}</div>
                <div style={{ padding: "0 0.5em" }}>{relayinfo.healthy}/{relayinfo.all}</div>
                <div style={{ position: "relative" }}>
                    #hashtag
                    <div style={{ display: "none", position: "absolute", bottom: "100%", right: "0px", padding: "5px", minWidth: "10em", border: "2px outset", background: coloruibg, color: coloruitext }}>
                        <div style={{ height: "1.5em" }}>#foo</div>
                        <div style={{ height: "1.5em" }}>#bar</div>
                        <div style={{ height: "1.5em", display: "flex", flexFlow: "row", alignItems: "center" }}>
                            #
                            <input type="text" value="" placeholder="hashtag" style={{ flex: "1", boxSizing: "border-box", font: fontui }} onChange={e => { }} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </>;
};
export default Tabsview;
