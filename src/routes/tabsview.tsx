import Identicon from "identicon.js";
import produce from "immer";
import { useAtom } from "jotai";
import { FC, Ref, forwardRef, memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useParams } from "react-router-dom";
import ListView, { TBody, TD, TH, TR } from "../components/listview";
import Tab from "../components/tab";
import TabBar from "../components/tabbar";
import { useNostrWorker } from "../nostrworker";
import state from "../state";
import { Post } from "../types";
import VList from "react-virtualized-listview";

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
                                ref={i === lasti ? lastref : p === selection ? selref : undefined} // TODO: what if selected is last?
                                onPointerDown={e => onSelect && onSelect(i)}>
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

export default () => {
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
    const [posts, setPosts] = useAtom(state.posts);
    const [relayinfo] = useAtom(state.relayinfo);
    const listref = useRef<HTMLDivElement>(null);
    const selref = useRef<HTMLDivElement>(null);
    const lastref = useRef<HTMLDivElement>(null);
    const [scrollto, setScrollto] = useState({ ref: "", t: 0 }); // just another object instance is enough, but easier for eyeball debugging.

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
        (onStoreChange) => {
            const onChange = (nm: string) => { nm === name && onStoreChange(); };
            noswk!.addListener(name, onChange);
            return () => noswk!.removeListener(name, onChange);
        },
        () => {
            return noswk!.getPostStream(name)!;
        },
    );
    useEffect(() => {
        const onChange = (nm: string) => {
            if (nm !== name) return;
            const list = listref.current;
            if (!list) return;
            const last = lastref.current;
            if (!last) return;
            const scrollBottom = list.scrollTop + list.clientHeight;
            if (last.offsetTop < scrollBottom) {
                setScrollto({ ref: "last", t: Date.now() });
            }
        };
        noswk!.addListener(name, onChange);
        return () => noswk!.removeListener(name, onChange);
    }, [name, listref, noswk]);
    const selpost = tab.selected === null ? undefined : tap[tab.selected];
    const selev = selpost?.event;
    const selrpev = selev && selpost.reposttarget;
    const onselect = useCallback((i: number) => {
        const s = tap[i].id;
        noswk!.setHasread(s, true);
        setTabs(produce(draft => {
            const tab = draft.find(t => t.name === name)!;
            tab.selected = i;
        }));
        setScrollto({ ref: "sel", t: Date.now() });
    }, [tap, noswk]);
    useEffect(() => {
        switch (scrollto.ref) {
            case "ref": {
                selref.current?.scrollIntoView();
                break;
            }
            case "last": {
                lastref.current?.scrollIntoView();
                break;
            }
        }
    }, [scrollto]);
    return <>
        <Helmet>
            <title>{name} - nosteen</title>
        </Helmet>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }} onKeyDown={e => {
            const tagName = (((e.target as any).tagName as string) || "").toLowerCase(); // FIXME
            if (tagName === "input" || tagName === "textarea" || tagName === "button") {
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
                    const i = tab.selected === null ? tap.length - 1 : tab.selected + 1;
                    if (i < tap.length) {
                        onselect(i);
                    }
                    break;
                }
                case "k": {
                    const i = tab.selected === null ? tap.length - 1 : tab.selected - 1;
                    if (0 <= i) {
                        onselect(i);
                    }
                    break;
                }
                case "h": {
                    break;
                }
                case "l": {
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
                    const i = 0;
                    if (i < tap.length) {
                        onselect(i);
                    }
                    break;
                }
                case "G": {
                    const i = tap.length - 1;
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
                    const tapl = tap.length;
                    let i: number;
                    for (i = 0; i < tapl; i++) {
                        if (!tap[i].hasread) {
                            break;
                        }
                    }
                    if (i < tapl) {
                        onselect(i);
                    }
                    break;
                }
            }
        }}>
            <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column" }}>
                {<TheList posts={tap || []} mypubkey={account?.pubkey} selection={selpost || null} ref={listref} selref={selref} lastref={lastref} onSelect={onselect} />}
                <div>
                    <TabBar>
                        {tabs.map(t => <Tab key={t.name} active={t.name === name} onClick={() => navigate(`/tab/${t.name}`)}>{t.name}</Tab>)}
                    </TabBar>
                </div>
            </div>
            <div style={{ display: "flex", flexDirection: "row", background: coloruibg }}>
                <div>
                    <div style={{ width: "48px", height: "48px", border: "1px solid", borderColor: coloruitext, margin: "2px" }}>
                        {/* npubhex identicon makes icon samely for vanity... */}
                        {!selev ? <></> : <img style={{ maxWidth: "100%" }} src={`data:image/png;base64,${new Identicon(selrpev?.event?.event?.pubkey || selev.event!.event.pubkey, { background: [0, 0, 0, 0] }).toString()}`} />}
                    </div>
                </div>
                <div style={{ flex: "1", /* display: "flex", flexDirection: "column" */ }}>
                    <div style={{ color: coloruitext, font: fontui, /* fontWeight: "bold", */ margin: "0 2px", display: "flex" }}>
                        <div style={{ flex: "1", color: selpost?.reposttarget ? colorrepost : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {!selev ? "name..." : (
                                selpost.reposttarget
                                    ? `${selpost.reposttarget.event!.event.pubkey} (RT: ${selev.event!.event.pubkey})`
                                    : selev.event!.event.pubkey
                            )}
                        </div>
                        <div>{!selev ? "time..." : (() => {
                            const t = selrpev ? selrpev.event!.event.created_at : selev.event!.event.created_at;
                            const d = new Date(t * 1000);
                            return timefmt(d, "YYYY-MM-DD hh:mm:ss");
                        })()}</div>
                    </div>
                    <div style={{ height: "5.5em", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "2px", background: colorbase, font: fonttext }}>
                        {!selev ? "text..." : (selrpev?.event?.event.content || selev?.event?.event.content)}
                    </div>
                </div>
                {/* <div style={{ width: "100px", border: "1px solid white" }}>img</div> */}
            </div>
            <div style={{ display: "flex", alignItems: "center", background: coloruibg }}>
                <input ref={posteditor} type="text" style={{ flex: "1", background: colorbase, color: colornormal, font: fonttext }} value={postdraft} onChange={e => setPostdraft(e.target.value)} />
                <div style={{ minWidth: "3em", textAlign: "center", verticalAlign: "middle", color: coloruitext, font: fontui }}>{postdraft.length}</div>
                <button tabIndex={-1} style={{ padding: "0 0.5em", font: fontui }}>Post</button>
            </div>
            <div style={{ background: coloruibg, color: coloruitext, font: fontui, padding: "2px", display: "flex" }}>
                <div style={{ flex: "1" }}>{status}</div>
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
