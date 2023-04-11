import Identicon from "identicon.js";
import { useAtom } from "jotai";
import { FC, memo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useParams } from "react-router-dom";
import ListView, { TBody, TD, TH, TR } from "../components/listview";
import Tab from "../components/tab";
import TabBar from "../components/tabbar";
import state from "../state";
import { Post } from "../types";
import produce from "immer";
import { bsearchi, postindex } from "../util";

const TheRow: FC<{ post: Post; selected: Post | null; }> = memo(({ post, selected }) => {
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [colorrepost] = useAtom(state.preferences.colors.repost);
    const [colorselbg] = useAtom(state.preferences.colors.selectedbg);
    const [colorseltext] = useAtom(state.preferences.colors.selectedtext);
    const [fonttext] = useAtom(state.preferences.fonts.text);

    const ev = post.event!.event!.event;

    const [bg, text] = (() => {
        if (post === selected) {
            return [colorselbg, colorseltext];
        }
        if (post.event!.event!.event.pubkey === selected?.event!.event!.event.pubkey) {

        }
        if (post.event!.event!.event.kind === 6) {
            return [undefined, colorrepost];
        }
        return [undefined, colornormal];
    })();

    return <div style={{ display: "flex", width: "100%", alignItems: "center", background: bg, color: text, font: fonttext }}>
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
                    {<img style={{ maxWidth: "16px" }} src={`data:image/png;base64,${new Identicon(ev.pubkey, { background: [0, 0, 0, 0] }).toString()}`} />}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.pubkey}
                </div>
            </TD>
            <TD>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {/* ev.id */}{ev.content}
                </div>
            </TD>
        </TR>
    </div>;
});

