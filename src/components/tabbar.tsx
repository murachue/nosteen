import { useAtom } from "jotai";
import { FC, PropsWithChildren } from "react";
import state from "../state";

const Tabbar: FC<PropsWithChildren<{}>> = ({ children }) => {
    const [coloruibg] = useAtom(state.preferences.colors.uibg);

    return <div style={{
        width: "100%",
        backgroundColor: coloruibg,
        display: "flex",
        alignItems: "flex-start",
        overflowX: "auto",
    }}>
        {children}
        <div style={{
            flex: "1",
            borderTop: "inset 2px",
        }} />
    </div>;
};

export default Tabbar;
