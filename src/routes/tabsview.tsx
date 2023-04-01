import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ListView from "../components/listview";
import Tab from "../components/tab";
import TabBar from "../components/tabbar";
import { useAtom } from "jotai";
import state from "../state";

export default () => {
    const navigate = useNavigate();
    const data = useParams();
    const name = data.name || "";
    const [tabs] = useAtom(state.tabs);

    if (!tabs.find(t => t.name === name)) {
        navigate(`/${tabs[0].name}`, { replace: true });
    }

    const [c, sc] = useState(0);

    return <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: "1 0 0px", height: "0" }}><ListView /></div>
            <div><TabBar>
                {tabs.map((t, i) => <Tab active={t.name === name} onClick={() => navigate(`/${t.name}`)}>{t.name}</Tab>)}
            </TabBar></div>
        </div>
        <div>
            <p>tabname is {name}</p>
            <button onClick={() => sc(c => c + 1)}>{c}</button>
            <p>Here is a link to <Link to="test">test...</Link></p>
        </div>
    </div>;
};
