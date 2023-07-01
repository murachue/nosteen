import { FC, PropsWithChildren, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

// references:
// https://github.com/codler/react-ga4/blob/d50684824f5d155c772721d93ff2be7ea65767bf/src/ga4.js
//   react-ga4 looks like "easy migrate from react-ga" that is not native for GA4
//   load-by-code
// https://note.com/dd_techblog/n/n29535fd4f557
//   self-implementation, load-by-code, describes easier, react-router-dom<6
// https://zenn.dev/mamezou/articles/4d0d7b79b639d5
//   self-implementation, load-by-html
// https://qiita.com/mildsummer/items/184315e6f9a6d298113e
//   also self-implementation, react-router-dom<6

declare global {
    interface Window {
        dataLayer?: unknown[];
    }
}

// use me inner the Router (or useLocation fails)
const GA: FC<PropsWithChildren<{
    gtagUrl?: string;
    measurementId?: string;
    nonce?: string;
}>> = ({ gtagUrl = "https://www.googletagmanager.com/gtag/js", measurementId, nonce, children }) => {
    const location = useLocation();

    useEffect(() => {
        if (!window || !document) return; // no SSR...
        // @ts-ignore 2774
        if (window.gtag) return;

        const sel = document.createElement("script");
        sel.async = true;
        sel.nonce = nonce;
        sel.src = `${gtagUrl}${measurementId ? `?id=${measurementId}` : ""}`;
        document.body.appendChild(sel);

        window.dataLayer ||= [];
        window.gtag = function gtag() { window.dataLayer!.push(arguments); };

        gtag("js", new Date());
    }, []);
    useEffect(() => {
        if (!measurementId) return;

        gtag("config", measurementId);
    }, [measurementId]);
    useEffect(() => {
        const page_location = (() => {
            const href = window.location.href;

            // hacky privacy
            {
                const m = href.match(/(.+#\/tab)\/(e|p|a|thread|t)\/[^/]+$/);
                if (m) {
                    return `${m[1]}/*addr*`;
                }
            }
            {
                const m = href.match(/(.+#\/tab)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
                if (m) {
                    return `${m[1]}/*custom*`;
                }
            }

            return href;
        })();
        gtag?.("event", "page_view", { page_location });
    }, [location]);

    return children;
};

export default GA;
