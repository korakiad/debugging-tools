import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import express from "express";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadConfig, saveConfig } from "./config.js";
import { discoverSuites } from "./discovery.js";
import { SessionManager } from "./session.js";
import { HookerClient } from "./hooker.js";
import { MochaRunner, buildMochaCommand, spawnShellCommand, killTree } from "./runner.js";
import { Orchestrator } from "./orchestrator.js";
import { createApp, WsHub } from "./server.js";
import { buildSessionConfig } from "./agent.js";
import { makeEditFileTool } from "./tools/editFile.js";
import { makePickElementTool } from "./tools/pickElement.js";
import { makeAskUserTool } from "./tools/askUser.js";
import { drainResolvers, type PendingResolver } from "./resolvers.js";
import { SCREENSHOT_DIR } from "./screenshot.js";
import { launchAppMode } from "./launcher.js";
import { CopilotClient } from "@github/copilot-sdk";

export const VERSION = "0.0.1";

export async function main(
    cwd: string = process.cwd(),
    port: number = 5555,
    commandTokens: string[] = [],
): Promise<void> {
    const config = loadConfig(cwd);
    const customCommand = commandTokens.length > 0
        ? { cmd: commandTokens[0], args: commandTokens.slice(1) }
        : undefined;
    let suites = discoverSuites(cwd, {
        globs: config.discovery.globs,
        exclude: config.discovery.exclude,
    });

    const session = new SessionManager();
    const hooker = new HookerClient();
    const orch = new Orchestrator(session, hooker);
    const runner = new MochaRunner();
    const hub = new WsHub();

    runner.on("stdout", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stdout", text }));
    runner.on("stderr", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stderr", text }));
    runner.on("exit", (code: number | null) => {
        hub.broadcast({ type: "mocha_exit", code });
        if (session.getState().state !== "paused") session.markDone();
    });

    const editResolvers = new Map<string, PendingResolver<{ approved: boolean; reason?: string }>>();
    const pickResolvers = new Map<string, PendingResolver<Record<string, unknown>>>();
    const askResolvers = new Map<string, PendingResolver<{ choice: string | null; freeText: string | null }>>();
    // PIDs of in-flight playwright-cli pick subprocesses, keyed by reqId.
    // Lets pick_cancel kill the right child without leaking handles after
    // natural completion.
    const pickPids = new Map<string, number>();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pickScriptPath = path.resolve(
        here,
        "../../.claude/skills/identify-element/references/pick-element.js",
    );

    const app = createApp({
        cwd,
        loadInit: () => ({ suites, config, state: session.getState() }),
        hooker,
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
        ws.on("message", (raw) => hub.handleIncoming(raw.toString()));
        ws.on("close", () => hub.remove(ws));
    });

    session.events.on("change", (snap) => {
        hub.broadcast({ type: "status", state: snap.state });
        if (snap.state === "paused" && snap.currentFailure) {
            hub.broadcast({ type: "paused", failure: snap.currentFailure });
        }
    });

    const copilot = new CopilotClient({ sessionIdleTimeoutSeconds: 1800 });
    await copilot.start();

    // Tracked across messages so agent_abort can reach the live session and
    // suppress the rejection that abort() causes in sendAndWait().
    let currentAgentSession: Awaited<ReturnType<typeof copilot.createSession>> | null = null;
    let aborting = false;
    let preRunPid: number | undefined;
    let preRunCanceled = false;

    const tools = [
        makeEditFileTool({
            onPropose: (file, oldCode, newCode) => {
                const reqId = Math.random().toString(36).slice(2);
                return new Promise((resolve, reject) => {
                    editResolvers.set(reqId, { resolve, reject });
                    hub.broadcast({ type: "diff", reqId, file, oldCode, newCode });
                });
            },
        }),
        makePickElementTool({
            onPick: (hint) => {
                // Spawn playwright-cli's pick-element script against the test
                // runner's CDP port. The script injects hover-highlight + click
                // handlers into the *test* browser (not debug-gui's own UI) and
                // blocks until QA clicks. Stdout is JSON with DOM attributes +
                // frame chain — exactly what the agent needs to build a selector.
                const reqId = Math.random().toString(36).slice(2);
                hub.broadcast({ type: "pick", reqId, hint });
                return new Promise<Record<string, unknown>>((resolve, reject) => {
                    pickResolvers.set(reqId, { resolve, reject });
                    const child = spawn(
                        "npx",
                        ["playwright-cli", "--raw", "run-code", "--filename", pickScriptPath],
                        {
                            env: { ...process.env, PLAYWRIGHT_CDP_PORT: String(config.cdp.port) },
                            shell: true,
                        },
                    );
                    if (child.pid) pickPids.set(reqId, child.pid);
                    let stdout = "";
                    let stderr = "";
                    child.stdout?.on("data", (b) => { stdout += b.toString(); });
                    child.stderr?.on("data", (b) => { stderr += b.toString(); });
                    child.on("exit", (code) => {
                        pickPids.delete(reqId);
                        const r = pickResolvers.get(reqId);
                        if (!r) return; // already drained (cancel/abort)
                        pickResolvers.delete(reqId);
                        hub.broadcast({ type: "pick_done", reqId });
                        if (code !== 0) {
                            r.reject(new Error(`pick-element exited ${code}: ${stderr.trim() || stdout.trim()}`));
                            return;
                        }
                        try {
                            r.resolve(JSON.parse(stdout));
                        } catch (e: any) {
                            r.reject(new Error(`pick-element stdout not JSON: ${e?.message ?? e}`));
                        }
                    });
                    child.on("error", (e) => {
                        pickPids.delete(reqId);
                        const r = pickResolvers.get(reqId);
                        if (!r) return;
                        pickResolvers.delete(reqId);
                        hub.broadcast({ type: "pick_done", reqId });
                        r.reject(e);
                    });
                });
            },
        }),
        makeAskUserTool({
            onAsk: (summary, options, allowFreeText) => {
                // SKILL.md item 2 mandates allowFreeText in manual mode so QA can
                // surface context the agent's CDP inspection can't see. Force it
                // here so a model that ignores the SKILL rule can't disable it.
                const effectiveAllowFreeText =
                    config.agent.mode === "manual" ? true : allowFreeText;
                const reqId = Math.random().toString(36).slice(2);
                return new Promise((resolve, reject) => {
                    askResolvers.set(reqId, { resolve, reject });
                    hub.broadcast({
                        type: "prompt",
                        reqId,
                        summary,
                        options,
                        allowFreeText: effectiveAllowFreeText,
                    });
                });
            },
        }),
    ];

    hub.onMessage(async (cmd) => {
        if (cmd.type === "run") {
            const spec = suites.find((s) => s.relPath === cmd.spec)?.absPath;
            if (!spec) return;
            if (currentAgentSession) {
                aborting = true;
                try { await currentAgentSession.abort(); } catch { /* ignore */ }
            }
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
            const mochaCmd = buildMochaCommand({
                spec,
                guiPort: port,
                guiPid: process.pid,
                customCommand,
                grep: cmd.grep,
            });
            await hooker.reset();
            await runner.start(mochaCmd);
            session.markRunning(cmd.spec);
            orch.start(500);

            let agentSession: Awaited<ReturnType<typeof copilot.createSession>> | null = null;
            try {
                agentSession = await copilot.createSession(
                    buildSessionConfig({
                        cwd,
                        tools,
                        onPick: () => Promise.resolve({}),
                        onEdit: async () => ({ approved: true }),
                    })
                );
                currentAgentSession = agentSession;
            } catch (e: any) {
                hub.broadcast({ type: "error", message: `Copilot session: ${e?.message ?? e}` });
                console.error("createSession failed:", e);
            }

            if (agentSession) {
                agentSession.on("assistant.message", (ev: any) => {
                    const content: string = ev?.data?.content ?? "";
                    if (content && !aborting) hub.broadcast({ type: "chat_final", content });
                });
                agentSession.on("command.execute", (ev: any) => {
                    const name: string = ev?.data?.name ?? ev?.data?.tool ?? "tool";
                    hub.broadcast({ type: "agent_activity", label: `calling ${name}` });
                });
                agentSession.on("command.completed", () => {
                    hub.broadcast({ type: "agent_activity", label: "" });
                });

                let lastPausedAt = 0;
                const onChange = async (snap: ReturnType<typeof session.getState>) => {
                    if (snap.state !== "paused" || !snap.currentFailure) return;
                    const at = snap.currentFailure.pausedAt ?? 0;
                    if (at === lastPausedAt) return;
                    lastPausedAt = at;
                    hub.broadcast({ type: "agent_thinking", active: true });
                    try {
                        // sendAndWait blocks until session.idle so the spinner
                        // stays up until the agent actually finishes. Plain
                        // send() resolves as soon as the RPC is acknowledged.
                        const f = snap.currentFailure;
                        const manualPreamble =
                            config.agent.mode === "manual"
                                ? `You are in MANUAL mode. Follow the walkthrough SKILL "Manual mode ` +
                                  `contract" exactly: your FIRST action for any element-related failure ` +
                                  `is to call ask_user with options that include a pick_* id (e.g. ` +
                                  `pick_login_button) — do NOT call pick_element or playwright-cli ` +
                                  `directly until QA chooses an option. The summary must be two lines ` +
                                  `(Hypothesis "ผมคิดว่า [root cause] เพราะ [evidence]" + Invitation ` +
                                  `asking for context you can't see). allowFreeText: true is mandatory. ` +
                                  `When QA picks a pick_* option, then call pick_element. When QA ` +
                                  `chooses apply_*, call edit_file. If QA chooses apply_* AND adds ` +
                                  `new-context freeText, do NOT apply — acknowledge, re-investigate, ` +
                                  `and re-ask.\n\n`
                                : "";
                        await agentSession!.sendAndWait(
                            {
                                prompt:
                                    manualPreamble +
                                    `A mocha test just failed and the walkthrough hook paused execution.\n\n` +
                                    `Failure details:\n` +
                                    `  test:  ${f.test}\n` +
                                    `  suite: ${f.suite ?? "(none)"}\n` +
                                    `  file:  ${f.file}\n` +
                                    `  error: ${f.error}\n` +
                                    `  stack:\n${f.stack}\n\n` +
                                    `Follow the walkthrough SKILL. For non-element investigation ` +
                                    `(timing, navigation, console errors) use playwright-cli at CDP ` +
                                    `port ${config.cdp.port}. The QA operator will click Continue ` +
                                    `in the GUI to resume the test runner once a fix is applied.`,
                            },
                            config.agent.idleTimeoutMs,
                        );
                    } catch (e: any) {
                        if (aborting) {
                            hub.broadcast({ type: "chat_final", content: "[aborted by user]" });
                        } else {
                            hub.broadcast({ type: "error", message: `Agent send: ${e?.message ?? e}` });
                            console.error("agent.send failed:", e);
                        }
                    } finally {
                        aborting = false;
                        hub.broadcast({ type: "agent_thinking", active: false });
                        hub.broadcast({ type: "agent_activity", label: "" });
                    }
                };
                session.events.on("change", onChange);
                runner.once("exit", () => {
                    session.events.off("change", onChange);
                    currentAgentSession = null;
                });
            }
        }
        if (cmd.type === "diff_decision") {
            const resolver = editResolvers.get(cmd.reqId);
            if (resolver) {
                resolver.resolve({ approved: cmd.action === "approved", reason: cmd.reason });
                editResolvers.delete(cmd.reqId);
            }
        }
        if (cmd.type === "pick_cancel") {
            const pid = pickPids.get(cmd.reqId);
            if (pid) {
                try { await killTree(pid); } catch { /* already gone */ }
                pickPids.delete(cmd.reqId);
            }
            const resolver = pickResolvers.get(cmd.reqId);
            if (resolver) {
                pickResolvers.delete(cmd.reqId);
                hub.broadcast({ type: "pick_done", reqId: cmd.reqId });
                resolver.reject(new Error("pick cancelled by QA"));
            }
        }
        if (cmd.type === "prompt_response") {
            const resolver = askResolvers.get(cmd.reqId);
            if (resolver) {
                resolver.resolve({ choice: cmd.choice, freeText: cmd.freeText });
                askResolvers.delete(cmd.reqId);
            }
        }
        if (cmd.type === "continue") {
            await hooker.postContinue();
            session.markResumed();
        }
        if (cmd.type === "agent_abort") {
            if (currentAgentSession) {
                aborting = true;
                try {
                    await currentAgentSession.abort();
                } catch (e: any) {
                    aborting = false;
                    hub.broadcast({ type: "error", message: `Agent abort: ${e?.message ?? e}` });
                }
            }
            drainResolvers(editResolvers);
            drainResolvers(pickResolvers);
            drainResolvers(askResolvers);
        }
        if (cmd.type === "cancel") {
            if (preRunPid) {
                preRunCanceled = true;
                await killTree(preRunPid);
                preRunPid = undefined;
            }
            if (currentAgentSession) {
                aborting = true;
                try { await currentAgentSession.abort(); } catch { /* ignore */ }
            }
            await runner.kill();
            orch.stop();
            session.reset();
            drainResolvers(editResolvers);
            drainResolvers(pickResolvers);
            drainResolvers(askResolvers);
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
    main(process.cwd(), port, process.argv.slice(2)).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
