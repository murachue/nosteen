import { useAtom } from "jotai";
import { useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useParams } from "react-router-dom";
import ListView from "../components/listview";
import Tab from "../components/tab";
import TabBar from "../components/tabbar";
import state from "../state";

export default () => {
    const navigate = useNavigate();
    const data = useParams();
    const name = data.name || "";
    const [tabs] = useAtom(state.tabs);
    const [colorbase] = useAtom(state.preferences.colors.base);
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [fontui] = useAtom(state.preferences.fonts.ui);

    if (!tabs.find(t => t.name === name)) {
        navigate(`/tab/${tabs[0].name}`, { replace: true });
    }

    const [postdraft, setPostdraft] = useState("");

    return <>
        <Helmet>
            <title>{name} - nosteen</title>
        </Helmet>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column" }}>
                <div style={{ flex: "1 0 0px", height: "0" }}><ListView /></div>
                <div><TabBar>
                    {tabs.map((t, i) => <Tab active={t.name === name} onClick={() => navigate(`/tab/${t.name}`)}>{t.name}</Tab>)}
                </TabBar></div>
            </div>
            <div style={{ display: "flex", flexDirection: "row", background: coloruibg, height: "100px" }}>
                <div>
                    <div style={{ width: "60px", height: "60px", border: "1px solid white" }} />
                </div>
                <div style={{ flex: "1", display: "flex", flexDirection: "column" }}>
                    <div style={{ color: coloruitext, font: fontui }}>name here</div>
                    <div style={{ flex: "1", overflowY: "auto", background: colorbase, color: colornormal, font: fonttext }}>
                        text here...<br />here...
                    </div>
                </div>
                <div style={{ width: "100px", border: "1px solid white" }}>img</div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
                <input type="text" style={{ flex: "1", background: colorbase, borderColor: colornormal, color: colornormal, font: fonttext }} value={postdraft} onChange={e => setPostdraft(e.target.value)} />
                <div style={{ minWidth: "3em", textAlign: "center", verticalAlign: "middle", font: fontui }}>{postdraft.length}</div>
                <button tabIndex={-1} style={{ padding: "0 0.5em", font: fontui }}>Post</button>
            </div>
            <div style={{ background: coloruibg, color: coloruitext, font: fontui, display: "flex" }}>
                <div style={{ flex: "1" }}>status here</div>
                <div style={{ padding: "0 0.5em" }}>0</div>
            </div>
        </div>
    </>;
};
