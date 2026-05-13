import http from "http";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { loadConfig } from "./config.js";
import { discoverSuites } from "./discovery.js";
import { SessionManager } from "./session.js";
import { MochaRunner } from "./runner.js";
import { ChromeManager } from "./chromeManager.js";
import { createApp, WsHub } from "./server.js";
import { launchAppMode } from "./launcher.js";
import { ensureLspConfig } from "./lspInit.js";
import type { LspWarning } from "@debug-gui/protocol";
import { CopilotClient } from "@github/copilot-sdk";
import { GuiSession } from "./domain/GuiSession.js";
import { registerHttpRoutes } from "./routes/http.js";
import { attachWsServer } from "./routes/ws.js";
import { registerCommandHandlers } from "./commands/dispatcher.js";

export const VERSION = "0.0.1";

export async function main(
    cwd: string = process.cwd(),
    port: number = 5555,
): Promise<void> {
    const config = loadConfig(cwd);
    let suites = discoverSuites(cwd, {
        globs: config.discovery.globs,
        exclude: config.discovery.exclude,
    });

    const session = new SessionManager();
    const runner = new MochaRunner();
    const chrome = new ChromeManager();
    const hub = new WsHub();

    const here = path.dirname(fileURLToPath(import.meta.url));
    const pickScriptPath = path.resolve(
        here,
        "../../.claude/skills/identify-element/references/pick-element.js",
    );

    const lspResult = await ensureLspConfig(cwd);
    const lspWarning: LspWarning | null =
        lspResult.status === "ok"
            ? null
            : {
                kind: lspResult.status,
                message: lspResult.message,
                installCmd: lspResult.installCmd,
                stderrTail: lspResult.stderrTail,
            };
    console.log(`[lsp] ${lspResult.status}${lspResult.message ? `: ${lspResult.message}` : ""}`);

    const app = createApp({
        cwd,
        loadInit: () => ({ suites, config, state: session.getState(), lsp: lspResult.status }),
    });
    registerHttpRoutes(app, { here });

    const httpServer = http.createServer(app);
    attachWsServer(httpServer, {
        hub,
        session,
        init: () => ({ suites, config, lspWarning }),
    });

    const copilot = new CopilotClient({
        sessionIdleTimeoutSeconds: 1800,
        cliArgs: ["--experimental"],
    });
    await copilot.start();

    const gui = new GuiSession({
        cwd,
        session,
        runner,
        chrome,
        copilot,
        hub,
        config: () => config,
        pickScriptPath,
    });

    registerCommandHandlers({
        cwd,
        gui,
        hub,
        suites: () => suites,
        onSuitesRefreshed: (next) => {
            suites = next;
        },
        config,
    });

    // Best-effort cleanup on GUI shutdown: GuiSession.stop tears the
    // worker AND Chrome. Without this, killing the GUI window leaves
    // an orphaned Chrome at a port the next launch would clash with.
    const shutdown = async () => {
        try { await gui.stop(); } catch { /* ignore */ }
    };
    process.once("SIGINT", () => { shutdown().finally(() => process.exit(0)); });
    process.once("SIGTERM", () => { shutdown().finally(() => process.exit(0)); });
    process.once("beforeExit", () => { void shutdown(); });

    httpServer.listen(port, async () => {
        const url = `http://localhost:${port}`;
        console.log(`Debug GUI ready at ${url}`);
        const result = await launchAppMode(url, {
            disabled: process.env.DEBUG_GUI_NO_OPEN === "1",
        });
        if (result.mode === "skipped") {
            console.log(`Open ${url} in your browser (auto-launch disabled by DEBUG_GUI_NO_OPEN)`);
        } else if (result.mode === "fallback") {
            console.log(`Opened in default browser (no Chromium-based browser found for app mode)`);
        } else {
            console.log(`Launched in app mode: ${result.browserPath}`);
            if (process.platform === "win32" && !result.renamed) {
                console.warn("⚠  Could not create dgui-ui.exe hard link; GUI window may be killed by test cleanup hooks that target chrome.exe/msedge.exe.");
            }
        }
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const port = process.env.PORT ? Number(process.env.PORT) : 5555;
    main(process.cwd(), port).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

// Keep the express import alive so tools that lint side-effects don't drop it.
// `app.use(express.static(...))` is invoked inside registerHttpRoutes.
void express;
