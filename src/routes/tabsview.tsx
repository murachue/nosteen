import Identicon from "identicon.js";
import produce from "immer";
import { useAtom } from "jotai";
import { FC, Ref, forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Helmet } from "react-helmet";
import { Link, useNavigate, useParams } from "react-router-dom";
import ListView, { TBody, TD, TH, TR } from "../components/listview";
import Tab from "../components/tab";
import { NostrWorker, NostrWorkerListenerMessage, useNostrWorker } from "../nostrworker";
import state from "../state";
import { Post } from "../types";
import { getmk } from "../util";
import VList from "react-virtualized-listview";
import { encodeBech32ID } from "nostr-mux/dist/core/utils";
import { nip19 } from "nostr-tools";

const TheRow = memo(forwardRef<HTMLDivElement, { post: Post; mypubkey: string | undefined; selected: Post | null; }>(({ post, mypubkey, selected }, ref) => {
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
        const selev = selected?.event!.event!.event;
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
                        post.reposttarget?.event?.event.pubkey || ev.pubkey,
                        { background: [0, 0, 0, 0] }).toString()}`} />}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {post.reposttarget ? `${post.reposttarget.event!.event.pubkey} (RT: ${ev.pubkey})` : ev.pubkey}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {post.reposttarget?.event?.event.content || ev.content}
                </div>
            </TD>
        </TR>
    </div>;
}));

const TheList = forwardRef<HTMLDivElement, {
    posts: Post[];
    mypubkey: string | undefined;
    selection: Post | null;
    onSelect?: (i: number) => void;
    selref?: Ref<HTMLDivElement>;
    lastref?: Ref<HTMLDivElement>;
}>(({ posts, mypubkey, selection, onSelect, selref, lastref }, ref) => {
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fontui] = useAtom(state.preferences.fonts.ui);
    const lasti = posts.length - 1;

    return <div style={{ flex: "1 0 0px", height: "0" }}>
        <ListView>
            <div ref={ref} tabIndex={0} style={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "scroll", position: "relative" }}>
                <div style={{ display: "flex", position: "sticky", width: "100%", top: 0, background: coloruibg }}>
                    <TH>
                        <TD width="20px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>m</div></TD>
                        <TD width="20px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>u</div></TD>
                        <TD width="20px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>icon</div></TD>
                        <TD width="100px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>username</div></TD>
                        <TD width="600px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>text</div></TD>
                    </TH>
                </div>
                <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                    <TBody>
                        {posts.map((p, i) => {
                            const evid = p.event!.event!.event.id;
                            return <div
                                key={evid}
                                ref={i === lasti ? lastref : p === selection ? selref : undefined} // TODO: react-merge-refs?
                                onPointerDown={e => e.isPrimary && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && onSelect && onSelect(i)}>
                                <TheRow post={p} mypubkey={mypubkey} selected={selection} />
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
    constructor(private readonly noswk: NostrWorker) { }
    addListener(name: string, onChange: (msg: NostrWorkerListenerMessage) => void) {
        const listener = (msg: NostrWorkerListenerMessage): void => {
            const { name, type } = msg;
            if (type !== "eose") {
                const stream = this.noswk.getPostStream(name);
                if (stream) {
                    // shallow copy to notify immutable change
                    // FIXME: each element mutates, and that post may not re-rendered
                    this.streams.set(name, { posts: [...stream.posts], nunreads: stream.nunreads });
                }
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
        const istream = this.streams.get(name);
        if (istream) {
            return istream;
        }
        const stream = this.noswk.getPostStream(name);
        if (!stream) {
            return this.emptystream;
        }
        const newistream = { posts: [...stream.posts], nunreads: stream.nunreads };
        if (0 < (this.listeners.get(name)?.size || 0)) {
            this.streams.set(name, newistream);
        }
        return newistream;
    }
    getAllPosts() {
        // TODO: make immutable and listenable that needs noswk support
        return this.noswk.getAllPosts();
    }
    getNunreads() {
        return this.noswk.nunreads;
    }
}

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
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [fontui] = useAtom(state.preferences.fonts.ui);
    const noswk = useNostrWorker();
    const streams = useMemo(() => noswk && new PostStreamWrapper(noswk), [noswk]);
    const [posts, setPosts] = useAtom(state.posts);
    const [relayinfo] = useAtom(state.relayinfo);
    const listref = useRef<HTMLDivElement>(null);
    const selref = useRef<HTMLDivElement>(null);
    const lastref = useRef<HTMLDivElement>(null);
    const textref = useRef<HTMLDivElement>(null);
    const [scrollto, setScrollto] = useState<{ ref: "" | "sel" | "last", t: number; }>({ ref: "", t: 0 }); // just another object instance is enough, but easier for eyeball debugging.
    const [evinfopopping, setEvinfopopping] = useState(false);
    const evinfopopref = useRef<HTMLDivElement>(null);

    const [status, setStatus] = useState("status...");

    const tab = tabs.find(t => t.name === name);
    if (!tab) {
        navigate(`/tab/${tabs[0].name}`, { replace: true });
        return <></>;
    }

    const [postdraft, setPostdraft] = useState("");
    const posteditor = useRef<HTMLInputElement>(null);

    // const tap = posts.bytab.get(name)!;
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
            const list = listref.current;
            if (!list) return;
            const last = lastref.current;
            if (!last) return;
            const scrollBottom = list.scrollTop + list.clientHeight;
            if (last.offsetTop < scrollBottom) {
                setScrollto({ ref: "last", t: Date.now() });
            }
        };
        streams!.addListener(name, onChange);
        return () => streams!.removeListener(name, onChange);
    }, [name, streams]);
    const selpost = tab.selected === null ? undefined : tap?.posts[tab.selected];
    const selev = selpost?.event;
    const selrpev = selpost?.reposttarget;
    const onselect = useCallback((i: number) => {
        if (tap) {
            noswk!.setHasread(tap.posts[i].id, true);
        }
        setTabs(produce(draft => {
            const tab = draft.find(t => t.name === name)!;
            tab.selected = i;
        }));
        setScrollto({ ref: "sel", t: Date.now() });
        textref.current?.scrollTo(0, 0);
    }, [tap, noswk]);
    useEffect(() => {
        switch (scrollto.ref) {
            case "sel": {
                // scrollIntoViewIfNeeded(false) is not supported by Firefox 114 yet
                const sel = selref.current || lastref.current;
                if (!sel) {
                    break;
                }
                const list = listref.current;
                if (!list) {
                    break;
                }
                if (sel.offsetTop < list.scrollTop) {
                    sel.scrollIntoView(true);
                    // TODO: don't overlap with sticky listview header
                    break;
                }
                const listScrollBottom = list.scrollTop + list.clientHeight;
                const selOffsetBottom = sel.offsetTop + sel.offsetHeight;
                if (listScrollBottom < selOffsetBottom) {
                    sel.scrollIntoView(false);
                    break;
                }
                break;
            }
            case "last": {
                lastref.current?.scrollIntoView();
                break;
            }
        }
    }, [scrollto]);
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
                    break;
                }
                case "E": {
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
                        onselect(i); // TODO: scroll to top
                        e.preventDefault();
                    }
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
    }, [tabs, tab, tap, onselect]);
    useEffect(() => {
        setGlobalOnPointerDown(() => (e: React.PointerEvent<HTMLDivElement>) => {
            const inside = evinfopopref.current?.contains(e.nativeEvent.target as any);
            if (!inside) {
                setEvinfopopping(false);
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
                {<TheList posts={tap?.posts || []} mypubkey={account?.pubkey} selection={selpost || null} ref={listref} selref={selref} lastref={lastref} onSelect={onselect} />}
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
                        {/* <TabBar> */}
                        {tabs.map(t => <Tab key={t.name} active={t.name === name} onClick={() => navigate(`/tab/${t.name}`)}>{t.name}</Tab>)}
                        {/* </TabBar> */}
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
                                    ? `${selpost.reposttarget.event!.event.pubkey} (RT: ${selev.event!.event.pubkey})`
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
                                    <div style={{ textAlign: "right" }}>note id:</div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{ev.id}</div>
                                    <div style={{ textAlign: "right" }}></div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{encodeBech32ID("note", ev.id)}</div>
                                    <div style={{ textAlign: "right" }}></div><div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: froms })}</div>
                                    <div style={{ textAlign: "right" }}>json:</div><div style={{ height: "1em", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{[
                                        selpost.event!.event!.event,
                                        selpost.event?.deleteevent?.event,
                                        selpost.reposttarget?.event?.event,
                                        selpost.reposttarget?.deleteevent?.event,
                                        selpost.myreaction?.event?.event,
                                        selpost.myreaction?.deleteevent?.event,
                                    ].filter(e => e).map(e => <>{`${JSON.stringify(e)}`}<br /></>)}</div>

                                </div>;
                            })()}
                        </div>
                    </div>
                    <div ref={textref} style={{ height: "5.5em", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "2px", background: colorbase, font: fonttext }}>
                        <div>{!selev ? "text..." : ((selrpev || selev)?.event?.event?.content)}</div>
                        {!selev
                            ? null
                            : <div style={{ margin: "0.5em", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px" }}>
                                {((selrpev || selev)?.event?.event?.tags || []).map((t, i) => <div key={i} style={{
                                    border: "1px solid",
                                    borderColor: colornormal,
                                    borderRadius: "2px",
                                }}>
                                    <span style={{ padding: "0 0.3em", background: colornormal, color: colorbase }}>{t[0]}</span>
                                    <span style={{ padding: "0 0.3em" }}>{t[1]}</span>
                                    {t.length <= 2 ? null : <span style={{ padding: "0 0.3em", borderLeft: "1px solid", borderLeftColor: colornormal }}>{JSON.stringify(t.slice(2))}</span>}
                                </div>)}
                            </div>}
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
