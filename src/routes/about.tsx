import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { bech32 } from "@scure/base";
import { produce } from "immer";
import { useAtom } from "jotai";
import { EventTemplate, finishEvent, getEventHash, getPublicKey, nip19, validateEvent, verifySignature } from "nostr-tools";
import { useEffect, useRef, useState } from "react";
import icon from "../assets/icon.svg";
import TabText from "../components/tabtext";
import state from "../state";
import { rescue, shortstyle } from "../util";

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
    { key: "~", desc: "Edit profile" },
    { key: "Shift+,", desc: "Preferences" },
    { key: "/", desc: "ENOTIMPL" },
    { key: "?", desc: "About me" },
];

const expecttype = (errs: string[], obj: object, key: string, type: "string" | "number" | "Array"): boolean => {
    if (!(key in obj)) { errs.push(`${key} is missing`); return false; }
    const val = (obj as { [k: typeof key]: unknown; })[key];
    if (type === "Array" ? !Array.isArray(val) : (typeof val !== type)) { errs.push(`${key} is not ${type}`); return false; }
    return true;
};

export default () => {
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [colorbase] = useAtom(state.preferences.colors.base);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const [account] = useAtom(state.preferences.account);
    const klpc = Math.ceil(keys.length / 3);
    const [fonttextfamily, setFonttextfamily] = useState<string | null>(null);
    const fonttextfamilyref = useRef<HTMLDivElement>(null);
    const [aktext, setAktext] = useState("");
    const [signerror, setSignerror] = useState("");

    useEffect(() => {
        const el = fonttextfamilyref.current;
        if (!el) return;
        setFonttextfamily(el.style.fontFamily);
    }, [fonttextfamilyref.current]);

    const sign = async (tev: EventTemplate) => {
        if (account && "privkey" in account) {
            return finishEvent(tev, account.privkey);
        } else if (window.nostr?.signEvent) {
            const sev = await window.nostr.signEvent(tev);
            if (sev.pubkey !== account?.pubkey) {
                throw new Error(`NIP-07 set unexpected pubkey: ${sev.pubkey} expected=${account?.pubkey}`);
            }
            return sev;
        } else {
            throw new Error("could not sign: no private key nor NIP-07 signEvent");
        }
    };

    return <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", color: colornormal }}>
        <div style={{ padding: "2em", display: "flex", flexDirection: "row", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
                <img src={icon} width="256" height="256" />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
                <h1 style={{ margin: 0 }}>
                    <span ref={fonttextfamilyref} style={{ font: fonttext }} />
                    <span style={{ font: `1em ${["Times", fonttextfamily, "sans-serif"].filter(e => e).join(", ")}` }}>Nosteen</span>
                    {" "}
                    <span style={{ margin: 0, fontSize: "0.7rem" }} title={import.meta.env.VITE_APP_COMMITDATE}>{import.meta.env.VITE_APP_GITHASH}</span>
                </h1>
                <p style={{ margin: 0, fontStyle: "italic" }}>A nostalgic Nostr client for Nostraddicts™</p>
            </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0, textAlign: "center" }}>Keybinds</h2>
            <div style={{ margin: "2em", columnCount: 3, columnGap: "0.3em", /* display: "flex", flexDirection: "column", flexWrap: "wrap" */ }}>
                {keys.map(k => <div key={k.key} style={{
                    display: "flex",
                    borderBottom: "1px solid",
                    borderBottomColor: colornormal,
                    padding: "0.3em",
                    minWidth: 0,
                }}>
                    <div style={{ flex: 1 }}>{k.desc}</div>
                    <div style={{ display: "flex", flexDirection: "row", gap: "0.2em" }}>
                        {k.key.split(/\+/).map((k, i) =>
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
                </div>)}
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
                    onKeyDown={e => {
                        if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === "Enter") {
                            if (!account?.pubkey) {
                                setSignerror("pubkey not set in Preference");
                                return;
                            }
                            const obj = rescue(() => JSON.parse(aktext), undefined);
                            // validateEvent does not accept EventTemplate
                            if (typeof obj === "object" && obj !== null && validateEvent<unknown>({ pubkey: "0".repeat(64), ...obj })) {
                                const { kind, content, tags, created_at } = obj;
                                sign({ kind, content, tags, created_at }).then(t => setAktext(JSON.stringify(t)), e => setSignerror(`${e}`));
                            }
                            return;
                        }
                    }}
                    style={{
                        width: "100%",
                        background: colorbase,
                        color: colornormal,
                    }} />
                <div>{(() => {
                    try {
                        {
                            const m = aktext.match(/^["{]/);
                            if (m) {
                                // validateEvent don't return bad reasons...
                                const obj1 = rescue(() => JSON.parse(aktext), e => new Error(`${e}`));
                                if (obj1 instanceof Error) {
                                    return `Bad JSON: ${obj1}`;
                                }

                                let obj = obj1;
                                if (typeof obj1 === "string") {
                                    obj = rescue(() => JSON.parse(obj1), e => new Error(`${e}`));
                                    if (obj instanceof Error) {
                                        return `Bad inner JSON: ${obj}`;
                                    }
                                    if (typeof obj !== "object" || obj === null) {
                                        return `Not an object: ${typeof obj} ${obj}`;
                                    }
                                }

                                const bad: string[] = [];
                                const okid = expecttype(bad, obj, "id", "string");
                                const okpk = expecttype(bad, obj, "pubkey", "string");
                                const okkind = expecttype(bad, obj, "kind", "number");
                                const okcon = expecttype(bad, obj, "content", "string");
                                const oktags = expecttype(bad, obj, "tags", "Array");
                                const okcat = expecttype(bad, obj, "created_at", "number");
                                const oksig = expecttype(bad, obj, "sig", "string");

                                if (oktags) {
                                    for (const [i, v] of (obj.tags as unknown[]).entries()) {
                                        if (!Array.isArray(v)) {
                                            bad.push(`tags[${i}] is not Array`);
                                            continue;
                                        }
                                        for (const [j, e] of (v as unknown[]).entries()) {
                                            if (typeof e === "object") {
                                                bad.push(`tags[${i}][${j}] is not string, number nor boolean`);  // really non-string allowed?? nostr-tools does.
                                            }
                                        }
                                    }
                                }

                                const goodpk = okpk && (obj.pubkey as string).match(/^[0-9A-Fa-f]{64}$/);
                                if (okpk && !goodpk) {
                                    bad.push("pubkey is not a 32 octets hex");
                                }

                                let badsig = false;
                                if (oksig) {
                                    if (!(obj.sig as string).match(/^[0-9A-Fa-f]{128}$/)) {
                                        bad.push("sig is not a 64 octets hex");
                                    } else if (!goodpk) {
                                        bad.push("(signature not checked; valid pubkey not present)");
                                    } else {
                                        const result = rescue<boolean | string>(() => verifySignature(obj), e => `${e}`);
                                        if (result === false) {
                                            bad.push(`bad signature`);
                                            badsig = true;
                                        } else if (result !== true) {
                                            bad.push(`bad signature: ${result}`);
                                        }
                                    }
                                }

                                let idexpect = "";
                                if (okid) {
                                    const expected = rescue(() => getEventHash(obj).toLowerCase(), e => e);
                                    if (typeof expected !== "string") {
                                        bad.push(`bad id: ${expected}`);
                                    } else if ((obj.id as string).toLowerCase() !== expected) {
                                        idexpect = expected;
                                        bad.push(`bad id`);
                                    }
                                }

                                return <ul>
                                    {typeof obj1 !== "string" ? null : <li><div style={{ display: "flex" }}>
                                        <div>unescaped:&nbsp;</div>
                                        <TabText style={shortstyle}>{obj1}</TabText>
                                    </div></li>}
                                    <li>parsed:</li>
                                    <ul>
                                        <li>
                                            <div style={{ display: "flex" }}>
                                                <div>id:&nbsp;</div>
                                                <TabText style={shortstyle}>{okid ? obj.id : "(not a string)"}</TabText>
                                                <div>{!okid || idexpect ? "❌" : "✔"}</div>
                                            </div>
                                            {!idexpect ? null : <ul><li><div style={{ display: "flex" }}>
                                                <div>expected:&nbsp;</div>
                                                <TabText style={shortstyle}>{idexpect}</TabText>
                                            </div></li></ul>}
                                        </li>
                                        <li><div style={{ display: "flex" }}>
                                            <div>pubkey:&nbsp;</div>
                                            <TabText style={shortstyle}>{okpk ? obj.pubkey : "(not a string)"}</TabText>
                                        </div></li>
                                        <li><div style={{ display: "flex" }}>
                                            <div>kind:&nbsp;</div>
                                            <TabText>{okkind ? obj.kind : "(not a number)"}</TabText>
                                        </div></li>
                                        <li><div style={{ display: "flex" }}>
                                            <div>content:&nbsp;</div>
                                            <TabText style={shortstyle}>{okcon ? obj.content : "(not a string)"}</TabText>
                                        </div></li>
                                        <li><div style={{ display: "flex" }}>
                                            <div>tags:&nbsp;</div>
                                            <TabText style={shortstyle}>{oktags ? JSON.stringify(obj.tags) : "(not an array)"}</TabText>
                                        </div></li>
                                        <li><div style={{ display: "flex" }}>
                                            <div>created_at:&nbsp;</div>
                                            <TabText>{okcat ? obj.created_at : "(not a number)"}</TabText>
                                        </div></li>
                                        <li><div style={{ display: "flex" }}>
                                            <div>sig:&nbsp;</div>
                                            <TabText style={shortstyle}>{oksig ? obj.sig : "(not a string)"}</TabText>
                                            <div>{!oksig || badsig ? "❌" : "✔"}</div>
                                        </div></li>
                                    </ul>
                                    {typeof obj1 === "string" ? null : <li><div style={{ display: "flex" }}>
                                        <div>escaped:&nbsp;</div>
                                        <TabText style={shortstyle}>{JSON.stringify(JSON.stringify(obj))}</TabText>
                                    </div></li>}
                                    {!signerror ? null : <li>sign error: {signerror}</li>}
                                    {0 < bad.length
                                        ? <>
                                            <li>errors:</li>
                                            <ul>{bad.map(((e, i) => <li key={i}>{e}</li>))}</ul>
                                        </>
                                        : null}
                                </ul>;
                            }
                        }
                        {
                            const m = aktext.match(/^(.+) ([0-9a-fA-F]+)$/);
                            if (m) {
                                const data = hexToBytes(m[2]);
                                const words = bech32.toWords(data);
                                const hex = bech32.encode(m[1], words, 5e3);
                                return <TabText style={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>{hex}</TabText>;
                            }
                        }
                        {
                            const m = aktext.match(/^[0-9A-Fa-f]{64}$/);
                            if (m) {
                                return <ul>
                                    <li><TabText>{nip19.noteEncode(aktext)}</TabText></li>
                                    <li><TabText>{nip19.neventEncode({ id: aktext })}</TabText></li>
                                    <li><TabText>{nip19.npubEncode(aktext)}</TabText></li>
                                    <li><TabText>{nip19.nprofileEncode({ pubkey: aktext })}</TabText></li>
                                    <li><TabText>{nip19.nsecEncode(aktext)}</TabText></li>
                                    <li style={{ marginLeft: "1em" }}><TabText>{nip19.npubEncode(getPublicKey(aktext))}</TabText></li>
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
                                const decoded = rescue<ReturnType<typeof nip19.decode> | string>(() => nip19.decode(aktext), e => `${e}`);
                                if (typeof decoded === "string") {
                                    return <>
                                        <div>{decoded}</div>
                                        <TabText style={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>{hex}</TabText>
                                    </>;
                                }
                                if (decoded.type === "note" || decoded.type === "npub" || decoded.type === "nsec") {
                                    return <>
                                        <TabText>{decoded.data}</TabText>
                                        <ul>
                                            {decoded.type === "note" && <li><TabText onKeyDown={e => !e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "Enter" && setAktext(nip19.neventEncode({ id: decoded.data }))}>{nip19.neventEncode({ id: decoded.data })}</TabText></li>}
                                            {decoded.type === "npub" && <li><TabText onKeyDown={e => !e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "Enter" && setAktext(nip19.nprofileEncode({ pubkey: decoded.data }))}>{nip19.nprofileEncode({ pubkey: decoded.data })}</TabText></li>}
                                            {decoded.type === "nsec" && (() => {
                                                const pk = getPublicKey(decoded.data);
                                                return <ul>
                                                    <li><TabText>{nip19.npubEncode(pk)}</TabText></li>
                                                    <li><TabText>{pk}</TabText></li>
                                                </ul>;
                                            })()}
                                        </ul>
                                    </>;
                                }
                                if (decoded.type === "nevent" || decoded.type === "nprofile" || decoded.type === "naddr") {
                                    return <>
                                        <ul>
                                            {(() => {
                                                switch (decoded.type) {
                                                    case "nevent": return <>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>id:&nbsp;</div>
                                                            <div style={{ display: "flex", flexDirection: "column" }}>
                                                                <div><TabText>{decoded.data.id}</TabText></div>
                                                                <div><TabText>{nip19.noteEncode(decoded.data.id)}</TabText></div>
                                                            </div>
                                                        </div></li>
                                                        <li>{decoded.data.author
                                                            ? <div style={{ display: "flex", flexDirection: "row" }}>
                                                                <div>author:&nbsp;</div>
                                                                <div style={{ display: "flex", flexDirection: "column" }}>
                                                                    <div><TabText>{decoded.data.author}</TabText></div>
                                                                    <div><TabText>{nip19.npubEncode(decoded.data.author)}</TabText></div>
                                                                </div>
                                                            </div>
                                                            : "author not included"}</li>
                                                    </>;
                                                    case "nprofile": return <>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>pubkey:&nbsp;</div>
                                                            <div style={{ display: "flex", flexDirection: "column" }}>
                                                                <div><TabText>{decoded.data.pubkey}</TabText></div>
                                                                <div><TabText>{nip19.npubEncode(decoded.data.pubkey)}</TabText></div>
                                                            </div>
                                                        </div></li>
                                                    </>;
                                                    case "naddr": return <>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>kind:&nbsp;</div>
                                                            <TabText>{decoded.data.kind}</TabText>
                                                        </div></li>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>pubkey:&nbsp;</div>
                                                            <div style={{ display: "flex", flexDirection: "column" }}>
                                                                <div><TabText>{decoded.data.pubkey}</TabText></div>
                                                                <div><TabText>{nip19.npubEncode(decoded.data.pubkey)}</TabText></div>
                                                            </div>
                                                        </div></li>
                                                        <li><div style={{ display: "flex", flexDirection: "row" }}>
                                                            <div>identifier:&nbsp;</div>
                                                            <TabText>{decoded.data.identifier}</TabText>
                                                        </div></li>
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
                                    return <>
                                        <TabText>{decoded.data}</TabText>
                                        <TabText style={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>{hex}</TabText>
                                    </>;
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
                &mdash;&mdash; Murachue<br />
                <span style={{ fontFamily: "monospace" }}>
                    npub1amhc78pnl6lva0y0uz4ten6zv6zl2cy9a6x7zr47jgq24zhr774sym0hf9
                </span>
            </p>
        </div>
    </div>;
};
