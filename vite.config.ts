import { execSync } from "node:child_process";
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default () => {
    // https://stackoverflow.com/a/71162041
    // we can use define.xxx but it's typescript unfriendly.
    process.env.VITE_APP_GITHASH = execSync("git describe --always --dirty").toString().trimEnd();
    process.env.VITE_APP_COMMITDATE = execSync("git log -n1 --format=%ci").toString().trimEnd();
    return defineConfig({
        plugins: [react()],
    });
};
