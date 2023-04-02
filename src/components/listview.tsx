import { produce } from "immer";
import { Children, createContext, Dispatch, FC, PropsWithChildren, SetStateAction, useContext, useEffect, useState } from "react";
import invariant from "tiny-invariant";

const ColWidths = createContext<[] | [string[]] | [string[], Dispatch<SetStateAction<string[]>>]>([]);
const ColIndex = createContext<number | null>(null);

export const TH: FC<PropsWithChildren<{}>> = ({ children }) =>
    <div style={{ display: "flex", position: "sticky", width: "100%", top: 0 }}>
        {Children.map(children, (c, i) => <ColIndex.Provider value={i}>{c}</ColIndex.Provider>)}
    </div >;

export const TBody: FC<PropsWithChildren<{}>> = ({ children }) => {
    const [colwidths] = useContext(ColWidths);
    invariant(colwidths, "TBody is not allowed outside ListView");

    // truncate setColwidths to avoid setting width in TBody ("illegal function call"-ish)
    return <ColWidths.Provider value={[colwidths]}>
        <div style={{ display: "flex", flexWrap: "wrap", background: "#664", width: "100%" }}>
            {children}
        </div>
    </ColWidths.Provider>;
};

export const TR: FC<PropsWithChildren<{}>> = ({ children }) =>
    <div style={{ display: "flex", background: "#464", width: "100%" }}>
        {Children.map(children, (c, i) => <ColIndex.Provider value={i}>{c}</ColIndex.Provider>)}
    </div>;

export const TD: FC<PropsWithChildren<{ width?: string; }>> = ({ width: setwidth, children }) => {
    const [colwidths, setColwidths] = useContext(ColWidths);
    const colindex = useContext(ColIndex);
    invariant(colwidths, "TD is not allowed outside ListView");
    invariant(colindex !== null, "TD is not allowed outside TH/TR");
    useEffect(() => {
        if (setwidth && setwidth !== colwidths[colindex]) {
            invariant(setColwidths, "");
            setColwidths(produce(draft => { draft[colindex] = setwidth; }));
        }
    }, [setwidth, colwidths, colindex]);
    const width = setwidth ? setwidth : colwidths[colindex];
    return <div style={{ width }}>{children}</div>;
};

const ListView: FC<PropsWithChildren<{ selected: number; }>> = ({ selected, children }) => {
    const colwidths = useState<string[]>([]);

    return <ColWidths.Provider value={colwidths}>
        <div tabIndex={0} style={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "scroll", position: "relative" }}>
            {children}
        </div>
    </ColWidths.Provider>;
};

export default ListView;
