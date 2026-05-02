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
        // The unhandled-rejection-filter setupFile narrowly silences the
        // refinitiv-ui i18n / SVG sprite loader noise that surfaces async
        // after a test mounts an ef-* element. Any other unhandled
        // rejection still throws and fails the run, so genuine product
        // bugs in async paths cannot hide.
        setupFiles: [
            "./src/test-setup.ts",
            "./src/test-stubs/unhandled-rejection-filter.ts",
        ],
        alias: {
            "@pierre/diffs/worker/worker-portable.js":
                "/src/test-stubs/pierre-worker-stub.ts",
        },
    },
});
