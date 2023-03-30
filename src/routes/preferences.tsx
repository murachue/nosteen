import { useAtom } from "jotai";
import { useState } from "react";
import state from "../state";

export default () => {
    const [relays, setRelays] = useAtom(state.preferences.relays);
    const [colorMypost, setColorMypost] = useAtom(state.preferences.colors.normal);
    const [url, setUrl] = useState("");
    const [read, setRead] = useState(true);
    const [write, setWrite] = useState(true);
    const [ispublic, setPublic] = useState(true);

    return <div>
        <h1>Preferences</h1>
        <ul>
            {relays.map(rly => <li key={rly.url}>
                {rly.url}
                <label><input type="checkbox" checked={rly.read} onChange={e => setRead(e.target.checked)} />read</label>
                <label><input type="checkbox" checked={rly.write} onChange={e => setWrite(e.target.checked)} />write</label>
                <label><input type="checkbox" checked={rly.public} onChange={e => setPublic(e.target.checked)} />publish?</label>
                <button onClick={e => e}>Add</button>
            </li>)}
            <li>
                <input type="text" placeholder="wss://..." value={url} onChange={e => setUrl(e.target.value)} />
                <label><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} />read</label>
                <label><input type="checkbox" checked={write} onChange={e => setWrite(e.target.checked)} />write</label>
                <label><input type="checkbox" checked={ispublic} onChange={e => setPublic(e.target.checked)} />publish?</label>
                <button onClick={e => e}>Add</button>
            </li>
        </ul>
    </div>;
};
