import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadConfig, saveConfig } from "./config.js";
import { discoverSuites } from "./discovery.js";
import { SessionManager } from "./session.js";
import { MochaRunner } from "./runner.js";
import { ChromeManager } from "./chromeManager.js";
import { createApp, WsHub } from "./server.js";
import { SCREENSHOT_DIR } from "./screenshot.js";
import { launchAppMode } from "./launcher.js";
import { ensureLspConfig } from "./lspInit.js";
import type { LspWarning } from "./messages.js";
import { CopilotClient } from "@github/copilot-sdk";
import { GuiSession } from "./domain/GuiSession.js";

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

    app.get("/api/screenshot/:name", (req, res) => {
        const name = req.params.name;
        if (!/^[A-Za-z0-9-]+\.png$/.test(name)) {
            res.status(400).end();
            return;
        }
        res.sendFile(path.join(SCREENSHOT_DIR, name));
    });

    // Serve built web SPA from server/dist/../../web/dist in prod.
    // (In dev, vite serves :5555 and proxies API to backend.)
    const webDist = path.resolve(here, "../../web/dist");
    if (existsSync(webDist)) {
        app.use(express.static(webDist));
        app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
    }

    const httpServer = http.createServer(app);

    const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    wss.on("connection", (ws) => {
        hub.add(ws);
        ws.send(JSON.stringify({ type: "init", suites, config, state: session.getState() }));
        if (lspWarning) {
            ws.send(JSON.stringify({ type: "lsp/warning", warning: lspWarning }));
        }
        ws.on("message", (raw) => hub.handleIncoming(raw.toString()));
        ws.on("close", () => hub.remove(ws));
    });

    const copilot = new CopilotClient({
        sessionIdleTimeoutSeconds: 1800,
        cliArgs: ["--experimental"],
    });
    await copilot.start();

    // GuiSession installs its own session.events + runner subscriptions
    // in its constructor (status broadcasts, paused → agent dispatch,
    // mocha_log streaming, exit + markDone). All Run / Continue / Stop /
    // agent_abort flow goes through its methods.
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

    hub.onMessage(async (cmd) => {
        if (cmd.type === "run") {
            const spec = suites.find((s) => s.relPath === cmd.spec)?.absPath;
            if (!spec) return;
            await gui.start(
                {
                    spec,
                    specRel: cmd.spec,
                    grep: cmd.grep,
                    bailOnFailure: cmd.bailOnFailure,
                },
                !cmd.skipPreRun,
            );
        }
        if (cmd.type === "diff_decision") {
            gui.resolveDiff(cmd.reqId, cmd.action === "approved", cmd.reason);
        }
        if (cmd.type === "pick_cancel") {
            await gui.cancelPick(cmd.reqId);
        }
        if (cmd.type === "prompt_response") {
            gui.respondPrompt(cmd.reqId, cmd.choice, cmd.freeText);
        }
        if (cmd.type === "continue") {
            await gui.continueSession();
        }
        if (cmd.type === "agent_abort") {
            await gui.abortAgent();
        }
        if (cmd.type === "cancel") {
            await gui.stop();
        }
        if (cmd.type === "settings_update") {
            const patch: Parameters<typeof saveConfig>[1] = {};
            if (cmd.preRun !== undefined) {
                if (typeof cmd.preRun !== "string") {
                    hub.broadcast({ type: "error", message: "Save settings: preRun must be a string" });
                    return;
                }
                patch.preRun = cmd.preRun;
            }
            if (cmd.idleTimeoutMs !== undefined) {
                if (typeof cmd.idleTimeoutMs !== "number" || !Number.isFinite(cmd.idleTimeoutMs) || cmd.idleTimeoutMs <= 0) {
                    hub.broadcast({ type: "error", message: "Save settings: idleTimeoutMs must be a positive number" });
                    return;
                }
                patch.idleTimeoutMs = cmd.idleTimeoutMs;
            }
            if (cmd.mode !== undefined) {
                if (cmd.mode !== "auto" && cmd.mode !== "manual") {
                    hub.broadcast({ type: "error", message: "Save settings: mode must be 'auto' or 'manual'" });
                    return;
                }
                patch.mode = cmd.mode;
            }
            if (cmd.discovery !== undefined) {
                const d: { globs?: string[]; exclude?: string[]; extensions?: string[] } = {};
                if (cmd.discovery.globs !== undefined) {
                    if (!Array.isArray(cmd.discovery.globs) || !cmd.discovery.globs.every((g) => typeof g === "string")) {
                        hub.broadcast({ type: "error", message: "Save settings: discovery.globs must be string[]" });
                        return;
                    }
                    d.globs = cmd.discovery.globs;
                }
                if (cmd.discovery.exclude !== undefined) {
                    if (!Array.isArray(cmd.discovery.exclude) || !cmd.discovery.exclude.every((g) => typeof g === "string")) {
                        hub.broadcast({ type: "error", message: "Save settings: discovery.exclude must be string[]" });
                        return;
                    }
                    d.exclude = cmd.discovery.exclude;
                }
                if (cmd.discovery.extensions !== undefined) {
                    if (!Array.isArray(cmd.discovery.extensions) || !cmd.discovery.extensions.every((g) => typeof g === "string")) {
                        hub.broadcast({ type: "error", message: "Save settings: discovery.extensions must be string[]" });
                        return;
                    }
                    d.extensions = cmd.discovery.extensions;
                }
                patch.discovery = d;
            }
            try {
                const nextCfg = saveConfig(cwd, patch);
                // Mutate the captured config so downstream run-handler sees the new value.
                Object.assign(config, nextCfg);
                hub.broadcast({ type: "config_updated", config: nextCfg });
                // If discovery changed, re-scan and broadcast fresh suites so
                // the TestTree reflects the new include/exclude without a reload.
                if (patch.discovery) {
                    suites = discoverSuites(cwd, {
                        globs: nextCfg.discovery.globs,
                        exclude: nextCfg.discovery.exclude,
                    });
                    hub.broadcast({ type: "suites_updated", suites });
                }
            } catch (e: any) {
                hub.broadcast({ type: "error", message: `Save settings: ${e?.message ?? e}` });
            }
        }
    });

    // Best-effort cleanup on GUI shutdown: tear down the worker AND the
    // server-managed Chrome. Without this, killing the GUI window leaves
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
