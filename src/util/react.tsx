import { CSSProperties, useEffect, useState } from "react";

export const seleltext = (el: HTMLElement) => {
    // https://stackoverflow.com/a/987376
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    // FIXME: Chrome 114 is ok without setTimeout but Firefox 114 clears selection... with setTimeout both works.
    setTimeout(() => {
        selection.addRange(range);
    }, 0);
};

export function useEventSnapshot<T>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => T): T {
    const [value, setValue] = useState(() => getSnapshot());
    useEffect(() => {
        return subscribe(() => setValue(getSnapshot()));
    }, [subscribe, getSnapshot]);
    return value;
}

export const shortstyle: CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
};
