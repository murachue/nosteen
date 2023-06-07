import { useAtom } from "jotai";
import { FC } from "react";
import { Helmet } from "react-helmet";
import { Outlet } from "react-router";
import state from "../state";

const Global: FC = () => {
    const [colorBase] = useAtom(state.preferences.colors.base);
    return <div
        style={{
            position: "fixed",
            top: "0",
            bottom: "0",
            left: "0",
            right: "0",
            background: colorBase,
            color: "#ccc",
            overflow: "auto",
        }}
    >
        <Helmet>
            <title>nosteen</title>
        </Helmet>
        <div style={{
            width: "800px",
            margin: "0 auto",
            // height: "100%",
            border: "1px solid #888",
            borderTop: "1px solid transparent"/* ?? or pref h1 top margin culls side borders... */,
            borderBottom: "0",
            boxSizing: "border-box",
            position: "relative", // XXX: just for Prefs link... ugly.
        }}>
            <Outlet />
        </div>
    </div>;
};

export default Global;
