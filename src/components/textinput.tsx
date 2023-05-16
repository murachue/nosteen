import { FC } from "react";

const TextInput: FC<Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & {
    size?: number;
    onChange: (s: string) => void;
}> = ({ size, onChange, ...props }) => {
    const m = String(props.value ?? "").match(/\n/g);
    return <textarea
        {...props}
        cols={size}
        rows={(m?.length || 0) + 1}
        onChange={e => onChange(e.target.value)}
    />;
};

export default TextInput;
