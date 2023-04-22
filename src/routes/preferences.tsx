import { produce } from "immer";
import { useAtom } from "jotai";
import { useImmerAtom } from "jotai-immer";
import { Relay } from "nostr-mux";
import { decodeBech32ID, encodeBech32ID } from "nostr-mux/dist/core/utils";
import { generatePrivateKey, getPublicKey } from "nostr-tools";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import invariant from "tiny-invariant";
import state from "../state";
import { useNostrWorker } from "../nostrworker";

export default () => {
    const mux = useNostrWorker();

    // TODO: open this pref page directly cause lost-load pref values
    const [prefrelays, setPrefrelays] = useAtom(state.preferences.relays);
    const [prefaccount, setPrefaccount] = useAtom(state.preferences.account);
    const [prefColorNormal, setPrefColorNormal] = useAtom(state.preferences.colors.normal);
    const [prefColorRepost, setPrefColorRepost] = useAtom(state.preferences.colors.repost);
    const [prefColorReacted, setPrefColorReacted] = useAtom(state.preferences.colors.reacted);
    const [prefColorBase, setPrefColorBase] = useAtom(state.preferences.colors.base);
    const [prefColorSelectedText, setPrefColorSelectedText] = useAtom(state.preferences.colors.selectedtext);
    const [prefColorSelectedBg, setPrefColorSelectedBg] = useAtom(state.preferences.colors.selectedbg);
    const [prefColorMypost, setPrefColorMypost] = useAtom(state.preferences.colors.mypost);
    const [prefColorReplytome, setPrefColorReplytome] = useAtom(state.preferences.colors.replytome);
    const [prefColorThempost, setPrefColorThempost] = useAtom(state.preferences.colors.thempost);
    const [prefColorThemreplyto, setPrefColorThemreplyto] = useAtom(state.preferences.colors.themreplyto);
    const [prefColorLinkText, setPrefColorLinkText] = useAtom(state.preferences.colors.linktext);
    const [prefColorUiText, setPrefColorUiText] = useAtom(state.preferences.colors.uitext);
    const [prefColorUiBg, setPrefColorUiBg] = useAtom(state.preferences.colors.uibg);
    const [prefFontText, setPrefFontText] = useAtom(state.preferences.fonts.text);
    const [prefFontUi, setPrefFontUi] = useAtom(state.preferences.fonts.ui);

    const normhex = (s: string, tag: string) => {
        if (!s.startsWith(tag)) {
            // fastpath
            return s;
        }
        const id = decodeBech32ID(s);
        return id && id.prefix === tag ? id.hexID : s;
    };
    const normb32 = (s: string, tag: "npub" | "nsec") => {
        if (!/^[0-9A-Fa-f]{64}$/.exec(s)) {
            return s;
        }
        return encodeBech32ID(tag, s);
    };

    const prefrelayurls = new Set(prefrelays.map(r => r.url));
    const [relays, setRelays] = useState(prefrelays.map(r => ({ ...r, added: false, removed: false })));
    const [colorNormal, setColorNormal] = useState(prefColorNormal);
    const [colorRepost, setColorRepost] = useState(prefColorRepost);
    const [colorReacted, setColorReacted] = useState(prefColorReacted);
    const [colorBase, setColorBase] = useState(prefColorBase);
    const [colorSelectedText, setColorSelectedText] = useState(prefColorSelectedText);
    const [colorSelectedBg, setColorSelectedBg] = useState(prefColorSelectedBg);
    const [colorMypost, setColorMypost] = useState(prefColorMypost);
    const [colorReplytome, setColorReplytome] = useState(prefColorReplytome);
    const [colorThempost, setColorThempost] = useState(prefColorThempost);
    const [colorThemreplyto, setColorThemreplyto] = useState(prefColorThemreplyto);
    const [colorLinkText, setColorLinkText] = useState(prefColorLinkText);
    const [colorUiText, setColorUiText] = useState(prefColorUiText);
    const [colorUiBg, setColorUiBg] = useState(prefColorUiBg);
    const [fontText, setFontText] = useState(prefFontText);
    const [fontUi, setFontUi] = useState(prefFontUi);
    const [url, setUrl] = useState("");
    const [npub, setNpub] = useState(normb32(prefaccount?.pubkey || "", "npub") || "");
    const [nsec, setNsec] = useState(normb32(prefaccount && "privkey" in prefaccount ? prefaccount.privkey : "", "nsec") || "");
    const [nsecmask, setNsecmask] = useState(true);

    const navigate = useNavigate();

    const saverelays = useCallback(() => {
        const filteredRelays = relays.filter(r => !r.removed);
        mux!.setRelays(filteredRelays.map(r => ({ url: r.url, read: r.read, write: r.write })));

        setPrefrelays(filteredRelays.map(({ url, read, write, public: ispublic }) => ({ url, read, write, public: ispublic })));
        setRelays(filteredRelays.map(r => ({ ...r, added: false })));
    }, [relays, prefrelayurls]);

    const npubok = !!/^[0-9A-Fa-f]{64}$/.exec(normhex(npub, "npub")); // it really should <secp250k1.p but ignore for simplicity.
    const nsecvalid = (nsec === "" && npubok) || !!/^[0-9A-Fa-f]{64}$/.exec(normhex(nsec, "nsec")); // it really should <secp250k1.n but ignore for simplicity.
    const nsecok = !!/^[0-9A-Fa-f]{64}$/.exec(normhex(nsec, "nsec")); // it really should <secp250k1.n but ignore for simplicity.

    return <div style={{ height: "100%", overflowY: "auto" }}>
        <h1><div style={{ display: "inline-block" }}><Link to="/" onClick={e => navigate(-1)} style={{ color: "unset" }}>&lt;&lt;</Link>&nbsp;</div>Preferences</h1>
        <h2>Relays:</h2>
        <div style={{ marginLeft: "2em", display: "grid", gridTemplateColumns: "max-content max-content max-content max-content max-content", columnGap: "0.5em" }}>
            {relays.map((rly, i) => <>
                <div key={`url:${rly.url}`} style={{ textDecoration: rly.removed ? "line-through" : undefined, fontStyle: rly.added ? "italic" : undefined }}>{rly.url}</div>
                <div key={`r:${rly.url}`} style={{ marginLeft: "1em" }}><label><input type="checkbox" checked={rly.read} onChange={e => setRelays(produce(draft => { draft[i].read = e.target.checked; }))} />read</label></div>
                <div key={`w:${rly.url}`}><label><input type="checkbox" checked={rly.write} onChange={e => setRelays(produce(draft => { draft[i].write = e.target.checked; }))} />write</label></div>
                <div key={`p:${rly.url}`}><label><input type="checkbox" checked={rly.public} onChange={e => setRelays(produce(draft => { draft[i].public = e.target.checked; }))} />publish?</label></div>
                <button key={`b:${rly.url}`} disabled={rly.removed} onClick={e => {
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
            </>)}
            <div style={{ gridColumn: "1 / 5", display: "flex" }}><input type="text" placeholder="wss://..." /* pattern="^wss?://.+" */ value={url} onChange={e => setUrl(e.target.value)} style={{ flex: "1" }} /></div>
            <div>
                <button style={{ width: "100%" }} disabled={!/^wss?:\/\/.+/.exec(url)} onClick={e => {
                    setRelays(produce(draft => { draft.push({ url, read: true, write: true, public: true, added: true, removed: false }); }));
                    setUrl("");
                }}>Add</button>
            </div>
        </div>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => { saverelays(); }}>Save</button>
            <button onClick={() => { saverelays(); /* TODO publish */ }}>Save & Publish</button>
            <button onClick={() => { setRelays(prefrelays.map(r => ({ ...r, added: false, removed: false }))); }}>Reset</button>
        </p>
        <h2>Account:</h2>
        <ul>
            <li>pubkey:
                <div style={{ display: "inline-block", borderWidth: "1px", borderStyle: "solid", borderColor: npubok ? "#0f08" : "#f008" }}>
                    <input type="text" placeholder="npub1... or hex (auto-filled when correct privkey is set)" size={64} disabled={nsecok} value={npub} style={{ fontFamily: "monospace" }} onChange={e => {
                        const s = e.target.value;
                        if (/^[0-9A-Fa-f]{64}$/.exec(s)) {
                            setNpub(encodeBech32ID("npub", s) || "");
                        } else {
                            // TODO: nprofile support
                            setNpub(s);
                        }
                    }} />
                </div>
            </li>
            <li>privkey:
                <div style={{ display: "inline-block", borderWidth: "1px", borderStyle: "solid", borderColor: nsecvalid ? "#0f08" : "#f008" }}>
                    <input type={nsecmask ? "password" : "text"} placeholder="nsec1... or hex (NIP-07 extension is very recommended)" size={64} value={nsec} style={{ fontFamily: "monospace" }} onChange={e => {
                        const s = e.target.value;
                        if (/^[0-9A-Fa-f]{64}$/.exec(s)) {
                            setNsec(encodeBech32ID("nsec", s) || "");
                        } else {
                            setNsec(s);
                        }
                        const hs = normhex(s, "nsec");
                        if (/^[0-9A-Fa-f]{64}$/.exec(hs)) {
                            setNpub(encodeBech32ID("npub", getPublicKey(hs)) || "");
                        }
                    }} onFocus={e => setNsecmask(false)} onBlur={e => setNsecmask(true)} />
                </div>
            </li>
        </ul>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button disabled={!((npub === "" && nsec === "") || (npubok && nsecvalid))} onClick={e => {
                // TODO: NIP-07
                setPrefaccount(
                    (npub === "" && nsec === "") ? null
                        : (npubok && nsec === "") ? { pubkey: normhex(npub, "npub") }
                            : { pubkey: normhex(npub, "npub"), privkey: normhex(nsec, "nsec") }
                );
            }}>Set</button>
            <button onClick={e => {
                // TODO: NIP-07
                alert("ENOTIMPL");
            }}>Login with extension</button>
            <button onClick={e => {
                const sk = generatePrivateKey();
                setNsec(encodeBech32ID("nsec", sk) || "");
                setNpub(encodeBech32ID("npub", getPublicKey(sk)) || "");
            }}>Generate</button>
            <button onClick={e => {
                setNpub(normb32(prefaccount?.pubkey || "", "npub") || "");
                setNsec(normb32(prefaccount && "privkey" in prefaccount ? prefaccount.privkey : "", "nsec") || "");
            }}>Reset</button>
        </p>
        <h2>Colors:</h2>
        <ul>
            <li>normal: <input type="text" value={colorNormal} style={{ background: colorBase, color: colorNormal }} onChange={e => setColorNormal(e.target.value)} /></li>
            <li>repost: <input type="text" value={colorRepost} style={{ background: colorBase, color: colorRepost }} onChange={e => setColorRepost(e.target.value)} /></li>
            <li>reacted: <input type="text" value={colorReacted} style={{ background: colorBase, color: colorReacted }} onChange={e => setColorReacted(e.target.value)} /></li>
            <li>base: <input type="text" value={colorBase} style={{ background: colorBase, color: colorNormal }} onChange={e => setColorBase(e.target.value)} /></li>
            <li>mypost: <input type="text" value={colorMypost} style={{ background: colorMypost, color: colorNormal }} onChange={e => setColorMypost(e.target.value)} /></li>
            <li>reply to me: <input type="text" value={colorReplytome} style={{ background: colorReplytome, color: colorNormal }} onChange={e => setColorReplytome(e.target.value)} /></li>
            <li>their post: <input type="text" value={colorThempost} style={{ background: colorThempost, color: colorNormal }} onChange={e => setColorThempost(e.target.value)} /></li>
            <li>their reply target: <input type="text" value={colorThemreplyto} style={{ background: colorThemreplyto, color: colorNormal }} onChange={e => setColorThemreplyto(e.target.value)} /></li>
            <li>link text: <input type="text" value={colorLinkText} style={{ background: colorBase, color: colorLinkText }} onChange={e => setColorLinkText(e.target.value)} /></li>
            <li>UI text: <input type="text" value={colorUiText} style={{ background: colorUiBg, color: colorUiText }} onChange={e => setColorUiText(e.target.value)} /></li>
            <li>UI bg: <input type="text" value={colorUiBg} style={{ background: colorUiBg, color: colorUiText }} onChange={e => setColorUiBg(e.target.value)} /></li>
            <li>selected text: <input type="text" value={colorSelectedText} style={{ background: colorSelectedBg, color: colorSelectedText }} onChange={e => setColorSelectedText(e.target.value)} /></li>
            <li>selected bg: <input type="text" value={colorSelectedBg} style={{ background: colorSelectedBg, color: colorSelectedText }} onChange={e => setColorSelectedBg(e.target.value)} /></li>
        </ul>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => {
                setPrefColorNormal(colorNormal);
                setPrefColorRepost(colorRepost);
                setPrefColorReacted(colorReacted);
                setPrefColorBase(colorBase);
                setPrefColorMypost(colorMypost);
                setPrefColorReplytome(colorReplytome);
                setPrefColorThempost(colorThempost);
                setPrefColorThemreplyto(colorThemreplyto);
                setPrefColorLinkText(colorLinkText);
                setPrefColorUiText(colorUiText);
                setPrefColorUiBg(colorUiBg);
                setPrefColorSelectedText(colorSelectedText);
                setPrefColorSelectedBg(colorSelectedBg);
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
                setColorLinkText(prefColorLinkText);
                setColorUiText(prefColorUiText);
                setColorUiBg(prefColorUiBg);
                setColorSelectedText(prefColorSelectedText);
                setColorSelectedBg(prefColorSelectedBg);
            }}>Reset</button>
        </p>
        <h2>Fonts:</h2>
        <ul>
            <li>text: <input type="text" value={fontText} style={{ font: fontText }} onChange={e => setFontText(e.target.value)} /></li>
            <li>ui: <input type="text" value={fontUi} style={{ font: fontUi }} onChange={e => setFontUi(e.target.value)} /></li>
        </ul>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => {
                setPrefFontText(fontText);
                setPrefFontUi(fontUi);
            }}>Save</button>
            <button onClick={() => {
                setFontText(prefFontText);
                setFontUi(prefFontUi);
            }}>Reset</button>
        </p>
    </div>;
};
