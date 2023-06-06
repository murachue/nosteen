import { bytesToHex } from "@noble/hashes/utils";
import { bech32 } from "@scure/base";
import { produce } from "immer";
import { useAtom } from "jotai";
import { getPublicKey, nip19 } from "nostr-tools";
import { useEffect, useRef, useState } from "react";
import icon from "../assets/icon.svg";
import TabText from "../components/tabtext";
import state from "../state";

const keys = [
    { key: "A", desc: "Previous tab" },
    { key: "S", desc: "Next tab" },
    { key: "J", desc: "Next event" },
    { key: "K", desc: "Previous event" },
    { key: "H", desc: "Previous pubkey event" },
    { key: "L", desc: "Next pubkey event" },
    { key: "[", desc: "Previous thread event" },
    { key: "]", desc: "Next thread event" },
    { key: "Enter", desc: "Reply" },
    { key: "Shift+J", desc: "Scroll text up" },
    { key: "Shift+K", desc: "Scroll text down" },
    { key: "P", desc: "ENOTIMPL" },
    { key: "N", desc: "ENOTIMPL" },
    { key: "I", desc: "Focus the editor" },
    { key: "G", desc: "Select first event" },
    { key: "Shift+G", desc: "Select last event" },
    { key: "Shift+H", desc: "ENOTIMPL" },
    { key: "Shift+M", desc: "ENOTIMPL" },
    { key: "Shift+L", desc: "ENOTIMPL" },
    { key: "E", desc: "Links from the event" },
    { key: "1..8", desc: "Nth tab" },
    { key: "9", desc: "Last tab" },
    { key: "Space", desc: "Next unread event" },
    { key: "M", desc: "Event info" },
    { key: "B", desc: "Mark unread newer" },
    { key: "Shift+B", desc: "Mark read older" },
    { key: "U", desc: "Pubkey info" },
    { key: "Shift+U", desc: "Open pubkey posts" },
    { key: "Shift+I", desc: "Open event thread" },
    { key: "Shift+W", desc: "Close the tab" },
    { key: "&", desc: "Open unread events" },
    { key: "T", desc: "Tab menu" },
    { key: "Shift+T", desc: "ENOTIMPL" },
    { key: "Y", desc: "Relays info" },
    { key: "Shift+F", desc: "Reaction" },
    { key: "Shift+R", desc: "Repost" },
    { key: "Q", desc: "Quote the event" },
    { key: "Shift+E", desc: "Broadcast the event" },
    { key: "Shift+D", desc: "Delete the event" },
    { key: "Shift+,", desc: "Preferences" },
    { key: "/", desc: "ENOTIMPL" },
    { key: "?", desc: "About me" },
];

