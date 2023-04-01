import { produce } from "immer";
import { useAtom } from "jotai";
import { useImmerAtom } from "jotai-immer";
import { FC, useCallback, useState } from "react";
import invariant from "tiny-invariant";
import state from "../state";
import { Relay } from "nostr-mux";
import { Link } from "react-router-dom";

// const ColorBox: FC<{ color: string; }> = ({ color }) => <div style={{
//     display: "inline-block",
//     width: "1em",
//     height: "1em",
//     border: "1px solid white",
//     backgroundColor: color,
//     verticalAlign: "middle",
// }} />;

export default () => {
    const [prefrelays, setPrefrelays] = useAtom(state.preferences.relays);
    const [relayinsts, setRelayinsts] = useImmerAtom(state.relays);
    const [relaymux, _setRelaymux] = useAtom(state.relaymux);
    const [prefColorNormal, setPrefColorNormal] = useAtom(state.preferences.colors.normal);
    const [prefColorRepost, setPrefColorRepost] = useAtom(state.preferences.colors.repost);
    const [prefColorReacted, setPrefColorReacted] = useAtom(state.preferences.colors.reacted);
    const [prefColorBase, setPrefColorBase] = useAtom(state.preferences.colors.base);
    const [prefColorMypost, setPrefColorMypost] = useAtom(state.preferences.colors.mypost);
    const [prefColorReplytome, setPrefColorReplytome] = useAtom(state.preferences.colors.replytome);
    const [prefColorThempost, setPrefColorThempost] = useAtom(state.preferences.colors.thempost);
    const [prefColorThemreplyto, setPrefColorThemreplyto] = useAtom(state.preferences.colors.themreplyto);
    const prefrelayurls = new Set(prefrelays.map(r => r.url));
    const [relays, setRelays] = useState(prefrelays.map(r => ({ ...r, removed: false })));
    const [colorNormal, setColorNormal] = useState(prefColorNormal);
    const [colorRepost, setColorRepost] = useState(prefColorRepost);
    const [colorReacted, setColorReacted] = useState(prefColorReacted);
    const [colorBase, setColorBase] = useState(prefColorBase);
    const [colorMypost, setColorMypost] = useState(prefColorMypost);
    const [colorReplytome, setColorReplytome] = useState(prefColorReplytome);
    const [colorThempost, setColorThempost] = useState(prefColorThempost);
    const [colorThemreplyto, setColorThemreplyto] = useState(prefColorThemreplyto);
    const [url, setUrl] = useState("");
    const [read, setRead] = useState(true);
    const [write, setWrite] = useState(true);
    const [ispublic, setPublic] = useState(true);

    const saverelays = useCallback(() => {
        const newmap = new Map(relays.map(r => [r.url, r]));

        // add
        for (const [url, r] of newmap.entries()) {
            if (prefrelayurls.has(url)) continue;

            const relay = new Relay(url, { read: r.read, write: r.write });
            setRelayinsts(draft => draft.set(url, relay));
            relaymux.addRelay(relay);
        }

        // update
        for (const [url, r] of newmap.entries()) {
            if (!prefrelayurls.has(url)) continue;

            const ri = relayinsts.get(url);
            invariant(ri, `relay instance not found for ${url}`);
            ri.updatePermission({ read: r.read, write: r.write });
        }

        // remove
        for (const r of prefrelays) {
            if (newmap.has(r.url)) continue;

            const ri = relayinsts.get(r.url);
            invariant(ri, `relay instance not found for ${r.url}`);
            setRelayinsts(is => is.delete(r.url));
            relaymux.removeRelay(r.url);
        }

        setPrefrelays(relays.filter(r => !r.removed).map(({ url, read, write, public: ispublic }) => ({ url, read, write, public: ispublic })));
        setRelays(relays => relays.filter(r => !r.removed));
    }, [relays]);

    return <div>
        <h1><div style={{ display: "inline-block" }}><Link to="/">&lt;&lt;</Link>&nbsp;</div>Preferences</h1>
        <h2>Relays:</h2>
        <p>
            <ul>
                {relays.map((rly, i) => <li key={rly.url}>
                    <span style={{ textDecoration: rly.removed ? "line-through" : undefined }}>{rly.url}</span>
                    <span style={{ marginLeft: "1em" }}>
                        <label><input type="checkbox" checked={rly.read} onChange={e => setRelays(produce(draft => { draft[i].read = e.target.checked; }))} />read</label>
                        <label><input type="checkbox" checked={rly.write} onChange={e => setRelays(produce(draft => { draft[i].write = e.target.checked; }))} />write</label>
                        <label><input type="checkbox" checked={rly.public} onChange={e => setRelays(produce(draft => { draft[i].public = e.target.checked; }))} />publish?</label>
                        <button disabled={rly.removed} onClick={e => {
                            if (prefrelayurls.has(rly.url)) {
                                setRelays(produce(draft => {
                                    const r = draft.find(r => r.url === rly.url);
                                    invariant(r, "inconsistent relays");
                                    r.removed = true;
                                }));
                            } else {
                                setRelays(relays => relays.filter(r => r.url !== rly.url));
                            }
                        }}>Remove</button>
                    </span>
                </li>)}
                <li>
                    <input type="text" placeholder="wss://..." /* pattern="^wss?://.+" */ value={url} onChange={e => setUrl(e.target.value)} />
                    <label><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} />read</label>
                    <label><input type="checkbox" checked={write} onChange={e => setWrite(e.target.checked)} />write</label>
                    <label><input type="checkbox" checked={ispublic} onChange={e => setPublic(e.target.checked)} />publish?</label>
                    <button disabled={!/^wss?:\/\/.+/.exec(url)} onClick={e => {
                        setRelays(produce(draft => { draft.push({ url, read, write, public: ispublic, removed: false }); }));
                        setUrl("");
                        setRead(true);
                        setWrite(true);
                        setPublic(true);
                    }}>Add</button>
                </li>
            </ul>
            <button onClick={() => { saverelays(); }}>Save</button>
            <button onClick={() => { saverelays(); /* TODO publish */ }}>Save & Publish</button>
            <button onClick={() => { setRelays(prefrelays.map(r => ({ ...r, removed: false }))); }}>Reset</button>
        </p>
        <h2>Colors:</h2>
        <p>
            <ul>
                <li>normal: <input type="text" value={colorNormal} style={{ background: colorBase, color: colorNormal }} onChange={e => setColorNormal(e.target.value)} /></li>
                <li>repost: <input type="text" value={colorRepost} style={{ background: colorBase, color: colorRepost }} onChange={e => setColorRepost(e.target.value)} /></li>
                <li>reacted: <input type="text" value={colorReacted} style={{ background: colorBase, color: colorReacted }} onChange={e => setColorReacted(e.target.value)} /></li>
                <li>base: <input type="text" value={colorBase} style={{ background: colorBase, color: colorNormal }} onChange={e => setColorBase(e.target.value)} /></li>
                <li>mypost: <input type="text" value={colorMypost} style={{ background: colorMypost, color: colorNormal }} onChange={e => setColorMypost(e.target.value)} /></li>
                <li>reply to me: <input type="text" value={colorReplytome} style={{ background: colorReplytome, color: colorNormal }} onChange={e => setColorReplytome(e.target.value)} /></li>
                <li>their post: <input type="text" value={colorThempost} style={{ background: colorThempost, color: colorNormal }} onChange={e => setColorThempost(e.target.value)} /></li>
                <li>their reply target: <input type="text" value={colorThemreplyto} style={{ background: colorThemreplyto, color: colorNormal }} onChange={e => setColorThemreplyto(e.target.value)} /></li>
            </ul>
            <button onClick={() => {
                setPrefColorNormal(colorNormal);
                setPrefColorRepost(colorRepost);
                setPrefColorReacted(colorReacted);
                setPrefColorBase(colorBase);
                setPrefColorMypost(colorMypost);
                setPrefColorReplytome(colorReplytome);
                setPrefColorThempost(colorThempost);
                setPrefColorThemreplyto(colorThemreplyto);
            }}>Save</button>
            <button onClick={() => {
                setColorNormal(prefColorNormal);
                setColorRepost(prefColorRepost);
                setColorReacted(prefColorReacted);
                setColorBase(prefColorBase);
                setColorMypost(prefColorMypost);
                setColorReplytome(prefColorReplytome);
                setColorThempost(prefColorThempost);
                setColorThemreplyto(prefColorThemreplyto);
            }}>Reset</button>
        </p>
    </div >;
};
