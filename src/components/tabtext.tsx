import { FC, PropsWithChildren } from "react";
import { seleltext } from "../util";

const TabText: FC<PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>> = ({ children, onFocus, onBlur, onCopy, ...props }) =>
    <div
        tabIndex={0}
        onFocus={e => { seleltext(e.target); onFocus?.(e); }}
        onCopy={e => { navigator.clipboard.writeText(window.getSelection()?.toString() ?? ""); onCopy?.(e); }}
        onBlur={e => { window.getSelection()?.removeAllRanges(); onBlur?.(e); }}
        {...props}
    >{children}</div>;

export default TabText;
