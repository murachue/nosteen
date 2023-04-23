import { produce } from "immer";
import { Children, createContext, Dispatch, FC, PropsWithChildren, ReactElement, ReactNode, SetStateAction, useContext, useEffect, useState } from "react";
import invariant from "tiny-invariant";

const ColWidths = createContext<[] | [string[]] | [string[], Dispatch<SetStateAction<string[]>>]>([]);
const ColIndex = createContext<number | null>(null);

export const TH: FC<PropsWithChildren<{}>> = ({ children }) =>
    <>{Children.map(children, (c, i) =>
        <ColIndex.Provider value={i}>{c}</ColIndex.Provider>
    )}</>;

export const TBody: FC<PropsWithChildren<{}>> = ({ children }) => {
    const [colwidths] = useContext(ColWidths);
    invariant(colwidths, "TBody is not allowed outside ListView");

    // truncate setColwidths to avoid setting width in TBody ("illegal function call"-ish)
    return <ColWidths.Provider value={[colwidths]}>
        {children}
    </ColWidths.Provider>;
};

export const TR: FC<PropsWithChildren<{}>> = ({ children }) =>
    <>{Children.map(children, (c, i) =>
        <ColIndex.Provider value={i}>{c}</ColIndex.Provider>
    )}</>;

export const TD: FC<PropsWithChildren<{
    width?: string;
    renderNode?: (width: string, children?: ReactNode) => ReactElement | null;
}>> = ({ width: setwidth, renderNode, children }) => {
    const [colwidths, setColwidths] = useContext(ColWidths);
    const colindex = useContext(ColIndex);
    invariant(colwidths, "TD is not allowed outside ListView");
    invariant(colindex !== null, "TD is not allowed outside TH/TR");
    useEffect(() => {
        if (setwidth && setwidth !== colwidths[colindex]) {
            invariant(setColwidths, "setting width is only allowed in TH");
            setColwidths(produce(draft => { draft[colindex] = setwidth; }));
        }
    }, [setwidth, colwidths, colindex]);
    const width = setwidth ? setwidth : colwidths[colindex];
    return renderNode
        ? renderNode(width, children)
        : <div style={{ width }}>{children}</div>;
};

const ListView: FC<PropsWithChildren<{}>> = ({ children }) => {
    const colwidths = useState<string[]>([]);

    return <ColWidths.Provider value={colwidths}>
        {children}
    </ColWidths.Provider>;
};

export default ListView;
