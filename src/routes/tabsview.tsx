import Identicon from "identicon.js";
import { useAtom } from "jotai";
import { FC, useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useParams } from "react-router-dom";
import ListView, { TBody, TD, TH, TR } from "../components/listview";
import Tab from "../components/tab";
import TabBar from "../components/tabbar";
import state from "../state";
import { Post } from "../types";

const TheList: FC<{ posts: Post[]; }> = ({ posts }) => {
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [fontui] = useAtom(state.preferences.fonts.ui);

    return <div style={{ flex: "1 0 0px", height: "0" }}>
        <ListView>
            <div tabIndex={0} style={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "scroll", position: "relative" }}>
                <div style={{ display: "flex", position: "sticky", width: "100%", top: 0, background: coloruibg }}>
                    <TH>
                        <TD width="1.2em"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>unr</div></TD>
                        <TD width="20px"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>icon</div></TD>
                        <TD width="8em"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>username</div></TD>
                        <TD width="35em"><div style={{ overflow: "hidden", padding: "2px", borderRight: "1px solid transparent", borderRightColor: coloruitext, boxSizing: "border-box", color: coloruitext, font: fontui }}>text</div></TD>
                    </TH>
                </div>
                <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                    <TBody>
                        {posts.map(p => {
                            const ev = p.event!.event!.event;
                            return <div key={ev.id} style={{ display: "flex", width: "100%", alignItems: "center" }}>
                                <TR>
                                    <TD>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: colornormal, font: fonttext, textAlign: "right" }}>
                                            ★
                                        </div>
                                    </TD>
                                    <TD>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: colornormal, font: fonttext }}>
                                            {<img style={{ maxWidth: "16px" }} src={`data:image/png;base64,${new Identicon(ev.pubkey, { background: [0, 0, 0, 0] }).toString()}`} />}
                                        </div>
                                    </TD>
                                    <TD>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: colornormal, font: fonttext }}>
                                            {ev.pubkey}
                                        </div>
                                    </TD>
                                    <TD>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: colornormal, font: fonttext }}>
                                            {/* ev.id */}{ev.content}
                                        </div>
                                    </TD>
                                </TR>
                            </div>;
                        })}
                    </TBody>
                </div>
            </div>
        </ListView>
    </div>;
};

export default () => {
    const navigate = useNavigate();
    const data = useParams();
    const name = data.name || "";
    const [tabs] = useAtom(state.tabs);
    const [activetab, setActivetab] = useAtom(state.activetab);
    const [colorbase] = useAtom(state.preferences.colors.base);
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [fontui] = useAtom(state.preferences.fonts.ui);
    const [posts] = useAtom(state.posts);
    const [relayinfo] = useAtom(state.relayinfo);

    if (!tabs.find(t => t.name === name)) {
        navigate(`/tab/${tabs[0].name}`, { replace: true });
    }

    const [postdraft, setPostdraft] = useState("");

    const tap = posts.bytab.get(name);
    return <>
        <Helmet>
            <title>{name} - nosteen</title>
        </Helmet>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column" }}>
                {!tap ? <p>?invariant failure: posts for tab not found</p> : <TheList posts={tap} />}
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
                        <img style={{ maxWidth: "100%" }} src={`data:image/png;base64,${new Identicon("effeab1e1234567", { background: [0, 0, 0, 0] }).toString()}`} />
                    </div>
                </div>
                <div style={{ flex: "1", display: "flex", flexDirection: "column" }}>
                    <div style={{ color: coloruitext, font: fontui, /* fontWeight: "bold", */ margin: "0 2px" }}>name here</div>
                    <div style={{ flex: "1", overflowY: "auto", margin: "2px", background: colorbase, color: colornormal, font: fonttext }}>
                        text here...<br />here...
                    </div>
                </div>
                {/* <div style={{ width: "100px", border: "1px solid white" }}>img</div> */}
            </div>
            <div style={{ display: "flex", alignItems: "center", background: coloruibg }}>
                <input type="text" style={{ flex: "1", background: colorbase, borderColor: colornormal, color: colornormal, font: fonttext }} value={postdraft} onChange={e => setPostdraft(e.target.value)} />
                <div style={{ minWidth: "3em", textAlign: "center", verticalAlign: "middle", color: coloruitext, font: fontui }}>{postdraft.length}</div>
                <button tabIndex={-1} style={{ padding: "0 0.5em", font: fontui }}>Post</button>
            </div>
            <div style={{ background: coloruibg, color: coloruitext, font: fontui, padding: "2px", display: "flex" }}>
                <div style={{ flex: "1" }}>status here</div>
                <div style={{ padding: "0 0.5em" }}>{relayinfo.healthy}/{relayinfo.all}</div>
            </div>
        </div>
    </>;
};
