import { produce } from "immer";
import { useAtom } from "jotai";
import { Kind, Relay, nip19 } from "nostr-tools";
import { Dispatch, FC, Fragment, SetStateAction, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import TabText from "../components/tabtext";
import TextInput from "../components/textinput";
import { useNostrWorker } from "../nostrworker";
import state from "../state";
import { DeletableEvent } from "../types";
import { emitevent, metadatajsoncontent } from "../util/nostr";
import { rescue, timefmt } from "../util/pure";
import { shortstyle } from "../util/react";

const ProfLine: FC<{
    curprof: Record<string, string> | null;
    editprof: Record<string, string | undefined> | null;
    field: string | string[];
    disabled?: boolean;
    setvalue?: Dispatch<SetStateAction<Record<string, string | undefined>>>;
    onChange?: (value: string | undefined | null) => void;
}> = ({ curprof, editprof, field, disabled, setvalue, onChange }) => {
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [colorbase] = useAtom(state.preferences.colors.base);

    const fields = Array.isArray(field) ? field : [field];
    const owneditfield = editprof && fields.find(f => Object.hasOwn(editprof, f));
    const curvalue = (() => {
        if (!curprof) return undefined;
        for (const f of fields) {
            if (Object.hasOwn(curprof, f)) {
                return curprof[f];
            }
        }
        return undefined;
    })();
    const editvalue = (() => {
        if (owneditfield) return editprof[owneditfield];
        return curvalue;
    })();

    const set = (value: string | undefined | null) => {
        setvalue && setvalue(produce(draft => {
            if (value !== null) draft[fields[0]] = value;
            else delete draft[fields[0]];
        }));
        onChange && onChange(value);
    };

    return <>
        <input
            value={editvalue || ""}
            placeholder={editvalue === undefined ? "undefined" : ""}
            onChange={e => set(e.target.value)}
            style={{ flex: 1, background: colorbase, color: colornormal }}
            disabled={disabled}
        />
        <button disabled={disabled || editvalue === undefined} style={{ marginLeft: "0.5em" }} onClick={e => set(undefined)} title="undefine">×</button>
        <button disabled={disabled || editvalue === curvalue} style={{ marginLeft: "0.5em" }} onClick={e => set(null)} title="revert">⎌</button>
    </>;
};

const Profile: FC<{}> = () => {
    const noswk = useNostrWorker();
    const [identiconStore] = useAtom(state.identiconStore);
    const [account] = useAtom(state.preferences.account);
    const [colornormal] = useAtom(state.preferences.colors.normal);
    const [colorbase] = useAtom(state.preferences.colors.base);
    const [fonttext] = useAtom(state.preferences.fonts.text);
    const navigate = useNavigate();

    // const profev = useEventSnapshot(
    //     useCallback(onStoreChange => {
    //         const pk = account?.pubkey;
    //         if (!pk) return () => { };
    //         noswk.getProfile(pk, Kind.Metadata, onStoreChange, undefined, 60 * 1000);
    //         return () => { };
    //     }, [noswk, account]),
    //     useCallback(() => {
    //         const pk = account?.pubkey;
    //         if (!pk) return null;

    //         return noswk.tryGetProfile(pk, Kind.Metadata)?.event;
    //     }, [noswk, account]),
    // );
    // XXX: smells.
    const [profev, setProfev] = useState<DeletableEvent | null>(() => {
        const pk = account?.pubkey;
        if (!pk) return null;
        else return noswk.getProfile(pk, Kind.Metadata, ev => setProfev(ev), undefined, 60 * 1000);
    });
    useEffect(() => {
        const handler = (ev: DeletableEvent) => {
            setProfev(ev);
        };
        noswk.onMyMetadata.on("", handler);
        return () => noswk.onMyMetadata.off("", handler);
    }, [noswk, account?.pubkey]);
    const curprof = profev && rescue(() => metadatajsoncontent(profev), null);

    const [editprof, setEditprof] = useState<Record<string, string | undefined>>({});
    const [extrakey, setExtrakey] = useState("");
    const [extravalue, setExtravalue] = useState("");

    return <div style={{ display: "flex", flexDirection: "column" }}>
        <h1>
            <div style={{ display: "inline-block" }}>
                <Link to="/" onClick={e => navigate(-1)} style={{ color: "unset" }}>
                    &lt;&lt;
                </Link>
                &nbsp;
            </div>
            Profile
        </h1>
        {!account?.pubkey
            ? <p style={{ marginLeft: "2em" }}>You are in anonymous, thus no profile. <Link to="/preferences" style={{ color: colornormal }}>Claim your identity?</Link></p>
            : <div style={{ marginLeft: "1em" }}>
                <div style={{
                    display: "grid",
                    padding: "5px",
                    // minWidth: "10em",
                    // maxWidth: "40em",
                    // color: colornormal,
                    // font: fonttext,
                    gridTemplateColumns: "max-content minmax(0, 1fr)",
                    columnGap: "0.5em",
                }}>
                    <div style={{ textAlign: "right" }}>
                        <img src={identiconStore.png(account.pubkey)} style={{ height: "3lh", border: "1px solid", borderColor: colornormal }} />
                    </div>
                    <div>
                        <TabText style={shortstyle}>{nip19.npubEncode(account.pubkey)}</TabText>
                        <TabText style={shortstyle}>{(() => {
                            const metaev = profev?.event;
                            const relay: Relay | undefined = metaev && metaev.receivedfrom.keys().next().value;
                            // should we use kind0's receivedfrom or kind10002? but using kind1's receivedfrom that is _real_/_in use_
                            return nip19.nprofileEncode({ pubkey: account.pubkey, relays: relay && [relay.url] });
                        })()}</TabText>
                        <TabText style={shortstyle}>{account.pubkey}</TabText>
                    </div>
                    <div style={{ textAlign: "right" }}>name:</div>
                    {/* TODO: NIP-30 */}
                    <div style={{ display: "flex" }}><ProfLine curprof={curprof} editprof={editprof} field="name" setvalue={setEditprof} /></div>
                    <div style={{ textAlign: "right" }}>display_name:</div>
                    <div style={{ display: "flex" }}><ProfLine curprof={curprof} editprof={editprof} field="display_name" setvalue={setEditprof} /></div>
                    <div style={{ textAlign: "right" }}>picture:</div>
                    {/* TODO: img */}
                    <div style={{ display: "flex" }}><ProfLine curprof={curprof} editprof={editprof} field="picture" setvalue={setEditprof} /></div>
                    <div style={{ textAlign: "right" }}>banner:</div>
                    {/* TODO: img */}
                    <div style={{ display: "flex" }}><ProfLine curprof={curprof} editprof={editprof} field="banner" setvalue={setEditprof} /></div>
                    <div style={{ textAlign: "right" }}>website:</div>
                    <div style={{ display: "flex" }}><ProfLine curprof={curprof} editprof={editprof} field="website" setvalue={setEditprof} /></div>
                    <div style={{ textAlign: "right" }}>nip05:</div>
                    {/* TODO: NIP-05 verification */}
                    <div style={{ display: "flex" }}><ProfLine curprof={curprof} editprof={editprof} field="nip05" setvalue={setEditprof} /></div>
                    <div style={{ textAlign: "right" }}>lud{(() => {
                        const v = editprof.lud16 || editprof.lud06 || curprof?.lud16 || curprof?.lud06 || "";
                        if (v.startsWith("LNURL1")) return "06";
                        if (v.includes("@")) return "16";
                        return "16/06";
                    })()}:</div>
                    <div style={{ display: "flex" }}>
                        <ProfLine
                            curprof={curprof}
                            editprof={editprof}
                            field={["lud16", "lud06"]}
                            onChange={value => {
                                if (value === null) {
                                    setEditprof(produce(draft => {
                                        delete draft.lud16;
                                        delete draft.lud06;
                                    }));
                                    return;
                                }
                                if (value === undefined) {
                                    setEditprof(produce(draft => {
                                        draft.lud16 = undefined;
                                        draft.lud06 = undefined;
                                    }));
                                    return;
                                }
                                if (value?.startsWith("LNURL1")) {
                                    setEditprof(produce(draft => {
                                        draft.lud16 = undefined;
                                        draft.lud06 = value;
                                    }));
                                } else {
                                    setEditprof(produce(draft => {
                                        draft.lud16 = value;
                                        draft.lud06 = undefined;
                                    }));
                                }
                            }}
                        />
                    </div>
                    <div style={{ textAlign: "right" }}>about:</div>
                    {/* TODO: NIP-30 */}
                    <div style={{ display: "flex" }}>
                        <TextInput
                            value={(Object.hasOwn(editprof, "about") ? editprof.about : curprof?.about) || ""}
                            placeholder={(Object.hasOwn(editprof, "about") ? editprof.about : curprof?.about) === undefined ? "undefined" : ""}
                            onChange={str => setEditprof(produce(draft => { draft.about = str; }))}
                            style={{ flex: 1, background: colorbase, color: colornormal }}
                        />
                        <button disabled={(Object.hasOwn(editprof, "about") ? editprof.about : curprof?.about) === undefined} style={{ marginLeft: "0.5em" }} onClick={e => setEditprof(produce(draft => { draft.about = undefined; }))} title="undefine">×</button>
                        <button disabled={!Object.hasOwn(editprof, "about") || editprof.about === curprof?.about} style={{ marginLeft: "0.5em" }} onClick={e => setEditprof(produce(draft => { delete draft.about; }))} title="revert">⎌</button>
                    </div>
                    {/* TODO: extra fields add/edit/remove */}
                    {/* <div style={{ textAlign: "right" }}>json:</div>
                <TabText style={{ ...shortstyle, maxWidth: "20em" }} onCopy={e => { setProfpopping(""), listref.current?.focus(); }}>{!profprof.metadata ? "?" : JSON.stringify(profprof.metadata.event?.event)}</TabText> */}
                    {(() => {
                        const newLocal = {
                            // base guard
                            name: "",
                            display_name: "",
                            picture: "",
                            banner: "",
                            website: "",
                            nip05: "",
                            lud06: "",
                            lud16: "",
                            about: "",
                            // then values
                            ...(curprof || {}),
                            ...editprof
                        };
                        const kv = Object.entries(newLocal)
                            .filter(([k, v]) => !["name", "display_name", "picture", "banner", "website", "nip05", "lud06", "lud16", "about"].includes(k));
                        kv.push(["", ""]);
                        const badnew = extrakey === "" || Object.hasOwn(newLocal, extrakey);
                        // XXX: we relying Object.entries order is stable...
                        return kv.map(([k, v], i) => <Fragment key={i}>
                            <div style={{ textAlign: "right" }}>
                                {k === ""
                                    ? <div style={{ border: `1px solid ${badnew ? "red" : "transparent"}` }}>
                                        <input
                                            value={extrakey}
                                            onChange={e => setExtrakey(e.target.value)}
                                            style={{
                                                background: colorbase,
                                                color: colornormal,
                                            }}
                                        />
                                    </div>
                                    : `${k}:`}
                            </div>
                            <div style={{ display: "flex" }}>
                                {/* we add this in the loop that we want to stable ProfLine for new and just added */}
                                <ProfLine curprof={curprof} editprof={editprof} field={k} disabled={k === "" && badnew} onChange={value => {
                                    const kk = k || extrakey;
                                    if (!kk) return;
                                    // reverting new values to "undefined" to not shift UI
                                    const v = value === null && (curprof as Record<string, string> | null)?.[kk] === undefined ? undefined : value;
                                    setEditprof(produce(draft => {
                                        if (v === null && (curprof as Record<string, string> | null)?.[kk] !== undefined) {
                                            delete draft[kk];
                                        } else {
                                            draft[kk] = v === null ? undefined : v;
                                        }
                                    }));
                                    if (k === "") {
                                        setExtrakey("");
                                        setExtravalue("");
                                    }
                                }} />
                            </div>
                        </Fragment>);
                    })()}
                    <div style={{ textAlign: "right" }}>rewritten at:</div>
                    <div style={shortstyle}>{!profev ? "?" : timefmt(new Date(profev.event!.event.created_at * 1000), "YYYY-MM-DD hh:mm:ss")}</div>
                </div>
                <div>
                    <button onClick={e => {
                        emitevent(noswk, account, {
                            kind: Kind.Metadata,
                            content: JSON.stringify({ ...(curprof || {}), ...editprof }),
                            tags: profev?.event?.event?.tags || [],
                            created_at: Math.floor(Date.now() / 1000),
                        }, repo => {
                            // TODO: some experience
                        }).then(posts => setEditprof({}));
                    }}>Publish</button>
                    <button style={{ marginLeft: "1em" }} onClick={e => setEditprof({})}>Reload</button>
                </div>
            </div>}
    </div>;
};

export default Profile;
