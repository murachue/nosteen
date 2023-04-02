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
            <div style={{ display: "flex", flexDirection: "row" }}>
                <div>
                    <div style={{ width: "60px", height: "60px", border: "1px solid white" }} />
                </div>
                <div style={{ flex: "1", display: "flex", flexDirection: "column" }}>
                    <div>name here</div>
                    <div style={{ flex: "1", overflowY: "auto" }}>text here...<br />here...</div>
                </div>
                <div style={{ width: "100px", border: "1px solid white" }}>img</div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
                <input type="text" style={{ flex: "1", background: colorbase, borderColor: colornormal, color: colornormal, font: fonttext }} value={postdraft} onChange={e => setPostdraft(e.target.value)} />
                <div style={{ minWidth: "3em", textAlign: "center", verticalAlign: "middle", font: fonttext }}>{postdraft.length}</div>
                <button tabIndex={-1} style={{ padding: "0 0.5em", font: fonttext }}>Post</button>
            </div>
            <div style={{ background: coloruibg, color: coloruitext, font: fonttext }}>
                status here
            </div>
        </div>
    </>;
};
