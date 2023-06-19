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

export const NeverMatch = /(?!)/;

// XXX: it should have true "event" multiplex
export class SimpleEmitter<T> {
    private listeners = new Set<(value: T) => void>();
    on(event: string, fn: (value: T) => void) { this.listeners.add(fn); }
    off(event: string, fn: (value: T) => void) { this.listeners.delete(fn); }
    emit(event: string, value: T) { this.listeners.forEach(fn => fn(value)); }
}
