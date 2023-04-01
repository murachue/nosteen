import { FC, PropsWithChildren } from "react";

const Tab: FC<PropsWithChildren<{
    active?: boolean;
    onClick?: () => void;
}>> = ({ active, onClick, children }) =>
        <div
            style={{
                border: "2px outset black",
                borderRadius: "0 0 5px 5px",
                color: "black",
                margin: active ? "0 -2px" : undefined,
                zIndex: active ? 1 : undefined,
                padding: `0 calc(0.5em + ${active ? "2px" : "0px"}) ${active ? "2px" : "0"}`,
                cursor: "default",
            }}
            onMouseDown={e => onClick && onClick()}
            onTouchStart={e => onClick && onClick()}
        >{children}</div>;

export default Tab;
