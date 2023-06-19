import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export const bsearchi = <T>(arr: T[], comp: (x: T) => boolean): number => {
    let left = 0;
    let right = arr.length;

    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (comp(arr[mid])) {
            right = mid;
        } else {
            left = mid + 1;
        }
    }

    return left;
};

export const getmk = <K, V>(map: Map<K, V>, key: K, make: () => V) => {
    const val = map.get(key);
    // don't support falsy value
    if (val) {
        return val;
    }

    const newval = make();
    map.set(key, newval);

    return newval;
};

export const rescue = <T>(fn: () => T, rescue: T | ((err: unknown) => T)) => {
    try {
        return fn();
    } catch (err) {
        if (typeof rescue === "function") {
            return (rescue as ((err: unknown) => T))(err); // ugh
        } else {
            return rescue;
        }
    }
};

export const binarystringToUint8array = (bs: string): Uint8Array => {
    const l = bs.length;
    const ab = new Uint8Array(l);
    for (let i = 0; i < l; i++) {
        ab[i] = bs.charCodeAt(i);
    }
    return ab;
};

const utf8encoder = new TextEncoder();
export const sha256str = (str: string) => bytesToHex(sha256(utf8encoder.encode(str)));

const timefmt0 = (v: number, t: string) => v.toString().padStart(t.length, "0");
export const timefmt = (date: Date, fmt: string) => {
    let str = "";
    const re = /Y+|M+|D+|h+|m+|s+|S+|[^YMDhmsS]+/g;
    while (true) {
        const grp = re.exec(fmt);
        if (!grp) return str;
        const token = grp[0];
        switch (token[0]) {
            case "Y": {
                str += timefmt0(date.getFullYear(), token);
                break;
            }
            case "M": {
                str += timefmt0(date.getMonth() + 1, token);
                break;
            }
            case "D": {
                str += timefmt0(date.getDate(), token);
                break;
            }
            case "h": {
                str += timefmt0(date.getHours(), token);
                break;
            }
            case "m": {
                str += timefmt0(date.getMinutes(), token);
                break;
            }
            case "s": {
                str += timefmt0(date.getSeconds(), token);
                break;
            }
            case "S": {
                str += Math.floor(date.getMilliseconds() / 1000 * (10 ** token.length));
                break;
            }
            default: {
                str += token;
                break;
            }
        }
    }
};

export const reltime = (bidelta: number) => {
    const delta = Math.abs(bidelta);
    return (bidelta < 0 ? "-" : "+") + (() => {
        if (delta < 1000) {
            return `${delta}ms`;
        } else if (delta < 10 * 1000) {
            return `${(delta / 1000).toFixed(2)}s`;
        } else if (delta < 60 * 1000) {
            return `${(delta / 1000).toFixed(1)}s`;
        } else if (delta < 60 * 60 * 1000) {
            return `${(delta / 60 / 1000).toFixed(1)}m`;
        } else if (delta < 24 * 60 * 60 * 1000) {
            return `${(delta / 60 / 60 / 1000).toFixed(1)}h`;
        } else {
            return `${(delta / 24 / 60 / 60 / 1000).toFixed(1)}d`;
        }
    })();
};

export const NeverMatch = /(?!)/;

// XXX: it should have true "event" multiplex
export class SimpleEmitter<T> {
    private listeners = new Set<(value: T) => void>();
    on(event: string, fn: (value: T) => void) { this.listeners.add(fn); }
    off(event: string, fn: (value: T) => void) { this.listeners.delete(fn); }
    emit(event: string, value: T) { this.listeners.forEach(fn => fn(value)); }
}