export default () => {
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [colorbase] = useAtom(state.preferences.colors.base);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const klpc = Math.ceil(keys.length / 3);
    const [fonttextfamily, setFonttextfamily] = useState<string | null>(null);
    const fonttextfamilyref = useRef<HTMLDivElement>(null);
    const [aktext, setAktext] = useState("");

    useEffect(() => {
        const el = fonttextfamilyref.current;
        if (!el) return;
        setFonttextfamily(el.style.fontFamily);
    }, [fonttextfamilyref.current]);

    return <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", color: colornormal }}>
        <div style={{ padding: "2em", display: "flex", flexDirection: "row", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
                <img src={icon} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
                <h1 style={{ margin: 0 }}>
                    <span ref={fonttextfamilyref} style={{ font: fonttext }} />
                    <span style={{ font: `1em ${["Times", fonttextfamily, "sans-serif"].filter(e => e).join(", ")}` }}>Nosteen</span>
                    {" "}
                    <span style={{ margin: 0, fontSize: "0.7rem" }}>{import.meta.env.VITE_APP_VERSION}</span>
                </h1>
                <p style={{ margin: 0, fontStyle: "italic" }}>A nostalgic Nostr client for Nostraddicts™</p>
            </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0, textAlign: "center" }}>Keybinds</h2>
            {/* FIXME: column-count with flexbox without explicit height? */}
            <div style={{ margin: "2em", display: "flex", flexDirection: "row", gap: "0.3em" }}>
                {<> {new Array(3).fill(0).map((_, ci) =>
                    <div key={ci} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                        {<> {keys.slice(klpc * ci, klpc * (ci + 1)).map((_, ri) => {
                            const kmap = keys[ci * klpc + ri];
                            return <div key={ri} style={{
                                display: "flex",
                                borderBottom: "1px solid",
                                borderBottomColor: colornormal,
                                padding: "0.3em",
                            }}>
                                <div style={{ flex: 1 }}>{kmap.desc}</div>
                                <div style={{ display: "flex", flexDirection: "row", gap: "0.2em" }}>
                                    {kmap.key.split(/\+/).map((k, i) =>
                                        <div key={i} style={{
                                            border: `1px solid ${colornormal}`,
                                            borderRadius: "0.1em",
                                            background: "#0004",
                                            minWidth: "1em",
                                            height: "1.3em",
                                            textAlign: "center",
                                            padding: "0 0.2em",
                                        }}>{k}</div>
                                    )}
                                </div>
                            </div>;
                        }
                        )} </>}
                    </div>
                )} </>}
            </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0, textAlign: "center" }}>Army Knife</h2>
            <div style={{ margin: "2em", display: "flex", flexDirection: "column", gap: "0.3em" }}>
                <input
                    type="text"
                    placeholder="Enter a hex, npub1, note1, nevent1, ..."
                    value={aktext}
                    onChange={e => setAktext(e.target.value)}
                    style={{
                        width: "100%",
                        background: colorbase,
                        color: colornormal,
                    }} />
                <div>{(() => {
                    try {
                        {
                            const m = aktext.match(/^[0-9A-Fa-f]{64}$/);
                            if (m) {
                                return <ul>
                                    <li><TabText>{nip19.noteEncode(aktext)}</TabText></li>
                                    <li><TabText>{nip19.neventEncode({ id: aktext })}</TabText></li>
                                    <li><TabText>{nip19.npubEncode(aktext)}</TabText></li>
                                    <li><TabText>{nip19.nsecEncode(aktext)}</TabText></li>
                                    <li style={{ marginLeft: "1em" }}><TabText>{nip19.npubEncode(getPublicKey(aktext))}</TabText></li>
                                    <li><TabText>{nip19.nprofileEncode({ pubkey: aktext })}</TabText></li>
                                </ul>;
                            }
                        }
                        {
                            const m = aktext.match(/:\/\//);
                            if (m) {
                                return <ul>
                                    <li><TabText>{nip19.nrelayEncode(aktext)}</TabText></li>
                                </ul>;
                            }
                        }
                        {
                            const m = aktext.match(/^(note|nevent|npub|nsec|nprofile|nrelay|naddr)1[0-9a-z]+$/);
                            if (m) {
                                const hex = bytesToHex(bech32.fromWords(bech32.decode(aktext, 1e5).words));
                                const decoded = nip19.decode(aktext);
                                if (decoded.type === "note" || decoded.type === "npub" || decoded.type === "nsec") {
                                    return <div><TabText>{decoded.data}</TabText></div>;
                                }
                                if (decoded.type === "nevent" || decoded.type === "nprofile" || decoded.type === "naddr") {
                                    return <>
                                        <ul>
                                            {(() => {
                                                switch (decoded.type) {
                                                    case "nevent": return <>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>id:&nbsp;</div>
                                                            <TabText>{decoded.data.id}</TabText></div>
                                                        </li>
                                                        <li>{decoded.data.author
                                                            ? <div style={{ display: "flex", flexDirection: "row" }}>
                                                                <div>author:&nbsp;</div>
                                                                <TabText>{decoded.data.author}</TabText>
                                                            </div>
                                                            : "author not included"}</li>
                                                    </>;
                                                    case "nprofile": return <>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>pubkey:&nbsp;</div>
                                                            <TabText>{decoded.data.pubkey}</TabText></div>
                                                        </li>
                                                    </>;
                                                    case "naddr": return <>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>kind:&nbsp;</div>
                                                            <TabText>{decoded.data.kind}</TabText></div>
                                                        </li>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>pubkey:&nbsp;</div>
                                                            <TabText>{decoded.data.pubkey}</TabText></div>
                                                        </li>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>identifier:&nbsp;</div>
                                                            <TabText>{decoded.data.identifier}</TabText></div>
                                                        </li>
                                                    </>;
                                                    default:
                                                        throw new Error(`program error: bad switch: ${(decoded as any).type}`);
                                                }
                                            })()}
                                            <li>Relays:</li>
                                            <ul>
                                                {[...(decoded.data.relays || []), ""].map((r, i) => <li key={i}>
                                                    <input
                                                        type="text"
                                                        placeholder="wss://..."
                                                        value={r}
                                                        onChange={e => {
                                                            const value = e.target.value;
                                                            const newrelays = produce(draft => {
                                                                if (i < draft.length) {
                                                                    if (value !== "") {
                                                                        draft[i] = value;
                                                                    } else {
                                                                        draft.splice(i, 1);
                                                                    }
                                                                } else {
                                                                    draft.push(value);
                                                                }
                                                            })(decoded.data.relays || []);
                                                            switch (decoded.type) {
                                                                case "nevent": {
                                                                    setAktext(nip19.neventEncode({
                                                                        ...decoded.data,
                                                                        relays: 0 < newrelays.length ? newrelays : undefined,
                                                                    }));
                                                                    break;
                                                                }
                                                                case "nprofile": {
                                                                    setAktext(nip19.nprofileEncode({
                                                                        ...decoded.data,
                                                                        relays: 0 < newrelays.length ? newrelays : undefined,
                                                                    }));
                                                                    break;
                                                                }
                                                                case "naddr": {
                                                                    setAktext(nip19.naddrEncode({
                                                                        ...decoded.data,
                                                                        relays: 0 < newrelays.length ? newrelays : undefined,
                                                                    }));
                                                                    break;
                                                                }
                                                            }
                                                        }}
                                                        style={{
                                                            width: "100%",
                                                            background: colorbase,
                                                            color: colornormal,
                                                        }} />
                                                </li>)}
                                            </ul>
                                        </ul>
                                        <TabText style={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>{hex}</TabText>
                                    </>;
                                }
                                if (decoded.type === "nrelay") {
                                    return <div><TabText>{decoded.data}</TabText></div>;
                                }
                                throw new Error(`program error: unsupported decoded type: ${(decoded as any).type}`);
                            }
                        }
                        return null;
                    } catch (e) {
                        return `${e}`;
                    }
                })()}</div>
            </div>
        </div>
        <div style={{ marginTop: "2em", textAlign: "center" }}>
            <p>
                {"in honor of "}
                <a style={{ color: colornormal }} href="https://twitter.com/kiri_feather">@kiri_feather</a>{", "}
                <a style={{ color: colornormal }} href="https://twitter.com/kim_upsilon">@kim_upsilon</a>{" and "}
                <a style={{ color: colornormal }} href="https://twitter.com/opentween">@OpenTween contributors</a>...
            </p>
            <p>
                <span style={{ letterSpacing: "-0.2em" }}>&mdash;&mdash;</span> Murachue<br />
                <span style={{ fontFamily: "monospace" }}>
                    npub1amhc78pnl6lva0y0uz4ten6zv6zl2cy9a6x7zr47jgq24zhr774sym0hf9
                </span>
            </p>
        </div>
    </div>;
};
