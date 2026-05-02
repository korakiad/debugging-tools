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
        alias: {
            "@pierre/diffs/worker/worker-portable.js":
                "/src/test-stubs/pierre-worker-stub.ts",
        },
        // refinitiv-ui elements (ef-dialog, ef-icon, etc.) load i18n and SVG
        // sprite assets at mount time. jsdom has no real fetch pipeline for
        // those assets, so the loaders surface as async unhandled errors well
        // after assertions run. They're environmental noise, not test failures.
        dangerouslyIgnoreUnhandledErrors: true,
    },
});
