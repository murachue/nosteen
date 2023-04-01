import { Helmet } from "react-helmet";
import { useAtom } from "jotai";
import { Outlet } from "react-router";
import state from "../state";

const Global = () => {
    const [colorBase] = useAtom(state.preferences.colors.base);
    return <div style={{ position: "fixed", top: "0", bottom: "0", left: "0", right: "0", backgroundColor: colorBase, color: "#ccc" }}>
        <Helmet>
            <title>nosteen</title>
        </Helmet>
        <Outlet />
    </div>;
};

export default Global;
