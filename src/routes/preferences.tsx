import { produce } from "immer";
import { PrimitiveAtom, useAtom } from "jotai";
import { Event, EventTemplate, Kind, finishEvent, generatePrivateKey, getPublicKey, nip19, utils } from "nostr-tools";
import { FC, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import invariant from "tiny-invariant";
import TextInput from "../components/textinput";
import { NostrWorker, useNostrWorker } from "../nostrworker";
import state from "../state";
import { expectn, metadatajsoncontent, rescue, sha256str, shortstyle } from "../util";
import { MuxPub } from "../pool";

const MultiInput: FC<Omit<Parameters<typeof TextInput>[0], "value" | "onChange"> & {
    value: string | string[];
    onChange: (lines: string[]) => void;
}> =
    ({ value, onChange, ...props }) => <TextInput
        {...props}
        value={Array.isArray(value) ? value.join("\n") : value}
        onChange={text => onChange(text.split("\n"))}
    />;

const PubkeyText: FC<{ pk: string; }> = ({ pk }) => {
    const noswk = useNostrWorker();
    const [prof, setProf] = useState(() => noswk.getProfile(pk, Kind.Metadata, ev => setProf(ev)));

    const meta = prof && metadatajsoncontent(prof);
    const name = meta?.name || meta?.display_name;

    return <div style={{ display: "flex" }}>
        <div style={{ ...shortstyle, flex: 1 }}>{nip19.npubEncode(pk)}</div>
        {name && <div style={{ ...shortstyle, maxWidth: "15em" }}>{name}</div>}
    </div>;
};

function usePref<T, U = T>(pr: { atom: PrimitiveAtom<T>, load?: (v: T) => U, save?: (v: U) => T; }) {
    const load = pr.load || ((v: T): U => v as unknown as U);
    const save = pr.save || ((v: U): T => v as unknown as T);
    const [prefValue, setPrefValue] = useAtom(pr.atom);
    const [initialPrefValue] = useState(prefValue);
    const [value, setValue] = useState(() => load(prefValue));

    // support page direct access (useAtom lazily loads)
    // XXX: this is hacky.
    useEffect(() => {
        const f = pr.atom as unknown === state.preferences.account;
        (() => { const z = f; })();
        if (prefValue !== initialPrefValue) {
            setValue(load(prefValue));
        }
    }, [prefValue]);

    return {
        value: () => value,
        setValue: setValue,
        prefvalue: () => prefValue,
        reload: () => {
            const v = load(prefValue);
            setValue(v);
            return v;
        },
        save: () => {
            const pv = save(value);
            setPrefValue(pv);
            setValue(load(pv));
            return pv;
        }
    };
};

function rot<T>(value: T, list: T[]) {
    const i = list.indexOf(value);
    return list[0 <= i && i < list.length - 1 ? i + 1 : 0];
}

type RelayPosts = {
    event: Event;
    postAt: number;
    postByRelay: Map<string, null | { relay: string; recvAt: number; ok: boolean; reason: string; }>;
    pub: MuxPub;
};
const broadcast = (noswk: NostrWorker, event: Event, onRealize: (repo: RelayPosts) => void): RelayPosts => {
    const postAt = Date.now();
    const post = noswk.postEvent(event);

    const repo: RelayPosts = {
        event,
        postAt,
        postByRelay: new Map(post.relays.map(r => [utils.normalizeURL(r.relay.relay.url), null])),
        pub: post.pub,
    };
    post.pub.on("ok", recv => {
        const recvAt = Date.now();
        for (const r of recv) {
            repo.postByRelay.set(utils.normalizeURL(r.relay.url), { relay: r.relay.url, recvAt, ok: true, reason: r.reason });
        }
        onRealize(repo);
    });
    post.pub.on("failed", recv => {
        const recvAt = Date.now();
        repo.postByRelay.set(utils.normalizeURL(recv.relay), { relay: recv.relay, recvAt, ok: false, reason: String(recv.reason) });
        onRealize(repo);
    });
    // TODO: timeout? pub.on("forget", () => { });

    // repo.pub.forget() is callers responsibility.
    return repo;
};
const emitevent = async (noswk: NostrWorker, account: null | { pubkey: string; } | { privkey: string; }, tev: EventTemplate, onRealize: (repo: ReturnType<typeof broadcast>) => void) => {
    const event = await (async () => {
        if (account && "privkey" in account) {
            return finishEvent(tev, account.privkey);
        } else if (window.nostr?.signEvent) {
            const sev = await window.nostr.signEvent(tev);
            if (sev.pubkey !== account?.pubkey) {
                throw new Error(`NIP-07 set unexpected pubkey: pk=${sev.pubkey}, expected=${account?.pubkey}`);
            }
            return sev;
        } else {
            throw new Error("could not sign: no private key nor NIP-07 signEvent");
        }
    })();
    return broadcast(noswk, event, onRealize);
};

export default () => {
    const noswk = useNostrWorker();
    const [identiconStore] = useAtom(state.identiconStore);

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

    const relays = usePref<
        {
            url: string;
            read: boolean;
            write: boolean;
            scope: "public" | "local";
        }[],
        {
            url: string;
            read: boolean;
            write: boolean;
            scope: "public" | "local" | "remove";
        }[]
    >({
        atom: state.preferences.relays,
        save: v => v.filter((r): r is {
            url: string;
            read: boolean;
            write: boolean;
            scope: "public" | "local";
        } => r.scope !== "remove"),
    });
    const account = usePref({
        atom: state.preferences.account,
        load: s => {
            return {
                pk: normb32(s?.pubkey || "", "npub"),
                sk: normb32(s && "privkey" in s ? s.privkey : "", "nsec"),
            };
        },
        save: v => {
            return v.sk
                ? { pubkey: normhex(v.pk, "npub"), privkey: normhex(v.sk, "nsec") }
                : v.pk
                    ? { pubkey: normhex(v.pk, "npub") }
                    : null;
        },
    });
    const colorNormal = usePref({ atom: state.preferences.colors.normal });
    const colorRepost = usePref({ atom: state.preferences.colors.repost });
    const colorReacted = usePref({ atom: state.preferences.colors.reacted });
    const colorBase = usePref({ atom: state.preferences.colors.base });
    const colorSelectedText = usePref({ atom: state.preferences.colors.selectedtext });
    const colorSelectedBg = usePref({ atom: state.preferences.colors.selectedbg });
    const colorMypost = usePref({ atom: state.preferences.colors.mypost });
    const colorReplytome = usePref({ atom: state.preferences.colors.replytome });
    const colorThempost = usePref({ atom: state.preferences.colors.thempost });
    const colorThemreplyto = usePref({ atom: state.preferences.colors.themreplyto });
    const colorLinkText = usePref({ atom: state.preferences.colors.linktext });
    const colorUiText = usePref({ atom: state.preferences.colors.uitext });
    const colorUiBg = usePref({ atom: state.preferences.colors.uibg });
    const fontText = usePref({ atom: state.preferences.fonts.text });
    const fontUi = usePref({ atom: state.preferences.fonts.ui });
    const mutepks = usePref<
        { pk: string; scope: "public" | "private" | "local"; }[],
        { pk: string; scope: "public" | "private" | "local" | "remove"; }[]
    >({
        atom: state.preferences.mute.pubkeys,
        save: v => v.filter((m): m is { pk: string; scope: "public" | "private" | "local"; } => m.scope !== "remove"),
    });
    const muteregexs = usePref<
        { pattern: string; scope: "local"; }[],
        { pattern: string; scope: "local" | "remove"; }[]
    >({
        atom: state.preferences.mute.regexs,
        save: v => v.filter((m): m is { pattern: string; scope: "local"; } => m.scope !== "remove"),
    });

    const [url, setUrl] = useState([""]);
    const [nsecmask, setNsecmask] = useState(true);
    const [mutepk, setMutepk] = useState([""]);
    const [mutepat, setMutepat] = useState([""]);

    const navigate = useNavigate();

    const npubok = !!/^[0-9A-Fa-f]{64}$/.exec(normhex(account.value().pk, "npub")); // it really should <secp250k1.p but ignore for simplicity.
    const nsecvalid = !account.value().pk || (npubok && !!/^$|^[0-9A-Fa-f]{64}$/.exec(normhex(account.value().sk, "nsec"))); // it really should <secp250k1.n but ignore for simplicity.
    const nsecok = !!/^[0-9A-Fa-f]{64}$/.exec(normhex(account.value().sk, "nsec")); // it really should <secp250k1.n but ignore for simplicity.

    // FIXME: smells.
    useEffect(() => {
        if (relays.value().every(r => r.scope !== "public" || r.read || r.write)) return;
        relays.setValue(rs => rs.map(r => r.scope !== "public" || r.read || r.write ? r : { ...r, scope: "local" }));
    }, [relays.value()]);

    return <div style={{ height: "100%", overflowY: "auto" }}>
        <h1><div style={{ display: "inline-block" }}><Link to="/" onClick={e => navigate(-1)} style={{ color: "unset" }}>&lt;&lt;</Link>&nbsp;</div>Preferences</h1>
        <h2>Relays:</h2>
        <div style={{ marginLeft: "2em", display: "grid", gridTemplateColumns: "minmax(20em, max-content) max-content max-content", columnGap: "0.5em" }}>
            {(() => {
                const prefrelays = relays.prefvalue();
                return relays.value().map((rly, i) => <Fragment key={rly.url}>
                    <div style={{ display: "flex", gap: "0.5em" }}>
                        <div style={{
                            ...(rly.scope === "remove"
                                ? { textDecoration: "line-through" }
                                : rly.scope !== prefrelays[i]?.scope
                                    ? { fontStyle: "italic" }
                                    : {}
                            ),
                            flex: "1",
                            marginRight: "1em",
                            display: "flex"
                        }}>
                            <div style={{ alignSelf: "center", height: "1em" }}>{<img src={identiconStore.png(sha256str(rly.url))} style={{ height: "100%" }} />}</div>
                            <div>{rly.url}</div>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5em" }}>
                        <div><label style={{ fontStyle: rly.read !== prefrelays[i]?.read ? "italic" : undefined }}><input type="checkbox" checked={rly.read} onChange={e => relays.setValue(produce(draft => { draft[i].read = e.target.checked; }))} />read</label></div>
                        <div><label style={{ fontStyle: rly.write !== prefrelays[i]?.write ? "italic" : undefined }}><input type="checkbox" checked={rly.write} onChange={e => relays.setValue(produce(draft => { draft[i].write = e.target.checked; }))} />write</label></div>
                    </div>
                    <button onClick={e => { relays.setValue(produce(draft => { draft[i].scope = rot(draft[i].scope, ["public", "local", "remove"]); })); }}>{rly.scope}</button>
                </Fragment>);
            })()}
            <div style={{ gridColumn: "1/3", display: "flex" }}>
                <MultiInput placeholder="wss://..." value={url} onChange={lines => setUrl(lines)} style={{ flex: "1" }} />
            </div>
            <div>
                <button style={{ width: "100%" }} disabled={!url.every(url => /^wss?:\/\/.+/.exec(url))} onClick={e => {
                    relays.setValue(produce(draft => {
                        draft.push(...url
                            .map(url => utils.normalizeURL(url))
                            .filter(url => !draft.find(r => r.url === url))
                            .map(url => ({ url, read: true, write: true, scope: "public" as const })));
                    }));
                    setUrl([""]);
                }}>Add</button>
            </div>
        </div>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => { relays.save(); }}>Save</button>
            <button onClick={() => {
                const rs = relays.save();
                if (!account.prefvalue()?.pubkey) {
                    alert("account not ready");
                }
                if (noswk.getRelays().filter(r => r.write && r.healthy).length === 0) {
                    alert("no writable relays available");
                }
                // XXX: NIP-65 states "not for configuring one's client" but we temporarily use it for configuring...
                //      saving relays to kind3.content is not acceptable for me.
                // FIXME: use emitevent() for check publish status but it requires refactoring.
                emitevent(noswk, account.prefvalue(), {
                    kind: Kind.RelayList,
                    content: "",
                    tags: rs.filter(r => r.scope === "public" && (r.read || r.write)).map(r => ["r", r.url, ...(r.read && r.write ? [] : r.read ? ["read"] : ["write"])]),
                    created_at: Math.floor(Date.now() / 1000),
                }, repo => {
                    // TODO: some experience
                });
            }}>Save & Publish</button>
            <button onClick={() => { relays.reload(); }}>Reset</button>
            <button onClick={() => {
                window.nostr?.getRelays?.()?.then(rs => {
                    relays.setValue(produce(draft => {
                        for (const [unnurl, perms] of Object.entries(rs)) {
                            const url = utils.normalizeURL(unnurl);
                            const rent = draft.find(r => r.url === url);
                            if (rent) {
                                rent.read = perms.read;
                                rent.write = perms.write;
                            } else {
                                draft.push({ url: url, read: perms.read, write: perms.write, scope: "local" });
                            }
                        }
                    }));
                });
            }}>Load from extension</button>
        </p>
        <h2>Account:</h2>
        <ul>
            <li>pubkey:
                <div style={{ display: "inline-block", borderWidth: "1px", borderStyle: "solid", borderColor: npubok ? "#0f08" : "#f008" }}>
                    <input type="text" placeholder="npub1... or hex (auto-filled when correct privkey is set)" size={64} disabled={nsecok} value={account.value().pk} style={{ fontFamily: "monospace" }} onChange={e => {
                        const v = e.target.value;
                        const p = v.startsWith("nprofile1") ? rescue(() => {
                            const d = nip19.decode(v);
                            return d.type === "nprofile" ? d.data.pubkey : v;
                        }, v) : v;
                        account.setValue(s => ({ ...s, pk: normb32(p, "npub") }));
                    }} />
                </div>
            </li>
            <li>privkey:
                <div style={{ display: "inline-block", borderWidth: "1px", borderStyle: "solid", borderColor: nsecvalid ? "#0f08" : "#f008" }}>
                    <input type={nsecmask ? "password" : "text"} placeholder="nsec1... or hex (NIP-07 extension is very recommended)" size={64} value={account.value().sk} style={{ fontFamily: "monospace" }} onChange={e => {
                        const v = e.target.value;
                        account.setValue(s => ({ ...s, sk: normb32(v, "nsec") }));
                        const hs = normhex(v, "nsec");
                        if (/^[0-9A-Fa-f]{64}$/.exec(hs)) {
                            account.setValue(s => ({ ...s, pk: nip19.npubEncode(getPublicKey(hs)) }));
                        }
                    }} onFocus={e => setNsecmask(false)} onBlur={e => setNsecmask(true)} />
                </div>
            </li>
        </ul>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button disabled={!((account.value().pk === "" && account.value().sk === "") || (npubok && nsecvalid))} onClick={e => {
                account.save();
            }}>Set</button>
            <button onClick={async e => {
                const pk = await rescue(() => window.nostr?.getPublicKey?.(), undefined);
                if (pk) {
                    account.setValue(s => ({ ...s, pk: normb32(pk, "npub") }));
                }
            }}>Login with extension</button>
            <button onClick={e => {
                const sk = generatePrivateKey();
                account.setValue({
                    sk: nip19.nsecEncode(sk),
                    pk: nip19.npubEncode(getPublicKey(sk)),
                });
            }}>Generate</button>
            <button onClick={e => {
                account.reload();
            }}>Reset</button>
        </p>
        <h2>Colors:</h2>
        <ul>
            <li>normal: <input type="text" value={colorNormal.value()} style={{ background: colorBase.value(), color: colorNormal.value() }} onChange={e => colorNormal.setValue(e.target.value)} /></li>
            <li>repost: <input type="text" value={colorRepost.value()} style={{ background: colorBase.value(), color: colorRepost.value() }} onChange={e => colorRepost.setValue(e.target.value)} /></li>
            <li>reacted: <input type="text" value={colorReacted.value()} style={{ background: colorBase.value(), color: colorReacted.value() }} onChange={e => colorReacted.setValue(e.target.value)} /></li>
            <li>base: <input type="text" value={colorBase.value()} style={{ background: colorBase.value(), color: colorNormal.value() }} onChange={e => colorBase.setValue(e.target.value)} /></li>
            <li>mypost: <input type="text" value={colorMypost.value()} style={{ background: colorMypost.value(), color: colorNormal.value() }} onChange={e => colorMypost.setValue(e.target.value)} /></li>
            <li>reply to me: <input type="text" value={colorReplytome.value()} style={{ background: colorReplytome.value(), color: colorNormal.value() }} onChange={e => colorReplytome.setValue(e.target.value)} /></li>
            <li>their post: <input type="text" value={colorThempost.value()} style={{ background: colorThempost.value(), color: colorNormal.value() }} onChange={e => colorThempost.setValue(e.target.value)} /></li>
            <li>their reply target: <input type="text" value={colorThemreplyto.value()} style={{ background: colorThemreplyto.value(), color: colorNormal.value() }} onChange={e => colorThemreplyto.setValue(e.target.value)} /></li>
            <li>link text: <input type="text" value={colorLinkText.value()} style={{ background: colorBase.value(), color: colorLinkText.value() }} onChange={e => colorLinkText.setValue(e.target.value)} /></li>
            <li>UI text: <input type="text" value={colorUiText.value()} style={{ background: colorUiBg.value(), color: colorUiText.value() }} onChange={e => colorUiText.setValue(e.target.value)} /></li>
            <li>UI bg: <input type="text" value={colorUiBg.value()} style={{ background: colorUiBg.value(), color: colorUiText.value() }} onChange={e => colorUiBg.setValue(e.target.value)} /></li>
            <li>selected text: <input type="text" value={colorSelectedText.value()} style={{ background: colorSelectedBg.value(), color: colorSelectedText.value() }} onChange={e => colorSelectedText.setValue(e.target.value)} /></li>
            <li>selected bg: <input type="text" value={colorSelectedBg.value()} style={{ background: colorSelectedBg.value(), color: colorSelectedText.value() }} onChange={e => colorSelectedBg.setValue(e.target.value)} /></li>
        </ul>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => {
                colorNormal.save();
                colorRepost.save();
                colorReacted.save();
                colorBase.save();
                colorMypost.save();
                colorReplytome.save();
                colorThempost.save();
                colorThemreplyto.save();
                colorLinkText.save();
                colorUiText.save();
                colorUiBg.save();
                colorSelectedText.save();
                colorSelectedBg.save();
            }}>Save</button>
            <button onClick={() => {
                colorNormal.reload();
                colorRepost.reload();
                colorReacted.reload();
                colorBase.reload();
                colorMypost.reload();
                colorReplytome.reload();
                colorThempost.reload();
                colorThemreplyto.reload();
                colorLinkText.reload();
                colorUiText.reload();
                colorUiBg.reload();
                colorSelectedText.reload();
                colorSelectedBg.reload();
            }}>Reset</button>
        </p>
        <h2>Fonts:</h2>
        <ul>
            <li>text: <input type="text" value={fontText.value()} style={{ font: fontText.value() }} onChange={e => fontText.setValue(e.target.value)} /></li>
            <li>ui: <input type="text" value={fontUi.value()} style={{ font: fontUi.value() }} onChange={e => fontUi.setValue(e.target.value)} /></li>
        </ul>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => {
                fontText.save();
                fontUi.save();
            }}>Save</button>
            <button onClick={() => {
                fontText.reload();
                fontUi.reload();
            }}>Reset</button>
        </p>
        <h2>Block/Mute:</h2>
        <p>users:</p>
        <div style={{ marginLeft: "2em", display: "grid", gridTemplateColumns: "minmax(0,1fr) max-content", columnGap: "0.5em" }}>
            {(() => {
                const prefval = mutepks.prefvalue();
                return mutepks.value().map((m, i) => <Fragment key={m.pk}>
                    <div style={{ ...(m.scope === "remove" ? { textDecoration: "line-through" } : m.scope !== prefval[i]?.scope ? { fontStyle: "italic" } : {}) }}>
                        <PubkeyText pk={m.pk} />
                    </div>
                    <div style={{ marginLeft: "1em", display: "flex" }}>
                        <button style={{ flex: 1 }} onClick={e => mutepks.setValue(produce(draft => {
                            const r = draft.find(r => r.pk === m.pk);
                            if (r) r.scope = ({ public: "private", private: "local", local: "remove", remove: "public" } as const)[m.scope];
                        }))}>{m.scope}</button>
                    </div>
                </Fragment>);
            })()}
            <div>
                <MultiInput value={mutepk} placeholder="npub or hex..." style={{ fontFamily: "monospace" }} size={64} onChange={s => {
                    setMutepk(s.map(s => normb32(s, "npub")));
                }} />
            </div>
            <div style={{ marginLeft: "1em" }}>
                <button style={{ width: "100%" }} disabled={mutepk.some(p => !expectn(p, "npub"))} onClick={e => mutepks.setValue(produce(draft => {
                    const pks = mutepk.map(p => expectn(p, "npub")?.data).filter((p): p is string => !!p && !draft.find(r => r.pk === p));
                    if (pks.length === 0) {
                        return;
                    }
                    draft.push(...pks.map(pk => ({ pk, scope: "private", added: true } as const)));
                    setMutepk([""]);
                }))}>Add</button>
            </div>
        </div>
        <p>text pattern:</p>
        <div style={{ marginLeft: "2em", display: "grid", gridTemplateColumns: "max-content max-content", columnGap: "0.5em" }}>
            {(() => {
                const prefval = muteregexs.prefvalue();
                return muteregexs.value().map((m, i) => <Fragment key={i}>
                    <div style={{ flex: 1, display: "flex" }}>
                        <input
                            type="text"
                            value={m.pattern}
                            style={{
                                ...(m.scope === "remove"
                                    ? { textDecoration: "line-through" }
                                    : m.pattern !== prefval[i]?.pattern
                                        ? { fontStyle: "italic" }
                                        : {}),
                                fontFamily: "monospace",
                                flex: 1,
                            }}
                            onChange={e => {
                                const value = e.target.value;
                                muteregexs.setValue(produce(draft => { draft[i].pattern = value; }));
                            }}
                        />
                    </div>
                    <div style={{ display: "flex" }}>
                        <button style={{ flex: 1 }} onClick={e => muteregexs.setValue(produce(draft => {
                            draft[i].scope = rot(draft[i].scope, ["local", "remove"]);
                        }))}>{m.scope}</button>
                    </div>
                </Fragment>);
            })()}
            <div>
                <MultiInput value={mutepat} placeholder="regex..." style={{ fontFamily: "monospace" }} size={50} onChange={s => setMutepat(s)} />
            </div>
            <div>
                <button style={{ width: "100%" }} disabled={mutepat.some(s => s === "")} onClick={e => muteregexs.setValue(produce(draft => {
                    const rs = mutepat.filter(mp => !draft.find(r => r.pattern === mp));
                    if (rs.length === 0) {
                        return;
                    }
                    draft.push(...rs.map(r => ({ pattern: r, scope: "local" as const })));
                    setMutepat([""]);
                }))}>Add</button>
            </div>
        </div>
        <p style={{ display: "flex", gap: "0.5em" }}>
            <button onClick={() => {
                mutepks.save();
                muteregexs.save();
                // TODO: publish?
                // TODO: notify UI?
            }}>Save</button>
            <button onClick={() => {
                mutepks.reload();
                muteregexs.reload();
            }}>Reset</button>
        </p>
    </div >;
};
