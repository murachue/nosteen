import { FC } from "react";

const ListView: FC<{ widths?: number[]; }> = (props) => {
    return <div tabIndex={1} style={{ background: "#444", width: "100%", height: "100%", overflowX: "auto", overflowY: "scroll", position: "relative" }}>
        <div style={{ display: "flex", position: "sticky", background: "#644", width: "100%", top: 0 }}>
            <div style={{ width: "5em" }}>hello</div>
            <div style={{ width: "5em" }}>world</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", background: "#664", width: "100%" }}>
            {[...Array(17).fill(0).map(() => <>
                <div style={{ display: "flex", background: "#464", width: "100%" }}>
                    <div style={{ width: "5em" }}>hello</div>
                    <div style={{ width: "5em" }}>world</div>
                </div>
                <div style={{ display: "flex", background: "#449", width: "100%" }}>
                    <div style={{ width: "5em" }}>hello</div>
                    <div style={{ width: "5em" }}>world</div>
                </div>
            </>)]
            }
        </div>
    </div>;
};

export default ListView;
