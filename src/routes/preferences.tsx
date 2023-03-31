import { produce } from "immer";
import { useAtom } from "jotai";
import { useImmerAtom } from "jotai-immer";
import { useCallback, useState } from "react";
import invariant from "tiny-invariant";
import state from "../state";
import { Relay } from "nostr-mux";

export default () => {
    const [prefrelays, setPrefrelays] = useAtom(state.preferences.relays);
    const [relayinsts, setRelayinsts] = useImmerAtom(state.relays);
    const [relaymux, _setRelaymux] = useAtom(state.relaymux);
    const [prefColorNormal, setPrefColorNormal] = useAtom(state.preferences.colors.normal);
    const prefrelayurls = new Set(prefrelays.map(r => r.url));
    const [relays, setRelays] = useState(prefrelays.map(r => ({ ...r, removed: false })));
    const [colorNormal, setColorNormal] = useState(prefColorNormal);
    const [url, setUrl] = useState("");
    const [read, setRead] = useState(true);
    const [write, setWrite] = useState(true);
    const [ispublic, setPublic] = useState(true);

    const save = useCallback(() => {
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
        <h1>Preferences</h1>
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
        <button onClick={() => { save(); }}>Save</button>
        <button onClick={() => { save(); /* TODO publish */ }}>Save & Publish</button>
        <button onClick={() => { setRelays(prefrelays.map(r => ({ ...r, removed: false }))); }}>Reset</button>
    </div >;
};
