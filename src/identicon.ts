import Identicon from "identicon.js";
import { binarystringToUint8array } from "./util";

export class IdenticonStore {
    private cache = new Map<string, string>();
    constructor() { }
    png(hash: string) {
        const c = this.cache.get(hash);
        if (c) return c;

        const dumpbs = (new Identicon(
            hash,
            {
                background: [0, 0, 0, 0]
            }
        ).toString as (raw: boolean) => string)(true);  // @types/identicon.js@2.3.1 lacks "raw" type
        // convert to binarystring => Uint8Array... identicon.js should do this.
        const dumpab = binarystringToUint8array(dumpbs);
        const url = URL.createObjectURL(new Blob([dumpab], { type: "image/png" }));
        this.cache.set(hash, url);
        return url;
    }
}
