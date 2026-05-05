import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import express from "express";
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
import { captureScreenshot, SCREENSHOT_DIR } from "./screenshot.js";
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
    const here = path.dirname(fileURLToPath(import.meta.url));
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
            onPick: async (hint) => {
                const reqId = Math.random().toString(36).slice(2);
                let imageUrl = "";
                try {
                    const shot = await captureScreenshot(config.cdp.port);
                    imageUrl = `/api/screenshot/${encodeURIComponent(shot.id)}`;
                } catch {
                    // screenshot failure is non-fatal — the picker will still render a placeholder
                }
                return new Promise((resolve, reject) => {
                    pickResolvers.set(reqId, { resolve, reject });
                    hub.broadcast({ type: "pick", reqId, imageUrl, hint });
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
                                ? `You are in MANUAL mode. After each CDP/playwright-cli inspection, ` +
                                  `call ask_user with a two-line summary (Hypothesis line "ผมคิดว่า ` +
                                  `[root cause] เพราะ [evidence]" + Invitation line asking QA for ` +
                                  `context you can't see) and 2-3 suggested next steps as options. ` +
                                  `allowFreeText: true is mandatory. Option ids that apply a fix MUST ` +
                                  `start with 'apply_'. Do NOT call edit_file until QA chooses an ` +
                                  `apply_* option. If QA chooses apply_* AND adds new context in ` +
                                  `freeText, do NOT apply — acknowledge, re-investigate, and re-ask.\n\n`
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
                                    `Follow the walkthrough SKILL. For ANY element-related failure ` +
                                    `(wrong selector, element not found, not interactable, wrong element ` +
                                    `clicked, assertion on element text/value), call \`pick_element\` ` +
                                    `FIRST with a short hint — QA visually identifying the element is ` +
                                    `more reliable than guessing from a DOM snapshot, regardless of app ` +
                                    `size. Use playwright-cli (CDP port ${config.cdp.port}) only for ` +
                                    `non-element issues (timing, navigation, console errors) or to ` +
                                    `confirm details after picking. Then call edit_file with the proposed ` +
                                    `change. The QA operator will click Continue in the GUI to resume the ` +
                                    `test runner.`,
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
        if (cmd.type === "pick_result") {
            const resolver = pickResolvers.get(cmd.reqId);
            if (resolver) {
                resolver.resolve(cmd.attrs);
                pickResolvers.delete(cmd.reqId);
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
