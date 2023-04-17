declare module "react-virtualized-listview" { // 0.1.7
    declare export default class List extends React.Component {
        constructor(props: {
            source: { height: string; }[] = [];
            /// applying style is REQUIRED.
            renderItem: (props: { index: number; style: string | object; }) => React.ReactNode;
            className?: string;
            overScanCount?: number = 5;
        });
    }
}
