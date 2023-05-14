import { CSSProperties, FC, useEffect, useMemo, useRef, useState } from "react";

// XXX: lose undo on transform...
export const TextInput: FC<{
    value: string;
    size?: number;
    wrap?: HTMLTextAreaElement["wrap"];
    placeholder?: string;
    style?: CSSProperties;
    onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement | HTMLInputElement>;
    onChange: (s: string) => void;
}> = ({ value, size, wrap, placeholder, style, onKeyDown, onChange }) => {
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
            wrap={wrap}
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
