#!/usr/bin/env node
import { main } from "../server/dist/index.js";

// In v3 (Node IPC) the launcher boots Mocha programmatically inside
// runtime/mocha-ipc-launcher.cjs, so the legacy "wrap a custom mocha CLI"
// extra-args feature is gone. Anything after the bin name is reported and
// ignored — surfaced (rather than silently dropped) to flag stale wrappers.
const extraArgs = process.argv.slice(2);
if (extraArgs.length > 0) {
    console.warn(
        `[debug-gui] ignoring extra args ${JSON.stringify(extraArgs)} — ` +
        `custom mocha command is no longer supported (v3 IPC launcher).`,
    );
}

const port = process.env.PORT ? Number(process.env.PORT) : 5555;
main(process.cwd(), port).catch((e) => {
    console.error(e);
    process.exit(1);
});
