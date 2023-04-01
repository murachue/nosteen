import { FC, PropsWithChildren } from "react";


const Tabbar: FC<PropsWithChildren<{}>> = ({ children }) =>
    <div style={{
        width: "100%",
        backgroundColor: "#ccc",
        display: "flex",
        alignItems: "flex-start",
        overflowX: "auto",
    }}>{children}</div>;

export default Tabbar;
