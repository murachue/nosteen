import { produce } from "immer";
import { useAtom } from "jotai";
import { Event, EventTemplate, Kind, finishEvent, nip13, nip19, utils } from "nostr-tools";
import { CSSProperties, FC, ForwardedRef, Fragment, ReactHTMLElement, forwardRef, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Helmet } from "react-helmet";
import { Link, useNavigate, useParams } from "react-router-dom";
import ListView, { TBody, TD, TH, TR } from "../components/listview";
import Tab from "../components/tab";
import TabText from "../components/tabtext";
import TextInput from "../components/textinput";
import { MuxRelayEvent, NostrWorker, NostrWorkerListenerMessage, useNostrWorker } from "../nostrworker";
import { RelayWrap } from "../pool";
import { Relay } from "../relay";
import state, { RecentPost, Tabdef, newtabstate } from "../state";
import { DeletableEvent, Kinds, MetadataContent, Post } from "../types";
import { NeverMatch, bsearchi, expectn, getmk, postindex, rescue, seleltext, sha256str, shortstyle } from "../util";

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

    const ev = post.event?.event?.event;
    const derefev = post.reposttarget || post.event;

    const [author, setAuthor] = useState(() => {
        if (!derefev?.event) return undefined;
        const cached = noswk.getProfile(derefev.event.event.pubkey, Kinds.profile, ev => setAuthor(metadatajsoncontent(ev)));
        return cached && metadatajsoncontent(cached);
    });
    const [rpauthor, setRpauthor] = useState(() => {
        if (!post.reposttarget || !ev) return null;
        const cached = noswk.getProfile(ev.pubkey, Kinds.profile, ev => setRpauthor(metadatajsoncontent(ev)));
        return cached && metadatajsoncontent(cached);
    });

    const [bg, text] = (() => {
        if (post === selected) {
            return [colorselbg, colorseltext];
        }

        let bg = undefined;
        let text = colornormal;

        if (post.event?.event && post.event.event.event.kind === (6 as Kind)) {
            text = colorrepost;
        }
        if (post.myreaction?.event) {
            text = colorreacted;
            // TODO: also check for reposted
        }

        if (ev) {
            const evpub = ev.pubkey;
            const evid = ev.id;
            const selev = !selected ? undefined : (selected.reposttarget || selected.event)?.event?.event;
            const selpub = selected?.event?.event?.event?.pubkey;
            if (selpub && evpub === selpub) {
                bg = colorthempost;
            }
            if (mypubkey && evpub === mypubkey) {
                bg = colormypost;
            }
            // XXX: O(NM) is heavy
            if (selev && selev.tags.findIndex(t => t[0] === "e" && t[1] === evid) !== -1) {
                bg = colorthemreplyto;
            }
            if (ev.tags.findIndex(t => t[0] === "p" && t[1] === mypubkey) !== -1) {
                bg = colorreplytome;
            }
        }

        return [bg, text];
    })();

    return <div ref={ref} style={{ display: "flex", overflow: "hidden", alignItems: "center", background: bg, color: text, font: fonttext }}>
        <TR>
            <TD>
                <div style={{ ...shortstyle, textAlign: "right" }}>
                    {derefev && derefev.event?.event?.tags?.find(t => t[0] === "e")
                        ? "⇒"
                        : derefev && derefev.event?.event?.tags?.find(t => t[0] === "p")
                            ? "→"
                            : ""}
                    {(post.event!.deleteevent || post.reposttarget?.deleteevent) ? "×" : ""}
                </div>
            </TD>
            <TD>
                <div style={{ ...shortstyle, textAlign: "right" }}>
                    {post.hasread ? "" : "★"}
                </div>
            </TD>
            <TD style={{ display: "flex", alignItems: "center" }}>
                {!derefev?.event ? null : <img style={{ height: "max(1em,16px)" }} src={identiconStore.png(derefev.event.event.pubkey)} />}
            </TD>
            {/* name and text are ugly. must be shorter that is enough to emoji and nip36 */}
            <TD style={{ alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                <div style={{ flex: "1", maxHeight: "1em", overflow: "hidden", display: "flex", alignItems: "center" }}>
                    <div style={shortstyle}>
                        {post.reposttarget
                            ? `${author?.name || post.reposttarget.event?.event?.pubkey} (RP: ${rpauthor?.name || ev?.pubkey})`
                            : (author?.name || ev?.pubkey)
                        }
                    </div>
                </div>
            </TD>
            <TD style={{ alignSelf: "stretch", display: "flex", alignItems: "center", position: "relative" }}>
                <div style={{ flex: "1", maxHeight: "1em", overflow: "hidden", display: "flex", alignItems: "center" }}>
                    <div style={shortstyle}>
                        {derefev?.event?.event?.content}
                    </div>
                </div>
                {(() => {
                    const cw = derefev?.event?.event?.tags?.find(t => t[0] === "content-warning");
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
                        <div style={shortstyle}>{cw[1]}</div>
                    </div>;
                })()}
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
    onSelect?: (sel: { id: string; index: number; }) => void;
    onScroll?: React.HTMLAttributes<HTMLDivElement>["onScroll"];
    onFocus?: React.HTMLAttributes<HTMLDivElement>["onFocus"];
    scrollTo?: { pixel: number; } | { index: number; toTop?: boolean; } | { lastIfVisible: boolean; };
};
const TheList = forwardRef<HTMLDivElement, TheListProps>(({ posts, mypubkey, selection, onSelect, onScroll, onFocus, scrollTo }, ref) => {
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
            if (scrollTo.toTop) {
                const selOffsetBottom = (ix + 2) * rowh + iel.offsetTop;  // last fully-visible item also scrolls.
                if (listScrollBottom < selOffsetBottom) {
                    lel.scrollTo(0, ix * rowh);
                    return;
                }
            } else {
                const selOffsetBottom = (ix + 1) * rowh + iel.offsetTop;
                if (listScrollBottom < selOffsetBottom) {
                    lel.scrollTo(0, selOffsetBottom - lel.clientHeight);
                    return;
                }
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
                onFocus={onFocus}
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
                            return <div
                                key={p.id}
                                onPointerDown={e => {
                                    if (!e.isPrimary) return;  // need?
                                    if (e.button !== 0) return;
                                    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
                                    if (!onSelect) return;
                                    onSelect({ id: p.id, index: i });
                                }}
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

const reltime = (bidelta: number) => {
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

// NostrWorker wrapper with immutable subs store that is friendly for React.
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
            const ev = p.event?.event?.event;
            if (!ev) return true;  // XXX ?
            if (this.muteusers.test(ev.pubkey) || this.mutepatterns.test(ev.content)) {
                return false;
            }
            // TODO: this should be able to toggled off
            if (ev.tags.filter(t => t[0] === "p").some(t => this.muteusers.test(t[1]))) {
                return false;
            }
            const rpev = p.reposttarget?.event?.event;
            if (rpev && (this.muteusers.test(rpev.pubkey) || this.mutepatterns.test(rpev.content))) {
                return false;
            }
            // TODO: this should be able to toggled off
            if (rpev && rpev.tags.filter(t => t[0] === "p").some(t => this.muteusers.test(t[1]))) {
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

const spans = (tev: Event): (
    { rawtext: string; type: "url"; href: string; auto: boolean; }
    | { rawtext: string; type: "ref"; tagindex: number; tag: string[] | undefined; text?: string; hex: string | null; }
    | { rawtext: string; type: "hashtag"; text: string; tagtext: string | undefined; auto: boolean; }
    | { rawtext: string; type: "nip19"; text: string; hex: string | undefined; auto: boolean; }
    | { rawtext: string; type: "text"; text: string; }
)[] => {
    const text = tev.content;

    // https://stackoverflow.com/a/6969486
    function escapeRegExp(string: string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    type IndexSpan = {
        type: "text" | "rurl" | "url" | "rest";
        from: number;
        to: number;
    };
    const compactspan = (spans: IndexSpan[]) => spans.filter(s => s.from !== s.to);
    const subspan = (spans: IndexSpan[], rex: RegExp, type: IndexSpan["type"]) => spans.flatMap(span => {
        if (span.type !== "text") return [span];
        const span1: IndexSpan[] = [];
        const slice = text.slice(span.from, span.to);
        for (const s of slice.matchAll(rex)) {
            span1.push({ type: "text", from: (span1[span1.length - 1]?.to || 0), to: s.index! });
            span1.push({ type, from: s.index!, to: s.index! + s[0].length });
        }
        span1.push({ type: "text", from: (span1[span1.length - 1]?.to || 0), to: slice.length });
        return compactspan(span1).map(s => ({ ...s, from: span.from + s.from, to: span.from + s.to }));
    });

    // #r is very reliable (except some from Amethyst)
    // TODO: filter that is URL.parse-able for from Amethyst
    const span0: IndexSpan[] = [{ type: "text", from: 0, to: text.length }];
    const rtags = tev.tags.filter(t => t[0] === "r");
    const span1 = (() => {
        if (rtags.length === 0) return span0;
        const rsrex = new RegExp(rtags.map(t => escapeRegExp(t[1])).join("|"), "g");
        return subspan(span0, rsrex, "rurl");  // this can be []
    })();

    // url has priority than emoji. consider: "http://[2001:db8::beef:1]/foo has a :beef:" with emoji:beef:xxx
    // TODO: handle domain names? note1asvxwepy2v83mrvfet9yyq0klc4hwsucdn3dlzuvaa9szltw6gqqf5w8p0
    const urlrex = /\bhttps?:\/\/\S+/g;
    const span2 = subspan(span1, urlrex, "url");  // this can be []

    // then rest
    const restex = /#\[\d+\]|#\S+|\b(nostr:)?(note|npub|nsec|nevent|nprofile|nrelay|naddr)1[0-9a-z]+/g;
    const span3 = subspan(span2, restex, "rest");

    const spanx = span3.map(s => ({ type: s.type, text: text.slice(s.from, s.to) }));

    return spanx.map(s => {
        const t = s.text;
        if (s.type === "rurl" || s.type === "url") {
            // const auto = !tev.tags.find(t => t[0] === "r" && t[1] === s.text);
            return { rawtext: t, type: "url", href: t, auto: s.type === "url" } as const;
        };
        if (s.type === "text") {
            return { rawtext: t, type: "text", text: t } as const;
        }

        // s.type === "rest"

        const mref = t.match(/^#\[(\d+)\]/);
        if (mref) {
            const ti = Number(mref[1]);
            const tag = tev.tags[ti] satisfies string[] as string[] | undefined;
            if (tag && tag[0] === "p") return { rawtext: t, type: "ref", tagindex: ti, tag, text: nip19.npubEncode(tag[1]), hex: tag[1] } as const;
            if (tag && tag[0] === "e") return { rawtext: t, type: "ref", tagindex: ti, tag, text: nip19.noteEncode(tag[1]), hex: tag[1] } as const;
            // we temporarily treat unknown reference as a text... note1g5vxkt9ge2xl7mecv2jw9us56n683zh8ksjn4pt4s952xuytv5aqsy5xnu
            // return { rawtext: t, type: "ref", tagindex: ti, tag, hex: null } as const;
            return { rawtext: t, type: "text", text: t } as const;
        }
        const mhash = t.match(/^#(\S+)/);
        if (mhash) {
            // hashtag t-tag may be normalized to smallcase
            const tag = tev.tags.find(t => t[0] === "t" && t[1].localeCompare(mhash[1], undefined, { sensitivity: "base" }) === 0);
            return { rawtext: t, type: "hashtag", text: mhash[1], tagtext: tag?.[1] || mhash[1], auto: !tag } as const;
        }
        const mnostr = t.match(/^(?:nostr:)?((?:note|npub|nsec|nevent|nprofile|nrelay|naddr)1[0-9a-z]+)/);
        if (mnostr) {
            const tt = ((): ({ hex: string; match: ((t: string[]) => boolean); } | undefined) => {
                const d = (() => { try { return nip19.decode(mnostr[1]); } catch { return undefined; } })();
                if (!d) return undefined;  // bad checksum?
                switch (d.type) {
                    case "nprofile": {
                        return { match: t => t[0] === "p" && t[1] === d.data.pubkey, hex: d.data.pubkey };
                    }
                    case "nevent": {
                        // we don't support Damus' #q
                        return { match: t => t[0] === "e" && t[1] === d.data.id, hex: d.data.id };
                    }
                    case "naddr": {
                        return undefined; // TODO
                    }
                    case "nsec": {
                        return undefined; // TODO
                    }
                    case "npub": {
                        return { match: t => t[0] === "p" && t[1] === d.data, hex: d.data };
                    }
                    case "note": {
                        // we don't support Damus' #q
                        return { match: t => t[0] === "e" && t[1] === d.data, hex: d.data };
                    }
                }
                return undefined;
            })();
            const tag = tt && tev.tags.find(tt.match);
            return { rawtext: t, type: "nip19", text: mnostr[1], hex: tt?.hex, auto: !tag } as const;
        }
        // should not reached here but last resort.
        return { rawtext: t, type: "text", text: t } as const;
    });
};

const Tabsview: FC = () => {
    const navigate = useNavigate();
    const data = useParams();
    const tabid = data["*"] || "";
    const [account] = useAtom(state.preferences.account);
    const [tabs, setTabs] = useAtom(state.tabs);
    const [tabstates, setTabstates] = useAtom(state.tabstates);
    const [closedtabs, setClosedtabs] = useAtom(state.closedTabs);
    const [tabzorder, setTabzorder] = useAtom(state.tabzorder);
    const [recentpubs, setRecentpubs] = useAtom(state.recentPubs);
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
    const streams = useMemo(() => new PostStreamWrapper(noswk), [noswk]);  // memo??
    const [identiconStore] = useAtom(state.identiconStore);
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
    const [relaypopping, setRelaypopping] = useState(false);
    const relaypopref = useRef<HTMLDivElement>(null);
    const [forcedellatch, setForcedellatch] = useState({ count: 0, at: 0 });
    const [status, setStatus] = useState("status...");
    const [edittags, setEdittags] = useState<string[][] | null>(null);
    const [kind, setKind] = useState<number | null>(null);
    const [editingtag, setEditingtag] = useState<[number, number] | null>(null);
    const [editingtagdelay, setEditingtagdelay] = useState<[number, number] | null>(null);
    const editingtagref = useRef<HTMLInputElement>(null);
    const editingtagaddref = useRef<HTMLDivElement>(null);
    const [posting, setPosting] = useState(false);
    const [postpopping, setPostpopping] = useState(false);
    const postpopref = useRef<HTMLDivElement>(null);

    const relayinfo = useSyncExternalStore(
        useCallback(storeChange => {
            const handler = (ev: MuxRelayEvent): void => storeChange();
            noswk.onHealthy.on("", handler);
            return () => { noswk.onHealthy.off("", handler); };
        }, []),
        useCallback((() => {
            let v: { all: number; healthy: number; relays: RelayWrap[]; } | null = null;
            return () => {
                const rs = noswk.getRelays();
                const all = rs.length;
                const healthy = rs.filter(r => r.healthy).length;
                if (!v || v.all !== all || v.healthy !== healthy) {
                    v = { all, healthy, relays: rs.map(r => r.relay) };
                }
                return v;
            };
        })(), [])
    );
    const fetchqlen = useSyncExternalStore(
        useCallback(storeChange => {
            const handler = (ev: { length: number; }): void => storeChange();
            noswk.onFetch.on("", handler);
            return () => { noswk.onFetch.off("", handler); };
        }, []),
        useCallback(() => noswk.fetchqlen(), [])
    );

    const tab = useCallback(() => {
        const tab = tabs.find(t => t.id === tabid);
        if (tab) {
            if (tabzorder[tabzorder.length - 1] !== tabid) {
                setTabzorder([...tabzorder.filter(t => t !== tabid), tabid]);
            }
            return tab;
        }
        const ctab = closedtabs.find(t => t.id === tabid);
        if (ctab) {
            setClosedtabs(ctabs => ctabs.filter(t => t.id !== ctab.id));
            setTabs(tabs => [...tabs.filter(t => t.id !== ctab.id), ctab]);  // FIXME: this called twice. to avoid dupe tabs, filtering.
            return ctab;
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
                    if (tabid !== `p/${pk}`) {
                        navigate(`/tab/p/${pk}`, { replace: true });
                    }
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
                        filter: [{ ids: [nid]/* , kinds: [Kinds.post], *//* , limit: 1 */ }],
                    };
                    setTabs([...tabs, newt]);
                    setTabstates(produce(draft => { draft.set(newt.id, newtabstate()); }));
                    if (tabid !== `e/${nid}`) {
                        navigate(`/tab/e/${nid}`, { replace: true });
                    }
                    return newt;
                }
            }
        }
        {
            const mt = tabid.match(/^thread\/((note|nevent)1[a-z0-9]+|[0-9A-Fa-f]{64})$/);
            if (mt) {
                const nid = (() => {
                    if (mt[1].match(/[0-9A-Fa-f]{64}/)) {
                        return mt[1];
                    }
                    const d = (() => { try { return nip19.decode(mt[1]); } catch { return undefined; } })();
                    if (!d) return null;
                    if (d.type === "note") return d.data;
                    if (d.type === "nevent") return d.data.id;
                    return null;
                })();
                if (nid) {
                    // TODO: relay from nevent
                    const newt: Tabdef = {
                        id: `thread/${nid}`,
                        name: `t/${nid.slice(0, 8)}`,
                        // don't limit to post to fetch also repost/reaction/zap/etc.
                        filter: [{ ids: [nid]/* , kinds: [Kinds.post] *//* , limit: 1 */ }, { "#e": [nid]/* , kinds: [Kinds.post] */ }],
                    };
                    setTabs([...tabs, newt]);
                    setTabstates(produce(draft => { draft.set(newt.id, newtabstate()); }));
                    if (tabid !== `thread/${nid}`) {
                        navigate(`/tab/thread/${nid}`, { replace: true });
                    }
                    return newt;
                }
            }
        }
        {
            const ma = tabid.match(/^a\/(naddr1[a-z0-9]+|\d{1,5}:[0-9A-Fa-f]{64}:.+)$/);
            if (ma) {
                const naddr = ((): nip19.AddressPointer | null => {
                    const mar = ma[1].match(/^(\d{1,5}):([0-9A-Fa-f]{64}):(.+)$/);
                    if (mar) {
                        return {
                            kind: Number(mar[1]),
                            pubkey: mar[2],
                            identifier: mar[3],
                        };
                    }
                    const d = (() => { try { return nip19.decode(ma[1]); } catch { return undefined; } })();
                    if (!d) return null;
                    if (d.type === "naddr") return d.data;
                    return null;
                })();
                if (naddr) {
                    const nid = `${naddr.kind}:${naddr.pubkey}:${naddr.identifier}`;
                    // TODO: relay from naddr
                    const newt: Tabdef = {
                        id: `a/${nid}`,
                        name: `a/${naddr.identifier.slice(0, 8)}`,
                        filter: [{ kinds: [naddr.kind], authors: [naddr.pubkey], "#d": [naddr.identifier] }],
                    };
                    setTabs([...tabs, newt]);
                    setTabstates(produce(draft => { draft.set(newt.id, newtabstate()); }));
                    if (tabid !== `a/${nid}`) {
                        navigate(`/tab/a/${nid}`, { replace: true });
                    }
                    return newt;
                }
            }
        }
    }, [tabs, tabid, tabzorder, closedtabs])();

    const tap = useSyncExternalStore(
        useCallback((onStoreChange) => {
            if (!tab) return () => { };
            const onChange = (msg: NostrWorkerListenerMessage) => { msg.type !== "eose" && msg.name === tab.id && onStoreChange(); };
            streams.addListener(tab.id, onChange);
            return () => streams.removeListener(tab.id, onChange);
        }, [streams, tab?.id]),
        useCallback(() => {
            if (!tab) return undefined;
            return streams.getPostStream(tab.id);
        }, [streams, tab?.id]),
    );

    const postindexwithhint = useCallback((posts: Post[], cursor: { id: string | null, index: number | null; }) => {
        if (!cursor.id) return null;
        if (cursor.index !== null && posts[cursor.index]?.id === cursor.id) {
            return cursor.index;
        }
        const ev = noswk.getPost(cursor.id)?.event?.event?.event;
        if (!ev) return null;
        return postindex(posts, ev);
    }, [noswk]);

    useEffect(() => {
        if (!tab) return;
        const onChange = (msg: NostrWorkerListenerMessage) => {
            if (msg.type !== "event") return;
            if (msg.name !== tab.id) return;
            setListscrollto({ lastIfVisible: true });
        };
        streams.addListener(tab.id, onChange);
        return () => streams.removeListener(tab.id, onChange);
    }, [streams, tab?.id]);
    useEffect(() => {
        const handler = (ev: MuxRelayEvent): void => {
            setStatus(ev.event === "connected" ? `connected: ${ev.relay.url}` : `disconnected:${ev.reason ? `${String(ev.reason)}: ` : ""} ${ev.relay.url}`);
        };
        noswk.onHealthy.on("", handler);
        return () => { noswk.onHealthy.off("", handler); };
    }, []);
    useEffect(() => {
        const lnr = ({ relay, msg }: { relay: Relay; msg: string; }) => {
            setStatus(`${msg} (${relay.url})`);
        };
        noswk.onNotice.on("", lnr);
        return () => noswk.onNotice.off("", lnr);
    });
    useEffect(() => {
        const lnr = ({ relay, challenge }: { relay: Relay; challenge: string; }) => {
            setStatus(`needs auth ENOTIMPL: ${relay.url}`);
        };
        noswk.onAuth.on("", lnr);
        return () => noswk.onAuth.off("", lnr);
    });
    useEffect(() => {
        streams.setMutes({ users: [...muteuserpublic, ...muteuserprivate, ...muteuserlocal], regexs: muteregexlocal });
    }, [streams, muteuserpublic, muteuserprivate, muteuserlocal, muteregexlocal]);
    const tas = !tab ? undefined : tabstates.get(tab.id);
    const selpost = !tas?.selected?.id ? undefined : noswk.getPost(tas.selected.id);
    const selev = selpost?.event;
    const selrpev = selpost?.reposttarget;
    const speeds = useCallback((() => {
        let sp = { mypostph: 0, reactph: 0, allnoteph: 0, name: "" as string | undefined, at: 0 };
        return (name: string | undefined, posts: Post[] | undefined) => {
            const now = Date.now();
            if ((sp.name !== name || sp.at + 60000 < now) && posts) {
                sp.name = name;
                const hourago = now - 3600000;
                const hagosec = hourago / 1000;
                const i = bsearchi(posts, p => hagosec <= p.event!.event!.event.created_at);
                const hourposts = posts.slice(i);
                sp.mypostph = hourposts.filter(p => p.event!.event!.event.pubkey === account?.pubkey).length;
                sp.reactph = hourposts.filter(p => p.myreaction).length;
                sp.allnoteph = hourposts.length;
            }
            return sp;
        };
    })(), [account])(tab?.id, tap?.posts);
    const readonlyuser = !(account && "privkey" in account) && !window.nostr?.signEvent;
    // fix stale selection.index
    if (tab && tap && tas && tas.selected.id) {
        const index = postindexwithhint(tap.posts, tas.selected);
        if (index !== null && tas.selected.index !== index) {  // should not be null
            setTabstates(produce(draft => {
                getmk(draft, tab.id, newtabstate).selected.index = index;
            }));
        }
    }
    const onselect = useCallback((sel: { id: string; index: number; }, toTop?: boolean) => {
        if (!tab || !tap) return;
        noswk.setHasread({ id: sel.id }, true);
        setTabstates(produce(draft => { getmk(draft, tab.id, newtabstate).selected = sel; }));
        setListscrollto({ index: sel.index, toTop });
        textref.current?.scrollTo(0, 0);
    }, [tab?.id, tap, noswk]);
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
    // useEffect(() => {
    //     const el = editingtagref.current;
    //     if (!el) return;
    //     el.focus();
    // }, [editingtag]);  // !!
    useEffect(() => {
        // FIXME: SUPER hacky
        setEditingtagdelay(editingtag);
    }, [editingtag]);
    useEffect(() => {
        if (!editingtagdelay) return;
        if (editingtagdelay[0] === -1) {
            const el = editingtagaddref.current;
            if (!el) return;
            el.focus();
        } else {
            const el = editingtagref.current;
            if (!el) return;
            el.focus();
        }
    }, [editingtagdelay]);  // !!!!
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
            onselect({ id: tap.posts[i].id, index: i }, true);
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
    const broadcast = useCallback((event: Event, desc: string) => {
        setStatus(`emiting... ${desc}`);
        const postAt = Date.now();
        const post = noswk.postEvent(event);

        // FIXME: I dunno why onFailed gives non-trailing-slash but onOk is trailing-slashed.
        //        we do normalizeURL to avoid that diff... but that itself is something wrong.
        const repo: RecentPost = {
            desc,
            event,
            postAt,
            postByRelay: new Map(post.relays.map(r => [utils.normalizeURL(r.relay.relay.url), null])),
            pub: post.pub,
        };
        recentpubs.slice(4).forEach(rp => rp.pub.forget());
        setRecentpubs(r => [repo, ...r.slice(0, 4)]);
        post.pub.on("ok", recv => setRecentpubs(produce(draft => {
            const repo = draft.find(r => r.event.id === event.id);
            if (!repo) return;
            const recvAt = Date.now();
            for (const r of recv) {
                repo.postByRelay.set(utils.normalizeURL(r.relay.url), { relay: r.relay.url, recvAt, ok: true, reason: r.reason });
            }
        })));
        post.pub.on("failed", recv => setRecentpubs(produce(draft => {
            const repo = draft.find(r => r.event.id === event.id);
            if (!repo) return;
            const recvAt = Date.now();
            repo.postByRelay.set(utils.normalizeURL(recv.relay), { relay: recv.relay, recvAt, ok: false, reason: String(recv.reason) });
        })));
        // TODO: timeout? pub.on("forget", () => { });
    }, [noswk, recentpubs]);
    const emitevent = useCallback(async (tev: EventTemplate, desc: string) => {
        setStatus(`signing... ${desc}`);
        const event = await (async () => {
            if (account && "privkey" in account) {
                return finishEvent(tev, account.privkey);
            } else if (window.nostr?.signEvent) {
                const sev = await window.nostr.signEvent(tev);
                if (sev.pubkey !== account?.pubkey) {
                    throw new Error(`NIP-07 set unexpected pubkey for: ${desc} (pk=${sev.pubkey}, expected=${account?.pubkey})`);
                }
                return sev;
            } else {
                throw new Error(`could not sign: no private key nor NIP-07 signEvent; ${desc}`);
            }
        })();
        broadcast(event, desc);
    }, [account, window.nostr, broadcast]);
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tagName = (((e.target as any).tagName as string) || "").toLowerCase(); // FIXME
            if (tagName === "input" || tagName === "textarea" || tagName === "button") {
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }
            if (e.isComposing) {
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
                    case "I": {
                        if (linksel === null) {
                            break;
                        }

                        const text = linkpop[linksel].text;
                        if (text.match(/^(note|nevent)1/)) {
                            const nid = (() => {
                                const d = (() => { try { return nip19.decode(text); } catch { return undefined; } })();
                                if (!d) return null;
                                if (d.type === "note") return d.data;
                                if (d.type === "nevent") return d.data.id;
                                return null;
                            })();
                            if (!nid) { break; }

                            setLinkpop([]);
                            setLinksel(null);
                            listref.current?.focus();

                            navigate(`/tab/thread/${nid}`);
                            break;
                        }

                        setFlash({ msg: "sorry not supported yet", bang: true });
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

                        // XXX: we should use raw-form instead of bech32, to avoid redundant navigate()
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
                        if (text.match(/^naddr1/)) {
                            if (!expectn(text, "naddr")) { break; }
                            navigate(`/tab/a/${text}`);
                            break;
                        }
                        const rmhash = text.match(/^#(.+)/);
                        if (rmhash) {
                            const id = crypto.randomUUID();
                            setTabs([...tabs.filter(t => t.id !== id), {
                                id,
                                name: `#${rmhash[1].slice(0, 8)}`,
                                filter: [{ "#t": [rmhash[1]], limit: 30 }],
                            }]);
                            setTabstates(produce(draft => { draft.set(id, newtabstate()); }));
                            navigate(`/tab/${id}`);
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
            if (relaypopping) {
                switch (e.key) {
                    case "Escape": {
                        setRelaypopping(false);
                        listref.current?.focus();
                        return;
                    }
                }
                // return;
            }
            if (postpopping) {
                switch (e.key) {
                    case "Escape": {
                        setPostpopping(false);
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
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    const i = ci === null ? 0 : ci + 1;
                    if (i < tap.posts.length) {
                        const id = tap.posts[i].id;
                        onselect({ id, index: i });
                    }
                    break;
                }
                case "k": {
                    if (!tas || !tap) break;
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    const i = ci === null ? (0 < tap.posts.length ? 0 : null) : ci - 1;
                    if (i !== null && 0 <= i) {
                        const id = tap.posts[i].id;
                        onselect({ id, index: i });
                    }
                    break;
                }
                case "h": {
                    if (!tas || !tap) break;
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    if (ci === null) break;
                    const ev = tap.posts[ci].event?.event;
                    if (!ev) break;
                    const pk = ev.event.pubkey;
                    for (let i = ci - 1; 0 <= i; i--) {
                        const p = tap.posts[i];
                        if (p.event?.event?.event?.pubkey === pk) {
                            onselect({ id: p.id, index: i });
                            break;
                        }
                    }
                    break;
                }
                case "l": {
                    if (!tas || !tap) break;
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    if (ci === null) break;
                    const l = tap.posts.length;
                    const ev = tap.posts[ci].event?.event;
                    if (!ev) break;
                    const pk = ev.event.pubkey;
                    for (let i = ci + 1; i < l; i++) {
                        const p = tap.posts[i];
                        if (p.event?.event?.event?.pubkey === pk) {
                            onselect({ id: p.id, index: i });
                            break;
                        }
                    }
                    break;
                }
                case "[": {
                    if (!tas || !tap || !tab) break;
                    if (tas.selected.id === null) break;
                    // const ci = postindexwithhint(tap.posts, tas.selected);
                    // if (ci === null) break;
                    // const selpost = tap.posts[ci];
                    if (!selpost) break;  //!?
                    const ev = selpost.reposttarget || selpost.event!;
                    // get reply target #e. (if no "reply" marker) NIP-10 states that.
                    const etag = ev.event!.event.tags.reduce<string[] | undefined>((p, c) => c[0] !== "e" ? p : p?.[3] === "reply" ? p : c, undefined);
                    const replye = etag?.[1];
                    if (!replye) break;
                    const lp = noswk.getPost(replye);
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
                    onselect({ id: replye, index: ei });
                    break;
                }
                case "]": {
                    if (!tas || !tap || !tab) break;
                    if (tas.selected.id === null) break;
                    // const ci = postindexwithhint(tap.posts, tas.selected);
                    // if (ci === null) break;
                    // const selpost = tap.posts[ci];
                    if (!selpost) break;  //!?

                    const target = (() => {
                        const rp = [...tas.replypath];

                        const rpi = (() => {
                            // potentially repost itself have priority
                            const i1 = rp.indexOf(selpost.event!.id);
                            if (i1 !== -1) return i1;

                            const rtid = selpost.reposttarget?.id;
                            const i2 = !rtid ? -1 : rp.indexOf(rtid);
                            if (i2 !== -1) return i2;
                            return -1;
                        })();

                        if (rpi !== -1) {
                            const id = rp[rpi + 1];
                            if (id) {
                                const p = noswk.getPost(id);
                                // p===null: lru'ed!?
                                if (p) {
                                    const index = postindex(tap.posts, p.event!.event!.event);
                                    // index===null caused by stale replypath. maybe by updated mute.
                                    // TODO: may move tab? what if already closed?
                                    if (index !== null) {
                                        return { id: id, index };
                                    }
                                }
                            }
                            // fallthrough: failing path-digging fallbacks to find ref'er.
                        }

                        const nrp = (rpi === -1) ? [] : rp;
                        // find next referencing... but sometimes created_at swaps. offset.
                        // note1m4dx8m2tmp3nvpa7s4uav4m7p9h8pxyelxvn3y5j4peemsymvy5svusdte
                        const st = selpost.event!.event!.event.created_at - 60;
                        const si = bsearchi(tap.posts, p => st < p.event!.event!.event.created_at);
                        const l = tap.posts.length;
                        const id = selpost.id;
                        for (let i = si; i < l; i++) {
                            const p = tap.posts[i];
                            if (p.event!.event!.event.tags.find(t => t[0] === "e" && t[1] === id)) {
                                nrp.push(p.id);
                                setTabstates(produce(draft => { getmk(draft, tab.id, newtabstate).replypath = nrp; }));  // sideeffect!!
                                return { id: p.id, index: i };
                            }
                        }

                        return null;
                    })();
                    if (!target) break;  // not found
                    onselect(target);
                    break;
                }
                case "Enter": {
                    if (e.shiftKey) {
                        setPostpopping(s => !s);
                    } else {
                        if (!selev) break;
                        if (selpost.event?.event?.event.kind === Kinds.repost && !selpost.reposttarget) break;
                        if (readonlyuser) break;
                        const derefev = selrpev || selev;

                        if (derefev.event?.event?.kind === Kind.EncryptedDirectMessage) {
                            setFlash({ msg: "Replying DM is not implemented", bang: true });
                            break;
                        }

                        // copy #p tags, first reply-to, merged. (even if originate contains duplicated #p)
                        const ppks = new Map();
                        if (derefev.event?.event?.pubkey) {
                            // TODO: relay/petname in tag from receivefrom/{contacts|profile}? really?
                            ppks.set(derefev.event.event.pubkey, ["p", derefev.event.event.pubkey]);
                        }
                        for (const tag of edittags || []) {  // from currently editing
                            if (tag[0] !== "p") continue;
                            ppks.set(tag[1], tag);
                        }
                        for (const tag of derefev.event?.event?.tags || []) {  // from reply target
                            if (tag[0] !== "p") continue;
                            ppks.set(tag[1], tag);
                        }
                        const ptags = [...ppks.values()];
                        // then combine. when for root, only root, without reply. (NIP-10 #e)
                        // XXX: also include original "#e"s? (Damus way?) I think it's not right.
                        //      * we don't mentioning it in posting note (although it's marker will be "mention")
                        //      * considering the case of fetching only sub-reply-tree, copying "root" is enough. it's too much to copying "#e"s.
                        const root = (derefev.event?.event?.tags || []).reduce<string[] | null>((p, c) => (c[0] === "e" && (c[3] === "root" || p === null)) ? c : p, null);
                        // TODO: relay in tag from receivefrom? really?
                        // TODO: kind40/41/42 to kind42
                        setEdittags([
                            (root ? [root[0], root[1], root[2] || "", "root"] : ["e", (selrpev || selev).id, "", "root"]),
                            ...(root ? [["e", derefev.id, "", "reply"]] : []),
                            ...ptags,
                        ]);
                        setKind(([Kind.ChannelCreation, Kind.ChannelMetadata, Kind.ChannelMessage] as number[]).includes(derefev.event?.event?.kind || 0) ? Kind.ChannelMessage : Kind.Text);
                        posteditor.current?.focus();
                        e.preventDefault();
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
                        onselect({ id: tap.posts[i].id, index: i });
                    }
                    break;
                }
                case "G": {
                    if (!tap) break;
                    const i = tap.posts.length - 1;
                    if (0 <= i) {
                        onselect({ id: tap.posts[i].id, index: i });
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
                                ls.set(text, { text: `#${s.text}`, auto: s.auto });
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
                        // we don't support Damus' #q
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
                            case "a": {
                                const am = t[1].match(/^(\d{1,5}):([0-9A-Fa-f]{64}):(.+)$/);
                                if (!am) break;
                                const text = nip19.naddrEncode({ kind: Number(am[1]), pubkey: am[2], identifier: am[3] });
                                ls.set(text, { text, auto: false });
                                break;
                            }
                            case "t": {
                                const text = `#${t[1]}`;
                                ls.set(text, { text, auto: false });
                                break;
                            }
                            case "r": {
                                // usually URL but not guaranteed.
                                const text = t[1];
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
                    if (!tas || !tab || !tap) break;
                    if (tas.selected.id === null) break;
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    if (ci === null) break;
                    const ev = tap.posts[ci].event?.event?.event;
                    if (!ev) break;
                    // index may not match between noswk.stream and noswkwrapper.posts
                    const i = postindex(noswk.getPostStream(tab.id)?.posts || [], ev);
                    if (i === null) break;
                    noswk.setHasread({ stream: tab.id, afterIndex: i }, false);
                    break;
                }
                case "B": {
                    if (!tas || !tab || !tap) break;
                    if (tas.selected.id === null) break;
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    if (ci === null) break;
                    const ev = tap.posts[ci].event?.event?.event;
                    if (!ev) break;
                    // index may not match between noswk.stream and noswkwrapper.posts
                    const i = postindex(noswk.getPostStream(tab.id)?.posts || [], ev);
                    if (i === null) break;
                    noswk.setHasread({ stream: tab.id, beforeIndex: i }, true);
                    break;
                }
                case "u": {
                    setProfpopping(s => !s);
                    break;
                }
                case "U": {
                    if (!tas || !tap) break;
                    if (tas.selected.id === null) break;
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    if (ci === null) break;
                    const post = tap.posts[ci];
                    // TODO: should popup which user should be opened. like linkpop. default dereferenced.
                    const pk = (post.reposttarget || post.event!).event!.event.pubkey;
                    navigate(`/tab/p/${pk}`);
                    break;
                }
                case "I": {
                    if (!tas || !tap) break;
                    if (tas.selected.id === null) break;
                    const ci = postindexwithhint(tap.posts, tas.selected);
                    if (ci === null) break;
                    const post = tap.posts[ci];
                    const dereftags = (post.reposttarget?.event || post.event?.event)?.event?.tags || [];
                    const rootid = dereftags.reduce<string[] | null>((p, c) => c[0] === "e" && (!p || c[3] === "root") ? c : p, null)?.[1];
                    const id = rootid || (post?.reposttarget?.id || post.id);
                    navigate(`/tab/thread/${id}`);
                    break;
                }
                case "W": {
                    if (!tab) break;
                    if (typeof tab.filter === "string") {
                        setFlash({ msg: "Cannot close system tabs", bang: true });
                    } else {
                        setTabs(tabs.filter(t => t.id !== tab.id));
                        setTabstates(produce(draft => { draft.delete(tab.id); }));
                        setClosedtabs([tab, ...closedtabs.filter(t => t.id !== tab.id).slice(0, 4)]);  // "unreads" etc. may dupe
                        const newzorder = tabzorder.filter(t => t !== tab.id);
                        setTabzorder(newzorder);
                        navigate(`/tab/${newzorder[newzorder.length - 1] || tabs[0].id}`);
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
                    noswk.overwritePosts(id, tap!.posts.filter(p => !p.hasread));
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
                            : JSON.stringify(typeof tab.filter === "string" ? noswk.getFilter(tab.filter) : tab.filter, undefined, 1);
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
                case "y": {
                    setRelaypopping(s => !s);
                    break;
                }
                case "F": {
                    if (!tab || !selpost) break;
                    if (selpost.event?.event?.event.kind === Kinds.repost && !selpost.reposttarget) break;
                    const derefev = selpost.reposttarget || selpost.event;
                    if (!derefev) break; // XXX: should not happen
                    const targetev = derefev.event?.event;
                    if (!targetev) break; // XXX: should not happen
                    // FIXME: favoriting repost have a bug... on receive side.
                    const { desc, event: tev } = (() => {
                        if (!selpost.myreaction || selpost.myreaction.deleteevent) {
                            // reaction: copy #e and #p. last #e and #p must be reacted event/pubkey.
                            // TODO: popup content selection?
                            const etags = new Map<string, string[]>();
                            const ptags = new Map<string, string[]>();
                            for (const t of targetev.tags || []) {
                                if (t[0] === "e") {
                                    etags.set(t[1], t);
                                }
                                if (t[0] === "p") {
                                    ptags.set(t[1], t);
                                }
                            }
                            etags.delete(targetev.id);
                            ptags.delete(targetev.pubkey);
                            return {
                                desc: `⭐${targetev.content}`,
                                event: {
                                    created_at: Math.floor(Date.now() / 1000),
                                    kind: Kind.Reaction,
                                    content: "+",
                                    tags: [
                                        ...[...etags.values()],
                                        ["e", derefev.id],  // TODO: relay?
                                        ...[...ptags.values()],
                                        ["p", targetev.pubkey],  // TODO: relay and petname?
                                    ],
                                },
                            };
                        } else {
                            // delete reaction
                            return {
                                desc: `❌⭐${targetev.content}`,
                                event: {
                                    created_at: Math.floor(Date.now() / 1000),
                                    kind: Kind.EventDeletion,
                                    content: "",
                                    tags: [
                                        ["e", selpost.myreaction.id],  // TODO: relay?
                                    ],
                                },
                            };
                        }
                    })();
                    emitevent(tev, desc)
                        .then(
                            () => setStatus(`✔${desc}`),
                            e => {
                                console.error(`${timefmt(new Date(), "YYYY-MM-DD hh:mm:ss.SSS")} reaction failed: ${e}`);
                                setStatus(`💔⭐${e}`);
                            });
                    break;
                }
                case "R": {
                    if (!tab || !selpost) break;
                    if (selpost.event?.event?.event.kind === Kinds.repost && !selpost.reposttarget) break;
                    const derefev = selpost.reposttarget || selpost.event;
                    if (!derefev) break; // XXX: should not happen
                    const derev = derefev.event;
                    if (!derev) break; // XXX: should not happen
                    const targetev = derev.event;
                    if (!targetev) break; // XXX: should not happen
                    const recvfrom: Relay = derev.receivedfrom.keys().next().value;
                    if (!recvfrom) break; // XXX: should not happen

                    const tev = {
                        created_at: Math.floor(Date.now() / 1000),
                        kind: Kinds.repost,
                        content: "",
                        tags: [
                            ["e", derefev.id, recvfrom.url],
                            ["p", targetev.pubkey],  // TODO: relay and petname?
                        ],
                    };
                    const desc = `👁‍🗨${targetev.content}`;
                    emitevent(tev, desc)
                        .then(
                            () => setStatus(`✔${desc}`),
                            e => {
                                console.error(`${timefmt(new Date(), "YYYY-MM-DD hh:mm:ss.SSS")} repost failed: ${e}`);
                                setStatus(`💔👁‍🗨${e}`);
                            });
                    break;
                }
                case "q": {
                    if (!selev) break;
                    if (selpost.event?.event?.event.kind === Kinds.repost && !selpost.reposttarget) break;
                    if (readonlyuser) break;
                    const derefev = selrpev || selev;

                    if (derefev.event?.event?.kind === Kind.EncryptedDirectMessage) {
                        setFlash({ msg: "Don't quote a DM", bang: true });
                        break;
                    }

                    // just #e that is mentioning. no copying or adding #p from quoting.
                    // but keep edittags.
                    // TODO: relay in tag from receivefrom? really?
                    setEdittags(t => [
                        ["e", (selrpev || selev).id, "", "mention"],
                        ...(t || []),
                    ]);
                    setKind(k => k ?? Kind.Text);
                    // TODO: nevent quoting option
                    setPostdraft(s => `${s || ""} nostr:${nip19.noteEncode((selrpev || selev).id)}`);
                    posteditor.current?.focus();
                    e.preventDefault();
                    break;
                }
                case "E": {
                    if (!tab || !selpost) break;
                    if (selpost.event?.event?.event.kind === Kinds.repost && !selpost.reposttarget) break;
                    // TODO: should popup which event should be broadcasted. like linkpop.
                    const derefev = selpost.reposttarget || selpost.event;
                    if (!derefev) break; // XXX: should not happen
                    // broadcasting kind5 event have higher priority.
                    const { event: targetev, desc } = (() => {
                        const tev = derefev.event?.event;
                        const dev = derefev.deleteevent?.event;
                        if (dev) {
                            return { event: dev, desc: `❌📣${tev ? tev.content : dev.content}` };
                        }
                        return { event: tev, desc: `📣${tev?.content}` };
                    })();
                    if (!targetev) break; // XXX: should not happen
                    try {
                        broadcast(targetev, desc);
                        setStatus(`✔${desc}`);
                    } catch (e) {
                        console.error(`${timefmt(new Date(), "YYYY-MM-DD hh:mm:ss.SSS")} broadcast failed: ${e}`);
                        setStatus(`💔📣${e}`);
                    }
                    break;
                }
                case "D": {
                    if (!tab || !selpost) break;
                    // even it is reposted, target is itself.
                    const dev = selpost.event;
                    if (!dev) break; // XXX: should not happen
                    if (dev.deleteevent) {
                        setFlash({ msg: "Already deleted", bang: true });
                        break;
                    }
                    const targetev = dev.event?.event;
                    if (!targetev) break; // XXX: should not happen
                    if (targetev.pubkey !== account?.pubkey) {
                        const recent = Date.now() < forcedellatch.at + 1000;
                        if (!recent || forcedellatch.count < 4) {
                            setForcedellatch(recent ? { ...forcedellatch, count: forcedellatch.count + 1 } : { count: 1, at: Date.now() });
                            setFlash({ msg: "Don't delete someone's", bang: true });
                            break;
                        }
                    }
                    const desc = `❌${targetev.content}`;
                    emitevent({
                        created_at: Math.floor(Date.now() / 1000),
                        kind: Kind.EventDeletion,
                        content: "",  // TODO: reason?
                        tags: [
                            ["e", targetev.id],  // we should not add a relay... that may be a hint of original.
                        ],
                    }, desc)
                        .then(
                            () => setStatus(`✔${desc}`),
                            e => {
                                console.error(`${timefmt(new Date(), "YYYY-MM-DD hh:mm:ss.SSS")} deletion failed: ${e}`);
                                setStatus(`💔❌${e}`);
                            },
                        );
                    break;
                }
                case "<": {
                    navigate("/preferences");
                    break;
                }
                case "/": {
                    break;
                }
                case "?": {
                    navigate("/about");
                    break;
                }
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [tabs, tab, tap, tas, onselect, evinfopopping, linkpop, linksel, profpopping, nextunread, closedtabs, tabzorder, tabpopping, tabpopsel, restoretab, overwritetab, newtab, relaypopping, readonlyuser, postpopping, emitevent, forcedellatch]);
    const post = useCallback(() => {
        if (kind === null) {
            setFlash({ msg: "kind is not set!?", bang: true });
            return;
        }
        const ev = {
            created_at: Math.floor(Date.now() / 1000),
            kind,
            content: postdraft,
            tags: edittags!,
        };
        setPosting(true);
        emitevent(ev, `💬${postdraft}`)
            .then(
                () => {
                    setStatus(`✔💬: ${postdraft}`);
                    setPostdraft("");
                    setEdittags(null);
                    setEditingtag(null);
                    setKind(null);
                    setPosting(false);
                },
                e => {
                    console.error(`${timefmt(new Date(), "YYYY-MM-DD hh:mm:ss.SSS")} post failed: ${e}`);
                    setStatus(`💔💬: ${e}`);
                    setPosting(false);
                    posteditor.current?.focus();
                },
            );
    }, [kind, postdraft, edittags, emitevent]);
    useEffect(() => {
        const handler = (e: PointerEvent) => {
            if (!evinfopopref.current?.contains(e.target as any)) {
                setEvinfopopping(false);
            }
            if (!profpopref.current?.contains(e.target as any)) {
                setProfpopping(false);
            }
            if (!tabpopref.current?.contains(e.target as any)) {
                setTabpopping(false);
                setTabpopsel(-999);
            }
            if (!linkpopref.current?.contains(e.target as any)) {
                setLinkpop([]);
                setLinksel(null);
            }
            if (!relaypopref.current?.contains(e.target as any)) {
                setRelaypopping(false);
            }
            if (!postpopref.current?.contains(e.target as any)) {
                setPostpopping(false);
            }
        };
        document.addEventListener("pointerdown", handler);
        return () => document.removeEventListener("pointerdown", handler);
    }, []);
    useEffect(() => {
        // FIXME: this code block smells.
        // FIXME: this code breaks when selev changed while fetching.
        if (selev?.event) {
            let cachedrpauthor: DeletableEvent | null | undefined;
            const cachedauthor = noswk.getProfile(selev.event.event.pubkey, Kinds.profile, ev => {
                setTimeout(() => {
                    const cachedauthor = ev;
                    setAuthor(metadatajsoncontent(ev));

                    if (cachedrpauthor || cachedauthor) {
                        setProf(p => ({ ...p, metadata: cachedrpauthor || cachedauthor }));
                    } else {
                        setProf(p => ({ ...p, metadata: null, contacts: null }));
                    }
                }, 0);
            }, undefined, profpopping ? 5 * 60 * 1000 : undefined);
            setAuthor(cachedauthor && metadatajsoncontent(cachedauthor));
            if (selrpev?.event) {
                cachedrpauthor = noswk.getProfile(selrpev.event.event.pubkey, Kinds.profile, ev => {
                    setTimeout(() => {
                        cachedrpauthor = ev;
                        setRpauthor(metadatajsoncontent(ev));

                        if (cachedrpauthor || cachedauthor) {
                            setProf(p => ({ ...p, metadata: cachedrpauthor || cachedauthor }));
                        } else {
                            setProf(p => ({ ...p, metadata: null, contacts: null }));
                        }
                    }, 0);
                }, undefined, profpopping ? 5 * 60 * 1000 : undefined);
                setRpauthor(cachedrpauthor && metadatajsoncontent(cachedrpauthor));
            }

            if (profpopping) {
                if (cachedrpauthor || cachedauthor) {
                    setProf(p => ({ ...p, metadata: cachedrpauthor || cachedauthor }));
                } else {
                    setProf(p => ({ ...p, metadata: null, contacts: null }));
                }

                const cachedcontacts = noswk.getProfile((selrpev?.event || selev.event).event.pubkey, Kinds.contacts, ev => {
                    setProf(p => ({ ...p, contacts: ev }));
                }, undefined, 5 * 60 * 1000);
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
            // need to in useEffect
            navigate(`/tab/${tabs[0].id}`, { replace: true });
            console.debug(tab, tabs[0]);
        }
    }, [tab]);

    return <>
        <Helmet>
            <title>{tab?.name || ""} - nosteen</title>
        </Helmet>
        <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
            <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column", cursor: "default", position: "relative" }}>
                {<TheList
                    posts={tap?.posts || []}
                    mypubkey={account?.pubkey}
                    selection={tas?.selected?.index ?? null}
                    ref={listref}
                    onSelect={onselect}
                    onScroll={() => {
                        if (!tab) return;
                        setTabstates(produce(draft => {
                            getmk(draft, tab.id, newtabstate).scroll = listref.current?.scrollTop || 0; // use event arg?
                        }));
                    }}
                    onFocus={e => {
                        if (postdraft === "") {
                            setEdittags(null);
                            setEditingtag(null);
                            setKind(null);
                        }
                    }}
                    scrollTo={listscrollto}
                />}
                <div style={{
                    display: "flex",
                    alignItems: "flex-start",
                    overflow: "visible",
                    lineHeight: "1em",
                    background: coloruibg,
                    border: "2px inset",
                    padding: "0 0 0 2px",
                }}>
                    <div style={{ flex: "1", display: "flex", alignItems: "flex-start", overflow: "visible" }}>
                        {tabs.map(t =>
                            <Tab key={t.id} style={{ overflow: "visible", padding: t.id === tab?.id ? `2px 2px 3px` : `1px 0 0` }} active={t.id === tab?.id} onClick={() => navigate(`/tab/${t.id}`)}>
                                <div style={{ position: "relative", padding: "0 0.5em" }}>
                                    {/* TODO: nunreads refresh only on active tab... */}
                                    <div style={{ position: "relative", color: 0 < streams.getPostStream(t.id)!.nunreads ? "red" : undefined }}>
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
                        {!selev ? <></> : <img style={{ maxWidth: "100%" }} src={identiconStore.png(selrpev?.event?.event?.pubkey || selev.event!.event.pubkey)} />}
                    </div>
                </div>
                <div style={{ flex: "1", minWidth: "0", /* display: "flex", flexDirection: "column" */ }}>
                    <div style={{ color: coloruitext, font: fontui, /* fontWeight: "bold", */ margin: "0 2px", display: "flex" }}>
                        <div style={{ flex: "1", minWidth: "0", position: "relative", height: "1em", display: "flex", alignItems: "center" }}>
                            <div style={{ cursor: "pointer", color: selpost?.reposttarget ? colorrepost : undefined, display: "flex", alignItems: "baseline" }} onClick={e => setProfpopping(s => !s)}>
                                {!selev ? "name..." : (() => {
                                    const ael =
                                        author
                                            ? <>
                                                <div style={{ ...shortstyle, maxWidth: "20em" }}>{author.name}</div>
                                                {"/"}
                                                <div style={{ ...shortstyle, maxWidth: "20em" }}>{author.display_name}</div>
                                            </>
                                            : <div style={{ ...shortstyle, maxWidth: "20em" }}>{selev.event?.event?.pubkey}</div>;
                                    return selpost.reposttarget
                                        ? <>
                                            {rpauthor
                                                ? <>
                                                    <div style={{ ...shortstyle, maxWidth: "20em" }}>{rpauthor.name}</div>
                                                    {"/"}
                                                    <div style={{ ...shortstyle, maxWidth: "20em" }}>{rpauthor.display_name}</div>
                                                </>
                                                : <div style={{ ...shortstyle, maxWidth: "20em" }}>{selrpev?.event?.event?.pubkey}</div>}
                                            {" (RP: "}
                                            {ael}
                                            {")"}
                                        </>
                                        : ael;
                                })()}
                            </div>
                            {(!selev || !profpopping) ? null : (() => {
                                const p = !prof.metadata ? null : metadatajsoncontent(prof.metadata);
                                return <div
                                    ref={profpopref}
                                    style={{
                                        display: "grid",
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
                                        <TabText style={shortstyle} onCopy={e => { setProfpopping(false), listref.current?.focus(); }}>{(() => {
                                            const rev = (selrpev || selev).event;
                                            if (!rev) return "";
                                            return nip19.npubEncode(rev.event.pubkey);
                                        })()}</TabText>
                                        <TabText style={shortstyle} onCopy={e => { setProfpopping(false), listref.current?.focus(); }}>{(() => {
                                            const rev = (selrpev || selev).event;
                                            if (!rev) return "";
                                            const pk: Relay | undefined = rev.receivedfrom.values().next().value;
                                            // should we use kind0's receivedfrom or kind10002? but using kind1's receivedfrom that is _real_/_in use_
                                            return nip19.nprofileEncode({ pubkey: rev.event.pubkey, relays: pk ? [pk.url] : undefined });
                                        })()}</TabText>
                                        <TabText style={shortstyle} onCopy={e => { setProfpopping(false), listref.current?.focus(); }}>{(selrpev || selev).event?.event?.pubkey}</TabText>
                                    </div>
                                    <div style={{ textAlign: "right" }}>name:</div>
                                    <div style={shortstyle}>{String(p?.name)}</div>
                                    <div style={{ textAlign: "right" }}>display_name:</div>
                                    <div style={shortstyle}>{String(p?.display_name)}</div>
                                    <div style={{ textAlign: "right" }}>rewritten at:</div>
                                    <div style={shortstyle}>{!prof.metadata ? "?" : timefmt(new Date(prof.metadata.event!.event.created_at * 1000), "YYYY-MM-DD hh:mm:ss")}</div>
                                    <div style={{ textAlign: "right" }}>picture:</div>
                                    <div style={shortstyle}>{String(p?.picture)}</div>
                                    <div style={{ textAlign: "right" }}>banner:</div>
                                    <div style={shortstyle}>{String(p?.banner)}</div>
                                    <div style={{ textAlign: "right" }}>website:</div>
                                    <div style={shortstyle}>{String(p?.website)}</div>
                                    <div style={{ textAlign: "right" }}>nip05:</div>
                                    <div style={shortstyle}>{String(p?.nip05)}</div>
                                    <div style={{ textAlign: "right" }}>lud06/16:</div>
                                    <div style={shortstyle}>{String(p?.lud16 || p?.lud06)}</div>
                                    <div style={{ textAlign: "right" }}>following? ed?</div>
                                    <div style={shortstyle}>{
                                        !account?.pubkey
                                            ? "-"
                                            : noswk.tryGetProfile(account.pubkey, Kind.Contacts)?.event?.event?.event?.tags?.some(t => t[0] === "p" && t[1] === prof.metadata?.event?.event?.pubkey)
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
                                    <div style={shortstyle}>{ }</div> */}
                                    <div style={{ textAlign: "right" }}>about:</div>
                                    <div style={{
                                        overflow: "hidden", /* textOverflow: "ellipsis", does not work for multiline... */
                                        maxHeight: "3.7em",
                                        // nasty prefix hell
                                        maskImage: "linear-gradient(to bottom, #000f 3em, #0000 3.5em)",
                                        WebkitMaskImage: "linear-gradient(to bottom, #000f 3em, #0000 3.5em)",
                                    }}>{String(p?.about)}</div>
                                    {/* <div style={{ textAlign: "right" }}>recent note</div>
                                    <div style={shortstyle}>{ }</div> */}
                                    <div style={{ textAlign: "right" }}>followings, ers:</div>
                                    <div style={shortstyle}>{prof.contacts?.event ? prof.contacts.event.event.tags.filter(t => t[0] === "p").length : "?"} / ENOTIMPL</div>
                                    {/* <div style={{ textAlign: "right" }}>notes, reactions</div>
                                    <div style={shortstyle}>{ }</div> */}
                                    <div style={{ textAlign: "right" }}>json:</div>
                                    <TabText style={{ ...shortstyle, maxWidth: "20em" }} onCopy={e => { setProfpopping(false), listref.current?.focus(); }}>{!prof.metadata ? "?" : JSON.stringify(prof.metadata.event?.event)}</TabText>
                                </div>;
                            })()}
                        </div>
                        <div style={{ position: "relative" }}>
                            <div style={{ cursor: "pointer" }} onClick={e => setEvinfopopping(s => !s)}>
                                {!selev ? "time..." : (() => {
                                    const t = selrpev ? selrpev.event?.event?.created_at : selev.event?.event?.created_at;
                                    if (t === undefined) return "unknown";
                                    const d = new Date(t * 1000);
                                    return timefmt(d, "YYYY-MM-DD hh:mm:ss");
                                })()}
                            </div>
                            {(() => {
                                if (!selpost) return undefined;

                                const rev = selpost.event?.event;
                                if (!rev) return <div></div>;
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
                                            const i = rf.length <= i0 ? rf.length - 1 : i0;  // choose last if event is in future.
                                            const rfirst = rf[i];
                                            return rf.map(r => <div key={r[0].url} style={{ display: "flex", flexDirection: "row" }}>
                                                <div key={`u:${r[0].url}`} style={{ flex: "1", display: "flex", alignItems: "baseline" }}>
                                                    <div style={{ alignSelf: "flex-end", height: "1em" }}>{<img src={identiconStore.png(sha256str(r[0].url))} style={{ height: "100%" }} />}</div>
                                                    <div style={{ ...shortstyle, flex: "1" }}>{r[0].url}</div>
                                                </div>
                                                <div key={`a:${r[0].url}`} style={shortstyle}>{r === rfirst ? timefmt(new Date(r[1]), "YYYY-MM-DD hh:mm:ss.SSS") : reltime(r[1] - rfirst[1])}</div>
                                            </div>);
                                        })()}
                                    </div>
                                    <div style={{ textAlign: "right" }}>note id:</div>
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                        <TabText style={shortstyle} onCopy={e => { setEvinfopopping(false); listref.current?.focus(); }}>{nip19.noteEncode(ev.id)}</TabText>
                                        <TabText style={shortstyle} onCopy={e => { setEvinfopopping(false); listref.current?.focus(); }}>{nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: [froms[0]] })}</TabText>
                                        <TabText style={shortstyle} onCopy={e => { setEvinfopopping(false); listref.current?.focus(); }}>{ev.id}</TabText>
                                    </div>
                                    <div style={{ textAlign: "right" }}>json:</div>
                                    <TabText style={{ overflow: "hidden", whiteSpace: "pre" }} onCopy={e => { setEvinfopopping(false); listref.current?.focus(); }}>{[
                                        selpost.event!.event!.event,
                                        selpost.event?.deleteevent?.event,
                                        selpost.reposttarget?.event?.event,
                                        selpost.reposttarget?.deleteevent?.event,
                                        selpost.myreaction?.event?.event,
                                        selpost.myreaction?.deleteevent?.event,
                                    ].filter(e => e).map(e => `${JSON.stringify(e)}\n`)}</TabText>
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
                                        ...shortstyle,
                                        textDecoration: l.auto ? "underline dotted" : undefined,
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
                                    const ev = (selrpev || selev).event?.event;
                                    if (!ev) return [];
                                    return spans(ev).map((s, i) => {
                                        switch (s.type) {
                                            case "url": {
                                                // TODO: more regular appearance for non-URL.parse-able
                                                return <a key={i} href={s.href} style={{ color: colorlinktext, textDecoration: s.auto ? "underline dotted" : "underline" }} tabIndex={-1}>{s.href}</a>;
                                            }
                                            case "ref": {
                                                if (s.text) {
                                                    return <span key={i} style={{ display: "inline-flex" }}>
                                                        {!s.text.match(/^npub1|^nprofile1/) || !s.hex
                                                            ? null
                                                            : <img src={identiconStore.png(s.hex)} style={{ height: "1em" }} />}
                                                        <span style={{
                                                            ...shortstyle,
                                                            display: "inline-block",
                                                            textDecoration: "underline",
                                                            width: "8em",
                                                            height: "1em",
                                                            verticalAlign: "text-bottom"
                                                        }}>{s.text}</span>
                                                    </span>;
                                                } else {
                                                    return <span key={i} style={{ textDecoration: "underline dotted" }}>{JSON.stringify(s.tag)}</span>; // TODO nice display
                                                }
                                            }
                                            case "hashtag": {
                                                return <span key={i} style={{ textDecoration: s.auto ? "underline dotted" : "underline" }}>#{s.text}</span>;
                                            }
                                            case "nip19": {
                                                return <span key={i} style={{ display: "inline-flex" }}>
                                                    {!s.text.match(/^npub1|^nprofile1/) || !s.hex
                                                        ? null
                                                        : <img src={identiconStore.png(s.hex)} style={{ height: "1em" }} />}
                                                    <span style={{
                                                        ...shortstyle,
                                                        display: "inline-block",
                                                        textDecoration: s.auto ? "underline dotted" : "underline",
                                                        width: "8em",
                                                        height: "1em",
                                                        verticalAlign: "text-bottom",
                                                    }}>{s.text}</span>
                                                </span>;
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
                                        display: "flex",
                                        flexDirection: "row",
                                    }}>
                                        <div style={{ background: colornormal }}>
                                            {/* XXX: this seems produces broken background on Chrome 114 but works...?? */}
                                            <div style={{ padding: "0 0.3em", background: colorbase, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                                                {t[0]}
                                            </div>
                                        </div>
                                        {t.slice(1).map((t, i) =>
                                            <div key={i} style={{ padding: "0 0.3em", borderLeft: "1px solid", borderLeftColor: colornormal }}>{t}</div>
                                        )}
                                    </div>)}
                                    {(() => {
                                        const ev = (selrpev || selev);
                                        if (!ev) return null;
                                        return <div style={{ display: "flex", flexDirection: "row", gap: "2px" }}>
                                            <div style={{ border: "1px solid", borderColor: colornormal, borderRadius: "2px", padding: "0 0.3em" }}>kind {ev.event?.event?.kind}</div>
                                            {/* note: it's really called "difficulty" but PoW is very short. other idea? */}
                                            <div style={{ border: "1px solid", borderColor: colornormal, borderRadius: "2px", padding: "0 0.3em" }}>PoW {nip13.getPow(ev.event?.event?.id || "f".repeat(64))}</div>
                                        </div>;
                                    })()}
                                </div>}
                        </div>
                    </div>
                </div>
                {/* <div style={{ width: "100px", border: "1px solid white" }}>img</div> */}
            </div>
            <div style={{ display: "flex", alignItems: "center", background: coloruibg }}>
                <textarea
                    ref={posteditor}
                    style={{ flex: "1", border: "2px inset", background: colorbase, color: colornormal, font: fonttext }}
                    value={postdraft}
                    placeholder={readonlyuser ? "cannot post: private key nor NIP-07 extension unavailable" : undefined}
                    disabled={readonlyuser}
                    rows={(postdraft.match(/\n/g)?.length || 0) + 1}
                    onChange={e => {
                        if (e.target.value === " ") {
                            listref.current?.focus();
                            nextunread();
                            return;
                        }
                        setPostdraft(e.target.value);
                    }}
                    onKeyDown={e => {
                        if (e.shiftKey || e.altKey) return;
                        if (!e.ctrlKey && !e.metaKey) return;
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        e.stopPropagation();
                        post();
                    }}
                    onFocus={e => {
                        const inpubchat = ([Kind.ChannelCreation, Kind.ChannelMetadata, Kind.ChannelMessage] as number[]).includes(selev?.event?.event?.kind || 0);
                        const pcid: string | null = !inpubchat ? null : (() => {
                            const ev = selev?.event?.event;
                            if (!ev) return null;
                            switch (ev.kind) {
                                case Kind.ChannelCreation: {
                                    return ev.id;
                                }
                                case Kind.ChannelMetadata:
                                case Kind.ChannelMessage: {
                                    return ev.tags.reduce<string | null>((p, c) => !p && c[0] === "e" ? c[1] : p, null);
                                }
                                default: return null;
                            }
                        })();
                        // TODO: DM?
                        setKind(s => s !== null ? s : inpubchat ? 42 : 1);
                        setEdittags(s => s !== null ? s : pcid ? [["e", pcid, ""/* TODO: relay? */, "root"]] : []);
                    }}
                    onBlur={e => setEditingtag(s => Array.isArray(edittags) && edittags.length === 0 ? null : s)}
                />
                <div style={{ minWidth: "3em", textAlign: "center", verticalAlign: "middle", color: coloruitext, font: fontui }}>{postdraft.length}</div>
                <button
                    tabIndex={-1}
                    style={{ padding: "0 0.5em", font: fontui }}
                    onClick={e => {
                        if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
                        if (e.button !== 0) return;
                        post();
                    }}
                >Post</button>
            </div>
            <div style={{ background: coloruibg, color: coloruitext, font: fontui, display: "flex" }}>
                {
                    edittags && !posting
                        ? <div style={{ flex: "1", border: "2px inset", background: colorbase }}>
                            <datalist id="tagkeys">
                                <option value="content-warning" />
                                <option value="g" />
                                <option value="subject" />
                                <option value="d" />
                                <option value="a" />
                                <option value="image" />
                                <option value="published_at" />
                                <option value="summary" />
                                <option value="title" />
                                <option value="delegation" />
                                <option value="i" />
                                <option value="description" />
                                <option value="name" />
                                <option value="thumb" />
                                <option value="e" />
                                <option value="p" />
                                <option value="t" />
                                <option value="r" />
                            </datalist>
                            {(() => <>
                                {edittags.map((e, ti) =>
                                    <div
                                        key={ti}
                                        style={{ margin: "1px", border: "1px solid", borderColor: colornormal, borderRadius: "2px", display: "inline-flex" }}
                                    >
                                        {e.map((e, ei) =>
                                            ti === editingtagdelay?.[0]  // FIXME !!!
                                                ? <input
                                                    key={ei}
                                                    ref={editingtag?.[0] === ti && editingtag?.[1] === ei ? editingtagref : undefined}
                                                    type="text"
                                                    value={e}
                                                    list={ei === 0 ? "tagkeys" : undefined}
                                                    onChange={e => setEdittags(produce(draft => { if (draft) draft[ti][ei] = e.target.value; }))}
                                                    onFocus={e => setEditingtag(s => [ti, ei])}
                                                    onBlur={e => setEditingtag(s => s?.[0] === ti && s?.[1] === ei ? null : s)}
                                                    size={Math.max(1, e.length)}
                                                    style={{
                                                        margin: "2px",
                                                        padding: "0px 2px",
                                                        borderLeft: "1px solid",
                                                        borderLeftColor: colornormal,
                                                        background: colorbase,
                                                        color: colornormal,
                                                        font: fonttext,
                                                    }}
                                                />
                                                : <div
                                                    key={ei}
                                                    style={{ padding: "0 2px", borderLeft: "1px solid", borderLeftColor: colornormal, color: colornormal }}
                                                    tabIndex={0}
                                                    onFocus={e => setEditingtag([ti, ei])}
                                                >{e}</div>
                                        )}
                                        {ti !== editingtagdelay?.[0] ? null : <>  {/* // FIXME !!! */}
                                            <div
                                                tabIndex={0}
                                                style={{ padding: "0 0.5em", background: colornormal, color: colorbase, display: "flex", flexDirection: "row", alignItems: "center" }}
                                                onFocus={e => setEditingtag(s => [ti, -1])}
                                                onBlur={e => setEditingtag(s => s?.[0] === ti ? null : s)}
                                                onKeyDown={ev => {
                                                    if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
                                                    if (ev.key === " " || ev.key === "Enter") {
                                                        ev.preventDefault();
                                                        ev.stopPropagation();
                                                        setEdittags(produce(draft => { if (!draft) return; draft[ti].push(""); }));
                                                        setEditingtag([ti, e.length]);
                                                    }
                                                }}
                                                onPointerDown={ev => {
                                                    if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
                                                    if (ev.button !== 0) return;
                                                    ev.preventDefault();
                                                    ev.stopPropagation();
                                                    setEdittags(produce(draft => { if (!draft) return; draft[ti].push(""); }));
                                                    setEditingtag([ti, e.length]);
                                                }}
                                            >+</div>
                                            <div
                                                tabIndex={0}
                                                style={{ padding: "0 0.5em", background: colornormal, color: colorbase, display: "flex", flexDirection: "row", alignItems: "center" }}
                                                onFocus={e => setEditingtag(s => [ti, -1])}
                                                onBlur={e => setEditingtag(s => s?.[0] === ti ? null : s)}
                                                onKeyDown={ev => {
                                                    if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
                                                    if (ev.key === " " || ev.key === "Enter") {
                                                        ev.preventDefault();
                                                        ev.stopPropagation();
                                                        if (e.length <= 2) {
                                                            setEdittags(produce(draft => { if (!draft) return; draft.splice(ti, 1); }));
                                                            setEditingtag([ti === edittags.length - 1 ? -1 : ti, -1]);
                                                        } else {
                                                            setEdittags(produce(draft => { if (!draft) return; draft[ti].pop(); }));
                                                            // setEditingtag([ti, e.length - 2]);
                                                        }
                                                    }
                                                }}
                                                onPointerDown={ev => {
                                                    if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
                                                    if (ev.button !== 0) return;
                                                    ev.preventDefault();
                                                    ev.stopPropagation();
                                                    if (e.length <= 2) {
                                                        setEdittags(produce(draft => { if (!draft) return; draft.splice(ti, 1); }));
                                                        setEditingtag([ti === edittags.length - 1 ? -1 : ti, -1]);
                                                    } else {
                                                        setEdittags(produce(draft => { if (!draft) return; draft[ti].pop(); }));
                                                        // setEditingtag([ti, e.length - 2]);
                                                    }
                                                }}
                                            >-</div>
                                        </>}
                                    </div>)
                                }
                                <div style={{ margin: "1px", border: "1px solid", borderColor: colornormal, borderRadius: "2px", display: "inline-flex" }}>
                                    <div
                                        ref={editingtagaddref}
                                        tabIndex={0}
                                        style={{ padding: "0 0.5em", background: colornormal, color: colorbase, display: "flex", flexDirection: "row", alignItems: "center" }}
                                        onFocus={e => setEditingtag(s => [-1, 0])}
                                        onBlur={e => setEditingtag(s => s?.[0] === -1 ? null : s)}
                                        onKeyDown={ev => {
                                            if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
                                            if (ev.key === " " || ev.key === "Enter") {
                                                ev.preventDefault();
                                                ev.stopPropagation();
                                                setEdittags([...edittags, ["", ""]]);
                                                setEditingtag([edittags.length, 0]);
                                            }
                                        }}
                                        onPointerDown={ev => {
                                            if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
                                            if (ev.button !== 0) return;
                                            ev.preventDefault();
                                            ev.stopPropagation();
                                            setEdittags([...edittags, ["", ""]]);
                                            setEditingtag([edittags.length, 0]);
                                        }}
                                    >+</div>
                                </div>
                                <div style={{ margin: "1px", border: "1px solid", borderColor: colornormal, borderRadius: "2px", display: "inline-flex" }}>
                                    <div
                                        style={{ padding: "0 2px", background: colornormal, color: colorbase }}
                                    >kind</div>
                                    {editingtagdelay?.[0] === edittags.length + 1  // FIXME !!!
                                        ? <input
                                            ref={editingtag?.[0] === edittags.length + 1 && editingtag?.[1] === 1 ? editingtagref : undefined}
                                            type="text"
                                            value={kind || "0"}
                                            onChange={e => {
                                                const k = Number(e.target.value);
                                                setKind(Number.isNaN(k) ? 1 : k);
                                            }}
                                            onFocus={e => setEditingtag(s => [edittags.length + 1, 1])}
                                            onBlur={e => setEditingtag(s => s?.[0] === edittags.length + 1 && s?.[1] === 1 ? null : s)}
                                            size={Math.max(1, String(kind).length)}
                                            style={{
                                                margin: "2px",
                                                padding: "0px 2px",
                                                borderLeft: "1px solid",
                                                borderLeftColor: colornormal,
                                                background: colorbase,
                                                color: colornormal,
                                                font: fonttext,
                                            }}
                                        />
                                        : <div
                                            style={{ padding: "0 2px", borderLeft: "1px solid", borderLeftColor: colornormal, color: colornormal }}
                                            tabIndex={0}
                                            onFocus={e => setEditingtag([edittags.length + 1, 1])}
                                        >{String(kind)}</div>}
                                </div>
                            </>
                            )()}
                        </div>
                        : <>
                            <div style={{ flex: "1", height: "1em", padding: "2px", display: "flex", alignItems: "center", overflow: "hidden" }}>
                                <div style={{ ...shortstyle, flex: "1" }}>
                                    ∃{tap?.nunreads}/{tap?.posts?.length} ∀{streams?.getNunreads()}/{streams?.getAllPosts()?.size} | 💬{speeds.mypostph}/⭐{speeds.reactph}/🌊{speeds.allnoteph}/h | {status}
                                </div>
                            </div>
                            <div style={{ position: "relative" }}>
                                <div style={{ padding: "2px 0.5em", cursor: "pointer" }} onClick={e => setPostpopping(s => !s)}>{
                                    recentpubs.length === 0
                                        ? "-"
                                        : (() => {
                                            const all = [...recentpubs[0].postByRelay.values()];
                                            const done = all.filter((r): r is NonNullable<typeof r> => !!r);
                                            const oks = done.filter(r => r.ok);
                                            const fails = done.filter(r => !r.ok);
                                            return `${oks.length}${0 < fails.length ? `+!${fails.length}=${done.length}` : ""}/${all.length}`;
                                        })()
                                }</div>
                                {!postpopping ? null : <div
                                    ref={postpopref}
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "0.5em",
                                        position: "absolute",
                                        right: "0",
                                        bottom: "100%",
                                        padding: "5px",
                                        maxWidth: "20em",
                                        border: "2px outset",
                                        background: coloruibg,
                                        color: coloruitext,
                                        font: fontui,
                                    }}>{
                                        recentpubs.length === 0
                                            ? <div style={shortstyle}>(no recent posts)</div>
                                            : [...recentpubs].reverse().map(rp => {
                                                const all = [...rp.postByRelay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
                                                const done = all.filter((r): r is [typeof all[number][0], NonNullable<typeof all[number][1]>] => !!r[1]);
                                                const oks = done.filter(([u, r]) => r.ok);
                                                const fails = done.filter(([u, r]) => !r.ok);
                                                const now = Date.now();
                                                return <div key={`${rp.event.id}-${rp.postAt}`} style={{ display: "flex", flexDirection: "column" }}>
                                                    <div style={{ display: "flex", flexDirection: "row", /* overflow: "hidden" */ }}>
                                                        <div style={{ ...shortstyle, flex: "1" }}>{rp.desc}</div>
                                                        <div>{reltime(rp.postAt - now)}</div>
                                                    </div>
                                                    <div style={{ marginLeft: "1em", display: "flex", flexDirection: "column" }}>
                                                        <TabText style={shortstyle}>{nip19.noteEncode(rp.event.id)}</TabText>
                                                        <TabText style={shortstyle}>{JSON.stringify(rp.event)}</TabText>
                                                        <div style={{ display: "flex", flexDirection: "row" }}>
                                                            <details tabIndex={0} style={{ flex: 1 }}>
                                                                <summary style={{ display: "flex", flexDirection: "row" }}>
                                                                    <div style={{ flex: 1, display: "flex", flexDirection: "row", flexWrap: "wrap" }}>
                                                                        {all.map(([u, r]) => <div key={u} style={{ position: "relative" }}>
                                                                            <img
                                                                                style={{ height: "1em" }}
                                                                                src={identiconStore.png(sha256str(u))}
                                                                                title={`${u}${!r ? " (waiting)" : ((r.reason ? `: ${r.reason}` : "") + " " + reltime(r.recvAt - now))}`} />
                                                                            <div style={{
                                                                                width: "0.4em",
                                                                                height: "0.4em",
                                                                                position: "absolute",
                                                                                top: "0",
                                                                                right: "0",
                                                                                borderRadius: "100%",
                                                                                border: !r ? "1px solid black" : undefined,
                                                                                boxSizing: "border-box",
                                                                                background: !r ? coloruibg : !r.ok ? "red" : "green",
                                                                            }} />
                                                                        </div>)}
                                                                    </div>
                                                                    <div>{oks.length}{0 < fails.length ? `+!${fails.length}=${done.length}` : ""}/{all.length}</div>
                                                                </summary>
                                                                <div style={{ display: "flex", flexDirection: "column" }}>
                                                                    {all.map(([u, r]) => <div key={u} style={{ display: "flex", flexDirection: "column" }}>
                                                                        <div style={{ display: "flex", flexDirection: "row" }}>
                                                                            <div style={{ position: "relative" }}>
                                                                                <img
                                                                                    style={{ height: "1em" }}
                                                                                    src={identiconStore.png(sha256str(u))}
                                                                                    title={`${u}${!r ? " (waiting)" : ((r.reason ? `: ${r.reason}` : "") + " " + reltime(r.recvAt - now))}`} />
                                                                                <div style={{
                                                                                    width: "0.4em",
                                                                                    height: "0.4em",
                                                                                    position: "absolute",
                                                                                    top: "0",
                                                                                    right: "0",
                                                                                    borderRadius: "100%",
                                                                                    border: !r ? "1px solid black" : undefined,
                                                                                    boxSizing: "border-box",
                                                                                    background: !r ? coloruibg : !r.ok ? "red" : "green",
                                                                                }} />
                                                                            </div>
                                                                            <div style={{ ...shortstyle, flex: 1 }}>{u}</div>
                                                                            <div>{!r ? "..." : reltime(r.recvAt - now)}</div>
                                                                        </div>
                                                                        {!r?.reason ? null : <div style={{ ...shortstyle, paddingLeft: "1.5em" }}>{r.reason}</div>}
                                                                    </div>)}
                                                                </div>
                                                            </details>
                                                        </div>
                                                    </div>
                                                </div>;
                                            })
                                    }</div>}
                            </div>
                            <div style={{ padding: "2px 0.5em" }}>{fetchqlen}</div>
                        </>
                }
                <div style={{ padding: "2px 0.5em", position: "relative", display: "flex", flexDirection: "row", alignItems: "center" }}>
                    <div style={{ cursor: "pointer" }} onClick={e => setRelaypopping(s => !s)}>{relayinfo.healthy}/{relayinfo.all}</div>
                    {!relaypopping ? null : <div
                        ref={relaypopref}
                        style={{
                            display: "grid",
                            position: "absolute",
                            right: "0",
                            bottom: "100%",
                            padding: "5px",
                            maxHeight: "30em",
                            overflowY: "auto",
                            border: "2px outset",
                            background: coloruibg,
                            color: coloruitext,
                            font: fontui,
                            gridTemplateColumns: "3em 15em 3em",  // FIXME: want to auto-resizing...
                            alignItems: "baseline",
                            columnGap: "0.5em",
                        }}
                    >{(() => {
                        const now = Date.now();
                        return [...relayinfo.relays]
                            .sort((a, b) => a.relay.url.localeCompare(b.relay.url))
                            .map(r => <Fragment key={r.relay.url}>
                                <div>{0 < r.nfail ? "⚠" : "♻"}{r.ndied}</div>
                                <div style={{ maxWidth: "15em", display: "flex", alignItems: "baseline" }}>
                                    <div style={{ alignSelf: "flex-end", height: "1em" }}>{<img src={identiconStore.png(sha256str(r.relay.url))} style={{ height: "100%" }} />}</div>
                                    <div style={{ ...shortstyle, flex: "1" }}>{r.relay.url}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>{r.disconnectedat ? reltime(r.disconnectedat - now) : r.connectedat ? reltime(now - r.connectedat) : "-"}</div>
                                {(noswk.recentNotices.get(r.relay) || []).map((n, i) =>
                                    <div key={`n:${i}:${r.relay.url}`} style={{ gridColumn: "span 3", paddingLeft: "1em", display: "flex", flexDirection: "row" }}>
                                        <div style={{ ...shortstyle, flex: "1" }}>{n.msg}</div>
                                        <div>{reltime(n.receivedAt - now)}</div>
                                    </div>
                                )}
                            </Fragment>);
                    })()}</div>}
                </div>
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
