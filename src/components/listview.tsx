import { FC } from "react";

const ListView: FC<{ widths?: number[]; }> = (props) => {
    return <table style={{ background: "#444", width: "800px", height: "600px" }}>
        <thead style={{ background: "#644", width: "100%", height: "auto" }}>
            <tr>
                <td>hello</td>
                <td>world</td>
            </tr>
        </thead>
        <div style={{ height: "auto" }}>
            aaa
        </div>
        <tbody style={{ background: "#664", width: "100%", height: "auto" }}>
            <tr style={{ background: "#464", width: "100%", height: "auto" }}>
                <td>hello</td>
                <td>world</td>
            </tr>
            <tr style={{ background: "#449", width: "100%", height: "auto" }}>
                <td>hello</td>
                <td>world</td>
            </tr>
        </tbody>
    </table>;
};

export default ListView;