const TheList: FC<{ posts: Post[]; selection: Post | null; onSelect?: (i: string) => void; }> = ({ posts, selection, onSelect }) => {
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fontui] = useAtom(state.preferences.fonts.ui);

    return <div style={{ flex: "1 0 0px", height: "0" }}>
        <ListView>
            <div tabIndex={0} style={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "scroll", position: "relative" }}>
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
                        {posts.map(p => {
                            const evid = p.event!.event!.event.id;
                            return <div key={evid} onPointerDown={e => onSelect && onSelect(evid)}>
                                <TheRow post={p} selected={selection} />
                            </div>;
                        })}
                    </TBody>
                </div>
            </div>
        </ListView>
    </div>;
};

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
    const [tabs, setTabs] = useAtom(state.tabs);
    const [colorbase] = useAtom(state.preferences.colors.base);
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [fontui] = useAtom(state.preferences.fonts.ui);
    const [posts, setPosts] = useAtom(state.posts);
    const [relayinfo] = useAtom(state.relayinfo);

    const [status, setStatus] = useState("status...");

    const tab = tabs.find(t => t.name === name);
    if (!tab) {
        navigate(`/tab/${tabs[0].name}`, { replace: true });
        return <></>;
    }

    const [postdraft, setPostdraft] = useState("");
    const posteditor = useRef<HTMLInputElement>(null);

    const tap = posts.bytab.get(name)!;
    const selpost = tab.selected === "" ? undefined : posts.allposts.get(tab.selected);
    const selev = selpost?.event;
    const selrpev = selev && selpost.reposttarget;
    return <>
        <Helmet>
            <title>{name} - nosteen</title>
        </Helmet>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }} onKeyDown={e => {
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
                    const si = selpost && (postindex(tap, selpost.event!.event!.event) ?? undefined);
                    const i = si === undefined ? tap.length - 1 : si + 1;
                    if (i < tap.length) {
                        // TODO: commonize with onClick, scroll to new Row?
                        const ev = tap[i].event!.event!.event;
                        const evid = ev.id;
                        setTabs(produce(draft => {
                            draft.find(t => t.name === name)!.selected = evid;
                        }));
                        setPosts(produce(draft => {
                            const p = draft.allposts.get(evid)!;
                            p.hasread = true;
                            for (const tap of draft.bytab.values()) {
                                const i = postindex(tap, ev);
                                if (i !== null) {
                                    tap[i] = p;
                                }
                            }
                        }));
                    }
                    break;
                }
                case "k": {
                    const si = selpost && (postindex(tap, selpost.event!.event!.event) ?? undefined);
                    const i = si === undefined ? tap.length - 1 : si - 1;
                    if (0 <= i) {
                        // TODO: commonize with onClick, scroll to new Row?
                        const ev = tap[i].event!.event!.event;
                        const evid = ev.id;
                        setTabs(produce(draft => {
                            draft.find(t => t.name === name)!.selected = evid;
                        }));
                        setPosts(produce(draft => {
                            const p = draft.allposts.get(evid)!;
                            p.hasread = true;
                            for (const tap of draft.bytab.values()) {
                                const i = postindex(tap, ev);
                                if (i !== null) {
                                    tap[i] = p;
                                }
                            }
                        }));
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
                    if (0 < tap.length) {
                        // TODO: commonize with onClick, scroll to new Row?
                        const ev = tap[i].event!.event!.event;
                        const evid = ev.id;
                        setTabs(produce(draft => {
                            draft.find(t => t.name === name)!.selected = evid;
                        }));
                        setPosts(produce(draft => {
                            const p = draft.allposts.get(evid)!;
                            p.hasread = true;
                            for (const tap of draft.bytab.values()) {
                                const i = postindex(tap, ev);
                                if (i !== null) {
                                    tap[i] = p;
                                }
                            }
                        }));
                    }
                    break;
                }
                case "G": {
                    const i = tap.length - 1;
                    if (0 < i) {
                        // TODO: commonize with onClick, scroll to new Row?
                        const ev = tap[i].event!.event!.event;
                        const evid = ev.id;
                        setTabs(produce(draft => {
                            draft.find(t => t.name === name)!.selected = evid;
                        }));
                        setPosts(produce(draft => {
                            const p = draft.allposts.get(evid)!;
                            p.hasread = true;
                            for (const tap of draft.bytab.values()) {
                                const i = postindex(tap, ev);
                                if (i !== null) {
                                    tap[i] = p;
                                }
                            }
                        }));
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
                        // TODO: commonize with onClick, scroll to new Row?
                        const ev = tap[i].event!.event!.event;
                        const evid = ev.id;
                        setTabs(produce(draft => {
                            draft.find(t => t.name === name)!.selected = evid;
                        }));
                        setPosts(produce(draft => {
                            const p = draft.allposts.get(evid)!;
                            p.hasread = true;
                            for (const tap of draft.bytab.values()) {
                                const i = postindex(tap, ev);
                                if (i !== null) {
                                    tap[i] = p;
                                }
                            }
                        }));
                    }
                    break;
                }
            }
        }}>
            <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column" }}>
                {!tap ? <p>?invariant failure: posts for tab not found</p> : <TheList posts={tap} selection={selpost || null} onSelect={s => {
                    setTabs(produce(draft => {
                        const tab = draft.find(t => t.name === name)!;
                        tab.selected = s;
                    }));
                    setPosts(produce(draft => {
                        const post = draft.allposts.get(s)!;
                        post.hasread = true;
                        const tap = draft.bytab.get(name)!;
                        const i = postindex(tap, post.event!.event!.event);
                        if (i !== null) {
                            tap[i] = post;
                        }
                    }));
                }} />}
                <div>
                    <TabBar>
                        {tabs.map(t => <Tab key={t.name} active={t.name === name} onClick={() => navigate(`/tab/${t.name}`)}>{t.name}</Tab>)}
                    </TabBar>
                </div>
            </div>
            <div style={{ display: "flex", flexDirection: "row", background: coloruibg, height: "100px" }}>
                <div>
                    <div style={{ width: "48px", height: "48px", border: "1px solid", borderColor: coloruitext, margin: "2px" }}>
                        {/* npubhex identicon makes icon samely for vanity... */}
                        {!selev ? <></> : <img style={{ maxWidth: "100%" }} src={`data:image/png;base64,${new Identicon(selrpev?.event?.event?.pubkey || selev.event!.event.pubkey, { background: [0, 0, 0, 0] }).toString()}`} />}
                    </div>
                </div>
                <div style={{ flex: "1", display: "flex", flexDirection: "column" }}>
                    <div style={{ color: coloruitext, font: fontui, /* fontWeight: "bold", */ margin: "0 2px", display: "flex" }}>
                        <div style={{ flex: "1" }}>{!selev ? "name..." : (selrpev?.event?.event?.pubkey || selev.event!.event.pubkey)}</div>
                        <div>{!selev ? "time..." : (() => {
                            const t = selrpev ? selrpev.event!.event.created_at : selev.event!.event.created_at;
                            const d = new Date(t * 1000);
                            return timefmt(d, "YYYY-MM-DD hh:mm:ss");
                        })()}</div>
                    </div>
                    <div style={{ flex: "1", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "2px", background: colorbase, font: fonttext }}>
                        {!selev ? "text..." : (selrpev?.event?.event.content || selev?.event?.event.content)}
                    </div>
                </div>
                {/* <div style={{ width: "100px", border: "1px solid white" }}>img</div> */}
            </div>
            <div style={{ display: "flex", alignItems: "center", background: coloruibg }}>
                <input ref={posteditor} type="text" style={{ flex: "1", background: colorbase, color: colornormal, font: fonttext }} value={postdraft} onChange={e => setPostdraft(e.target.value)} onKeyDown={e => { e.stopPropagation(); return false; }} />
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
                            <input type="text" value="" placeholder="hashtag" style={{ flex: "1", boxSizing: "border-box", font: fontui }} onKeyDown={e => e.stopPropagation()} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </>;
};
