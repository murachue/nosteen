import { useState } from "react";
import { Link, useLoaderData } from "react-router-dom";
import ListView from "../components/listview";
import TabBar from "../components/tabbar";

const Index = () => {
    const data = useLoaderData();
    const name =
        typeof data === "object" &&
            data !== null &&
            "name" in data &&
            typeof data.name === "string"
            ? data.name
            : "(null)";
    const [c, sc] = useState(0);
    return <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: "1 0 0px", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: "1 0 0px", height: "0" }}><ListView /></div>
            <div><TabBar /></div>
        </div>
        <div>
            <p>tabname is {name}</p>
            <button onClick={() => sc(c => c + 1)}>{c}</button>
            <p>Here is a link to <Link to="test">test...</Link></p>
        </div>
    </div>;
};

export default Index;
