import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadConfig, saveConfig } from "./config.js";
import { discoverSuites } from "./discovery.js";
import { SessionManager } from "./session.js";
import { MochaRunner, spawnShellCommand, killTree } from "./runner.js";
import { ChromeManager } from "./chromeManager.js";
import { createApp, WsHub } from "./server.js";
import { SCREENSHOT_DIR } from "./screenshot.js";
import { launchAppMode } from "./launcher.js";
import { ensureLspConfig } from "./lspInit.js";
import type { LspWarning } from "./messages.js";
import { isPaused } from "@debug-gui/protocol";
import { CopilotClient } from "@github/copilot-sdk";
import { AgentSession } from "./domain/AgentSession.js";
import { WorkerRun, type WorkerRunOpts } from "./domain/WorkerRun.js";

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

    // Continue stops the current worker and forks a new one for the same spec
    // (fresh require cache → agent's edit takes effect). `switchingWorkers`
    // suppresses the exit/cleanup handlers below during that swap so the GUI
    // doesn't flash mocha_exit / done between forks. Last-run options drive
    // the re-fork. `currentRun` holds the live WorkerRun instance — each
    // Run / Continue creates a fresh one.
    let switchingWorkers = false;
    let currentRun: WorkerRun | null = null;
    let lastRunOpts: WorkerRunOpts | null = null;

    runner.on("stdout", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stdout", text }));
    runner.on("stderr", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stderr", text }));
    runner.on("exit", (code: number | null) => {
        if (switchingWorkers) return; // worker swap, not a session-end
        hub.broadcast({ type: "mocha_exit", code });
        if (!isPaused(session.getState().state)) session.markDone();
    });

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

    // The live agent. AgentSession encapsulates SDK session lifecycle,
    // tool resolvers, sendAndWait abort race, and the stale-event guard
    // that used to live as six closure flags in this file.
    let currentAgent: AgentSession | null = null;

    let preRunPid: number | undefined;
    let preRunCanceled = false;

    session.events.on("change", (snap) => {
        hub.broadcast({ type: "status", state: snap.state });
        if (isPaused(snap.state) && snap.currentFailure) {
            hub.broadcast({ type: "paused", failure: snap.currentFailure });
            // Fire-and-forget — AgentSession dedupes by failure.pausedAt
            // internally and is a no-op when state isn't `ready`, so we
            // don't need to gate on currentAgent presence here beyond
            // the optional-chain. Errors are logged inside the class.
            void currentAgent?.sendOnPause(snap.currentFailure);
        }
    });

    // Spin up a fresh WorkerRun. Idempotently ensures Chrome is running
    // and threads its CDP debuggerAddress into the worker fork via
    // DEBUG_GUI_ATTACH_CDP. The launcher monkey-patches webdriverio.remote()
    // to inject `goog:chromeOptions.debuggerAddress`, so consumer
    // wdio-setup attaches instead of launching — Chrome survives the
    // worker swap on Continue.
    //
    // Run is responsible for calling `chrome.kill()` BEFORE this when the
    // user wants a fresh browser; Continue must NOT kill so the running
    // page state (login, navigation) is preserved across the re-fork.
    async function startMochaWorker(opts: WorkerRunOpts): Promise<void> {
        const handle = await chrome.launch();
        const run = new WorkerRun({
            opts,
            runner,
            session,
            cdpAddress: handle.debuggerAddress,
        });
        currentRun = run;
        await run.start();
        lastRunOpts = opts;
    }

    // Spin up a fresh AgentSession for the just-started worker. Both Run
    // and Continue call this AFTER startMochaWorker so each fork gets a
    // clean agent context — reusing an aborted session leaves sendAndWait
    // pending forever (no idle event fires) and the spinner sticks.
    //
    // The class internally guards against late tool-callback events with
    // an isTornDown() check, so this index.ts no longer has to track
    // per-agent listener lifetimes manually.
    async function setupAgentForRun(): Promise<void> {
        const agent = new AgentSession({
            copilot,
            // Live thunk: re-read on every tool callback + pause send so
            // mid-pause settings_update changes (mode toggle, idleTimeout
            // bump) take effect on the next call.
            config: () => ({
                mode: config.agent.mode,
                idleTimeoutMs: config.agent.idleTimeoutMs,
            }),
            cdpPort: () => chrome.getHandle()?.port ?? 0,
            broadcast: (event) => hub.broadcast(event),
            pickScriptPath,
            fallbackCdpPort: config.cdp.port,
        });
        currentAgent = agent;
        try {
            await agent.setup();
        } catch (e: any) {
            hub.broadcast({ type: "error", message: `Copilot session: ${e?.message ?? e}` });
            console.error("createSession failed:", e);
            if (currentAgent === agent) currentAgent = null;
        }
    }

    hub.onMessage(async (cmd) => {
        if (cmd.type === "run") {
            const spec = suites.find((s) => s.relPath === cmd.spec)?.absPath;
            if (!spec) return;
            await currentAgent?.tearDown({ reason: "superseded by new run" });
            currentAgent = null;
            // End-to-end coverage: test/smoke.sh — pre-run happy-path + failure paths (Task 10)
            // ── Pre-run step ─────────────────────────────────────
            if (config.preRun && !cmd.skipPreRun) {
                try {
                    session.markPreRunning(cmd.spec);
                    const exitCode = await spawnShellCommand(config.preRun, {
                        env: process.env,
                        onSpawn: (pid) => { preRunPid = pid; },
                        onStdout: (text) => hub.broadcast({ type: "mocha_log", stream: "stdout", text: `[pre-run] ${text}` }),
                        onStderr: (text) => hub.broadcast({ type: "mocha_log", stream: "stderr", text: `[pre-run] ${text}` }),
                    });
                    preRunPid = undefined;
                    if (exitCode !== 0) {
                        // Cancel handler owns the reset — don't surface a misleading "Pre-run failed".
                        if (preRunCanceled) {
                            preRunCanceled = false;
                            return;
                        }
                        hub.broadcast({
                            type: "error",
                            message: `Pre-run failed: ${config.preRun} (exit ${exitCode})`,
                        });
                        session.reset();
                        return;
                    }
                } catch (e: any) {
                    hub.broadcast({ type: "error", message: `Pre-run error: ${e?.message ?? e}` });
                    session.reset();
                    return;
                }
            }
            // ──────────────────────────────────────────────────────
            // Fresh browser per Run: tear down any prior Chrome so the new
            // session starts with a clean profile. Continue takes the
            // opposite path (no kill → preserve login/navigation state).
            await chrome.kill();
            await startMochaWorker({
                spec,
                specRel: cmd.spec,
                grep: cmd.grep,
                bailOnFailure: cmd.bailOnFailure,
            });
            await setupAgentForRun();
        }
        if (cmd.type === "diff_decision") {
            currentAgent?.resolveEditDecision(cmd.reqId, cmd.action === "approved", cmd.reason);
            // QA's approval of the fix doesn't itself re-run anything; the
            // GUI explicitly tells them what to click next. Continue is the
            // right button now — it stops the current worker and forks a
            // fresh one so the agent's edit is picked up.
            if (cmd.action === "approved") {
                hub.broadcast({
                    type: "notice",
                    kind: "info",
                    message:
                        "Fix saved. Click Continue to re-run the suite with " +
                        "the fix applied.",
                });
            }
        }
        if (cmd.type === "pick_cancel") {
            await currentAgent?.cancelPick(cmd.reqId);
        }
        if (cmd.type === "prompt_response") {
            currentAgent?.resolvePromptResponse(cmd.reqId, cmd.choice, cmd.freeText);
        }
        if (cmd.type === "continue") {
            // Continue stops the current worker and re-forks the same spec
            // so the agent's on-disk edits land in a fresh require cache.
            // Suite-level closures (`const loginPage = new LoginPage()`)
            // are bound to the cached class — only a re-fork picks them up.
            // Reentrancy guard: drop racing Continue clicks.
            if (!lastRunOpts || switchingWorkers) return;
            // Continue is only meaningful from `paused` — there must be a
            // live failure to resume from. Bail silently for stray clicks.
            if (session.getState().state !== "paused") return;

            switchingWorkers = true;
            try {
                // Halt the agent's in-flight turn AND its session — the new
                // fork gets a fresh agent (setupAgentForRun below). Reusing
                // the aborted session leaves sendAndWait pending forever
                // (no idle event fires post-abort), which manifests as a
                // stuck "Agent thinking" spinner that Stop can't clear.
                // suppressChat: this teardown is a worker swap, not a
                // user-initiated abort — surfacing "[aborted by user]" in
                // chat would falsely suggest the resume failed.
                await currentAgent?.tearDown({ reason: "superseded by continue", suppressChat: true });
                currentAgent = null;

                // Graceful stop with hard-kill fallback (5 s cap inside
                // WorkerRun.stopGracefully → MochaRunner.sendStopAndKill).
                // Browser stays alive — server-managed Chrome (chromeManager)
                // preserves login/navigation state across the swap.
                await currentRun?.stopGracefully();
                currentRun = null;
                await startMochaWorker(lastRunOpts);
                await setupAgentForRun();
            } finally {
                switchingWorkers = false;
            }
        }
        if (cmd.type === "agent_abort") {
            // tearDown handles: trip sendAndWait race, abort + disconnect
            // SDK session, drain resolver maps + kill in-flight pick
            // subprocesses, and broadcast the final UI-clear events.
            await currentAgent?.tearDown({ reason: "aborted by user" });
            currentAgent = null;
        }
        if (cmd.type === "cancel") {
            if (preRunPid) {
                preRunCanceled = true;
                await killTree(preRunPid);
                preRunPid = undefined;
            }
            await currentAgent?.tearDown({ reason: "cancelled by user" });
            currentAgent = null;
            // Graceful stop with hard-kill fallback. WorkerRun forwards a
            // {type:'stop'} frame so afterEach throws → Mocha runs afterAll
            // (WDIO deleteSession) → worker exits cleanly. Falls back to
            // killTree after the runner's 5 s grace.
            await currentRun?.stopGracefully();
            currentRun = null;
            // Stop ends the run AND the browser session; tear down Chrome
            // so the next Run gets a clean profile. Continue takes the
            // opposite path (no kill).
            await chrome.kill();
            session.reset();
            // Stop ends the run; a subsequent Continue would have nothing to
            // resume into, so clear the last-run snapshot.
            lastRunOpts = null;
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
                    // If the previously-Run spec is no longer discoverable
                    // (excluded by the new globs), drop the snapshot so a
                    // stray Continue is a no-op.
                    if (lastRunOpts && !suites.some((s) => s.relPath === lastRunOpts!.specRel)) {
                        lastRunOpts = null;
                    }
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
        try { await runner.sendStopAndKill(); } catch { /* ignore */ }
        try { await chrome.kill(); } catch { /* ignore */ }
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
