import { FC, PropsWithChildren } from "react";
import state from "../state";
import { useAtom } from "jotai";

const Tab: FC<PropsWithChildren<{
    active?: boolean;
    onClick?: () => void;
}>> = ({ active, onClick, children }) => {
    const [coloruitext] = useAtom(state.preferences.colors.uitext);
    const [coloruibg] = useAtom(state.preferences.colors.uibg);
    const [fontUi] = useAtom(state.preferences.fonts.ui);
    return <div
        style={{
            margin: active ? "0 -2px" : undefined,
            zIndex: active ? 1 : undefined,
            cursor: "default",

            display: "flex",
            flexDirection: "column",
        }}
        onMouseDown={e => onClick && onClick()}
        onTouchStart={e => onClick && onClick()}
    >
        <div style={{
            width: "100%",
            height: "0",
            borderTop: active ? "0" : "2px inset",
        }}></div>
        <div style={{
            border: "2px outset black",
            borderTop: "0px",
            borderRadius: "0 0 5px 5px",
            background: coloruibg,
            color: coloruitext,
            padding: `${active ? "2px" : "0"} calc(0.5em + ${active ? "2px" : "0px"}) ${active ? "2px" : "0"}`,
            font: fontUi,
        }}>{children}</div>
    </div>;
};

export default Tab;
