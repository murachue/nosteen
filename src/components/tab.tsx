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
            margin: active ? "-2px -2px 0" : undefined,
            zIndex: active ? 0 : undefined,
            cursor: "default",
            border: "2px outset",
            borderTop: "0px",
            borderRadius: "0 0 5px 5px",
            background: coloruibg,
            color: coloruitext,
            padding: `${active ? "2px" : "1px"} calc(0.5em + ${active ? "2px" : "0px"}) ${active ? "3px" : "0"}`,
            minHeight: "0",
            font: fontUi,
        }}
        onPointerDown={e => e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && onClick && onClick()}
    >{children}</div>;
};

export default Tab;
