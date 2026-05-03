import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5555,
        proxy: {
            "/api": "http://localhost:5556",
            "/ws": { target: "ws://localhost:5556", ws: true },
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./src/test-setup.ts"],
        // @lit/react ships a Node-only build (./node/) that strips
        // useLayoutEffect, so element properties (e.g. ef-button[disabled])
        // never get assigned and the rendered DOM diverges from a real
        // browser. Force the browser export so jsdom tests see the same
        // wrapper behaviour the real app does.
        server: { deps: { inline: ["@lit/react"] } },
        alias: {
            "@pierre/diffs/worker/worker-portable.js":
                "/src/test-stubs/pierre-worker-stub.ts",
        },
    },
    resolve: {
        // Order matters: "browser" must come before "node" so vitest picks
        // the development/browser export of @lit/react (with useLayoutEffect)
        // even though it's running in a Node host.
        conditions: ["browser", "development"],
    },
});
