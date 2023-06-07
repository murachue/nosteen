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
            minHeight: "100%",
            border: "solid #888",
            borderWidth: "0 1px",
            boxSizing: "border-box",
        }}>
            <Outlet />
        </div>
    </div>;
};

export default Global;
