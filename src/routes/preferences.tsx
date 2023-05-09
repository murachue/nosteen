import { produce } from "immer";
import { useAtom } from "jotai";
import { generatePrivateKey, getPublicKey, nip19 } from "nostr-tools";
import { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import invariant from "tiny-invariant";
import { useNostrWorker } from "../nostrworker";
import state from "../state";
import { expectn, rescue } from "../util";

// XXX: lose undo on transform...
const TextInput: FC<{ value: string; size?: number; placeholder?: string; style?: CSSProperties; onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement | HTMLInputElement>; onChange: (s: string) => void; }> = ({ value, size, placeholder, style, onKeyDown, onChange }) => {
    const [focus, setFocus] = useState(false);
    const reft = useRef<HTMLTextAreaElement>(null);
    const refi = useRef<HTMLInputElement>(null);
    const m = useMemo(() => value.match(/\n/g), [value]);
    useEffect(() => {
        if (focus) {
            (m ? reft : refi).current?.focus();
        }
    }, [focus, m]);
    return m
        ? <textarea
            ref={reft}
            value={value}
            style={style}
            cols={size}
            rows={m.length + 1}
            onKeyDown={onKeyDown}
            onChange={e => onChange(e.target.value)}
            onFocus={e => setFocus(f => true)}
            onBlur={e => setFocus(f => false)}
        />
        : <input
            ref={refi}
            type="text"
            placeholder={placeholder}
            value={value}
            style={style}
            size={size}
            onKeyDown={onKeyDown}
            onChange={e => onChange(e.target.value)}
            onPaste={e => {
                const clip = e.clipboardData.getData("text/plain");
                if (clip.match(/\n/)) {
                    const el = refi.current!;
                    const v = el.value;
                    onChange(v.slice(0, el.selectionStart ?? v.length) + clip + v.slice(el.selectionEnd ?? v.length));
                    e.preventDefault();
                }
            }}
            onFocus={e => setFocus(f => true)}
            onBlur={e => setFocus(f => false)}
        />;
};

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
    const [prefMuteUserpublic, setPrefMuteUserpublic] = useAtom(state.preferences.mute.userpublic);
    const [prefMuteUserprivate, setPrefMuteUserprivate] = useAtom(state.preferences.mute.userprivate);
    const [prefMuteUserlocal, setPrefMuteUserlocal] = useAtom(state.preferences.mute.userlocal);
    const [prefMuteRegexlocal, setPrefMuteRegexlocal] = useAtom(state.preferences.mute.regexlocal);

    const normhex = (s: string, tag: "npub" | "nsec") => {
        if (!s.startsWith(tag)) {
            // fastpath
            return s;
        }
        return rescue(() => {
            const id = nip19.decode(s);
            return id && id.type === tag ? id.data : s;
        }, s);
    };
    const normb32 = (s: string, tag: "npub" | "nsec") => {
        if (!/^[0-9A-Fa-f]{64}$/.exec(s)) {
            return s;
        }
        return tag === "npub" ? nip19.npubEncode(s) : nip19.nsecEncode(s);
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
    const [muteUsers, setMuteUsers] = useState<{ pk: string; scope: "public" | "private" | "local" | "remove"; added: boolean; }[]>([
        ...(prefMuteUserpublic.map(u => ({ pk: nip19.npubEncode(u), scope: "public" as const, added: false }))),
        ...(prefMuteUserprivate.map(u => ({ pk: nip19.npubEncode(u), scope: "private" as const, added: false }))),
        ...(prefMuteUserlocal.map(u => ({ pk: nip19.npubEncode(u), scope: "local" as const, added: false }))),
    ]);
    const [muteRegexlocal, setMuteRegexlocal] = useState(prefMuteRegexlocal.map(pattern => ({ pattern, added: false, removed: false })));

    const [url, setUrl] = useState("");
    const [npub, setNpub] = useState(normb32(prefaccount?.pubkey || "", "npub"));
    const [nsec, setNsec] = useState(normb32(prefaccount && "privkey" in prefaccount ? prefaccount.privkey : "", "nsec"));
    const [nsecmask, setNsecmask] = useState(true);
    const [mutepk, setMutepk] = useState("");
    const [mutepat, setMutepat] = useState("");

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
        <div style={{ marginLeft: "2em", display: "grid", gridTemplateColumns: "max-content max-content", columnGap: "0.5em" }}>
            {relays.map((rly, i) => <>
                <div key={`l:${rly.url}`} style={{ display: "flex", gap: "0.5em" }}>
                    <div style={{ ...(rly.removed ? { textDecoration: "line-through" } : rly.added ? { fontStyle: "italic" } : {}), flex: "1", marginRight: "1em" }}>{rly.url}</div>
                    <div><label><input type="checkbox" checked={rly.read} onChange={e => setRelays(produce(draft => { draft[i].read = e.target.checked; }))} />read</label></div>
                    <div><label><input type="checkbox" checked={rly.write} onChange={e => setRelays(produce(draft => { draft[i].write = e.target.checked; }))} />write</label></div>
                    <div><label><input type="checkbox" checked={rly.public} onChange={e => setRelays(produce(draft => { draft[i].public = e.target.checked; }))} />publish?</label></div>
                </div>
                <button key={`b:${rly.url}`} onClick={e => {
                    setRelays(produce(draft => {
                        const r = draft.find(r => r.url === rly.url);
                        invariant(r, "inconsistent relays");
                        r.removed = !r.removed;
                    }));
                }}>{rly.removed ? "Undo" : "Remove"}</button>
            </>)}
            <div style={{ display: "flex" }}><input type="text" placeholder="wss://..." /* pattern="^wss?://.+" */ value={url} onChange={e => setUrl(e.target.value)} style={{ flex: "1" }} /></div>
            <div>
                <button style={{ width: "100%" }} disabled={!/^wss?:\/\/.+/.exec(url)} onClick={e => {
                    setRelays(produce(draft => {
                        if (draft.find(r => r.url === url)) return;
                        draft.push({ url, read: true, write: true, public: true, added: true, removed: false });
                    }));
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
                        const p = s.startsWith("nprofile1") ? rescue(() => {
                            const d = nip19.decode(s);
                            return d.type === "nprofile" ? d.data.pubkey : s;
                        }, s) : s;
                        setNpub(normb32(p, "npub"));
                    }} />
                </div>
            </li>
            <li>privkey:
                <div style={{ display: "inline-block", borderWidth: "1px", borderStyle: "solid", borderColor: nsecvalid ? "#0f08" : "#f008" }}>
                    <input type={nsecmask ? "password" : "text"} placeholder="nsec1... or hex (NIP-07 extension is very recommended)" size={64} value={nsec} style={{ fontFamily: "monospace" }} onChange={e => {
                        const s = e.target.value;
                        setNsec(normb32(s, "nsec"));
                        const hs = normhex(s, "nsec");
                        if (/^[0-9A-Fa-f]{64}$/.exec(hs)) {
                            setNpub(nip19.npubEncode(getPublicKey(hs)));
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
                setNsec(nip19.nsecEncode(sk));
                setNpub(nip19.npubEncode(getPublicKey(sk)));
            }}>Generate</button>
            <button onClick={e => {
                setNpub(normb32(prefaccount?.pubkey || "", "npub"));
                setNsec(normb32(prefaccount && "privkey" in prefaccount ? prefaccount.privkey : "", "nsec"));
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
        <h2>Block/Mute:</h2>
        <p>users:</p>
        <div style={{ marginLeft: "2em", display: "grid", gridTemplateColumns: "max-content max-content", columnGap: "0.5em" }}>
            {muteUsers.map(m => <>
                <div key={`p:${m.pk}`} style={{ ...(m.scope === "remove" ? { textDecoration: "line-through" } : m.added ? { fontStyle: "italic" } : {}) }}>{m.pk}</div>
                <div key={`b:${m.pk}`} style={{ marginLeft: "1em", display: "flex" }}>
                    <button style={{ flex: 1 }} onClick={e => setMuteUsers(produce(draft => {
                        const r = draft.find(r => r.pk === m.pk);
                        if (r) r.scope = ({ public: "private", private: "local", local: "remove", remove: "public" } as const)[m.scope];
                    }))}>{m.scope}</button>
                </div>
            </>)}
            <div>
                <TextInput value={mutepk} placeholder="npub or hex..." style={{ fontFamily: "monospace" }} size={64} onChange={s => {
                    setMutepk(s.split("\n").map(s => normb32(s, "npub")).join("\n"));
                }} />
            </div>
            <div style={{ marginLeft: "1em", display: "flex" }}>
                <button style={{ flex: 1 }} disabled={mutepk.split("\n").some(p => !expectn(p, "npub"))} onClick={e => setMuteUsers(produce(draft => {
                    const pks = mutepk.split("\n").filter(p => !draft.find(r => r.pk === p));
                    if (pks.length === 0) {
                        return;
                    }
                    draft.push(...pks.map(pk => ({ pk, scope: "private", added: true } as const)));
                    setMutepk("");
                }))}>add</button>
            </div>
        </div>
        <p>text pattern:</p>
        <div style={{ marginLeft: "2em", display: "grid", gridTemplateColumns: "max-content max-content", columnGap: "0.5em" }}>
            {muteRegexlocal.map((m, i) => <>
                <div key={`p:${i}`}>
                    <input
                        type="text"
                        value={m.pattern}
                        style={{ ...(m.removed ? { textDecoration: "line-through" } : m.added ? { fontStyle: "italic" } : {}), fontFamily: "monospace" }}
                        onChange={e => {
                            const value = e.target.value;
                            if (muteRegexlocal[i].pattern !== value) {
                                setMuteRegexlocal(produce(draft => { draft[i].pattern = value; }));
                            }
                        }}
                    />
                </div>
                <div key={`b:${i}`} style={{ marginLeft: "1em", display: "flex" }}>
                    <button style={{ flex: 1 }} onClick={e => setMuteRegexlocal(produce(draft => {
                        draft[i].removed = !draft[i].removed;
                    }))}>{m.removed ? "Undo" : "Remove"}</button>
                </div>
            </>)}
            <div>
                <TextInput value={mutepat} placeholder="regex..." style={{ fontFamily: "monospace" }} size={50} onChange={s => setMutepat(s)} />
            </div>
            <div style={{ marginLeft: "1em", display: "flex" }}>
                <button style={{ flex: 1 }} disabled={mutepat.split("\n").some(s => s === "")} onClick={e => setMuteRegexlocal(produce(draft => {
                    const rs = mutepat.split("\n").filter(mp => !draft.find(r => r.pattern === mp));
                    if (rs.length === 0) {
                        return;
                    }
                    draft.push(...rs.map(r => ({ pattern: r, added: true, removed: false } as const)));
                    setMutepat("");
                }))}>add</button>
            </div>
        </div>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => {
                setPrefMuteUserpublic(muteUsers.filter(u => u.scope === "public").map(u => nip19.decode(u.pk).data as string));
                setPrefMuteUserprivate(muteUsers.filter(u => u.scope === "private").map(u => nip19.decode(u.pk).data as string));
                setPrefMuteUserlocal(muteUsers.filter(u => u.scope === "local").map(u => nip19.decode(u.pk).data as string));
                setPrefMuteRegexlocal(muteRegexlocal.filter(r => !r.removed).map(r => r.pattern));

                setMuteUsers([
                    ...(muteUsers.filter(u => u.scope === "public").map(u => ({ ...u, added: false }))),
                    ...(muteUsers.filter(u => u.scope === "private").map(u => ({ ...u, added: false }))),
                    ...(muteUsers.filter(u => u.scope === "local").map(u => ({ ...u, added: false }))),
                ]);
                setMuteRegexlocal(muteRegexlocal.filter(r => !r.removed).map(r => ({ pattern: r.pattern, added: false, removed: false })));

                // TODO: publish
                // TODO: flush noswk streams
            }}>Save</button>
            <button onClick={() => {
                setMuteUsers([
                    ...(prefMuteUserpublic.map(pk => ({ pk: nip19.npubEncode(pk), scope: "public" as const, added: false }))),
                    ...(prefMuteUserprivate.map(pk => ({ pk: nip19.npubEncode(pk), scope: "private" as const, added: false }))),
                    ...(prefMuteUserlocal.map(pk => ({ pk: nip19.npubEncode(pk), scope: "local" as const, added: false }))),
                ]);
                setMuteRegexlocal(prefMuteRegexlocal.map(pattern => ({ pattern, added: false, removed: false })));
            }}>Reset</button>
        </p>
    </div>;
};
