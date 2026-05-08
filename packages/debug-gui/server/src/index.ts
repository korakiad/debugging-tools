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
import { MochaRunner, buildMochaFork, spawnShellCommand, killTree } from "./runner.js";
import { WorkerLink } from "./workerLink.js";
import { createApp, WsHub } from "./server.js";
import { buildSessionConfig } from "./agent.js";
import { makeEditFileTool } from "./tools/editFile.js";
import { makePickElementTool } from "./tools/pickElement.js";
import { makeAskUserTool } from "./tools/askUser.js";
import { drainResolvers, type PendingResolver } from "./resolvers.js";
import { SCREENSHOT_DIR } from "./screenshot.js";
import { launchAppMode } from "./launcher.js";
import { ensureLspConfig } from "./lspInit.js";
import type { LspWarning } from "./messages.js";
import { CopilotClient } from "@github/copilot-sdk";

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
    const link = new WorkerLink(session);
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

    // Kill every in-flight pick child and broadcast pick_done for each.
    // Without this, agent_abort/cancel would leave the playwright-cli
    // overlay injected in the test browser and the GUI's "Pick mode
    // active" banner never clears (the banner is only dismissed by a
    // matching pick_done). drainResolvers alone rejects the resolver
    // map but doesn't touch the spawned children or the UI signal.
    const killAllPicks = async () => {
        const entries = [...pickPids.entries()];
        pickPids.clear();
        for (const [reqId, pid] of entries) {
            try { await killTree(pid); } catch { /* already gone */ }
            hub.broadcast({ type: "pick_done", reqId });
        }
    };
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

    session.events.on("change", (snap) => {
        hub.broadcast({ type: "status", state: snap.state });
        if (snap.state === "paused" && snap.currentFailure) {
            hub.broadcast({ type: "paused", failure: snap.currentFailure });
        }
    });

    const copilot = new CopilotClient({
        sessionIdleTimeoutSeconds: 1800,
        cliArgs: ["--experimental"],
    });
    await copilot.start();

    // Tracked across messages so agent_abort can reach the live session and
    // suppress the rejection that abort() causes in sendAndWait().
    let currentAgentSession: Awaited<ReturnType<typeof copilot.createSession>> | null = null;
    let aborting = false;
    // Trips the local Promise.race that wraps sendAndWait. The Copilot SDK's
    // sendAndWait only resolves/rejects on session.idle / session.error from
    // the CLI; abort() RPCs the CLI but doesn't unblock the local await. If
    // the agent is mid-tool-call (e.g. Bash running playwright-cli), idle
    // can lag tens of seconds, during which the GUI's spinner + Stop button
    // stay visible and Stop feels dead. Tripping this rejects sendAndWait
    // immediately so the catch/finally can clear UI state without waiting.
    let agentSendReject: ((e: Error) => void) | null = null;
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
                //
                // playwright-cli operates on named sessions. We attach a fresh
                // session per pick (cheap; daemon spin-up is ~1s) and detach
                // after run-code returns, so concurrent picks don't collide
                // and we don't leak sessions across runs.
                const reqId = Math.random().toString(36).slice(2);
                const sessionName = `dgui_pick_${reqId}`;
                hub.broadcast({ type: "pick", reqId, hint });
                return new Promise<Record<string, unknown>>((resolve, reject) => {
                    pickResolvers.set(reqId, { resolve, reject });
                    const cmd = [
                        `npx playwright-cli attach --cdp="http://localhost:${config.cdp.port}" --session=${sessionName}`,
                        `npx playwright-cli -s=${sessionName} --raw run-code --filename="${pickScriptPath}"`,
                    ].join(" && ");
                    const child = spawn(cmd, { shell: true, env: process.env });
                    if (child.pid) pickPids.set(reqId, child.pid);
                    let stdout = "";
                    let stderr = "";
                    child.stdout?.on("data", (b) => { stdout += b.toString(); });
                    child.stderr?.on("data", (b) => { stderr += b.toString(); });
                    const cleanup = () => {
                        // best-effort detach so the session daemon doesn't
                        // outlive this pick. Errors here are silent — the
                        // session may already be gone.
                        spawn(`npx playwright-cli -s=${sessionName} detach`, {
                            shell: true,
                            env: process.env,
                            stdio: "ignore",
                        });
                    };
                    child.on("exit", (code) => {
                        pickPids.delete(reqId);
                        const r = pickResolvers.get(reqId);
                        if (!r) { cleanup(); return; }
                        pickResolvers.delete(reqId);
                        hub.broadcast({ type: "pick_done", reqId });
                        if (code !== 0) {
                            cleanup();
                            r.reject(new Error(`pick-element exited ${code}: ${(stderr || stdout).trim().slice(-500)}`));
                            return;
                        }
                        // attach prints its own banner before run-code's JSON.
                        // pick-element.js outputs a single JSON object on the
                        // last line, so grab the last {...} block.
                        const jsonMatch = stdout.match(/\{[\s\S]*\}\s*$/);
                        cleanup();
                        if (!jsonMatch) {
                            r.reject(new Error(`pick-element no JSON in stdout: ${stdout.trim().slice(-500)}`));
                            return;
                        }
                        try {
                            r.resolve(JSON.parse(jsonMatch[0]));
                        } catch (e: any) {
                            r.reject(new Error(`pick-element JSON parse: ${e?.message ?? e}`));
                        }
                    });
                    child.on("error", (e) => {
                        pickPids.delete(reqId);
                        cleanup();
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
                // Manual mode always allows free text so QA can surface context
                // the agent's CDP inspection can't see; force it here so a model
                // that disables it in args can't override the mode.
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
                if (agentSendReject) {
                    const reject = agentSendReject;
                    agentSendReject = null;
                    reject(new Error("superseded by new run"));
                }
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
            const forkSpec = buildMochaFork({
                spec,
                grep: cmd.grep,
                bailOnFailure: cmd.bailOnFailure,
            });
            // markRunning before attach so any IPC frame that arrives during
            // worker boot finds currentSpec already set — WorkerLink uses
            // currentSpec when reflecting status:running.
            session.markRunning(cmd.spec);
            const child = await runner.start(forkSpec);
            link.attach(child);

            let agentSession: Awaited<ReturnType<typeof copilot.createSession>> | null = null;
            try {
                agentSession = await copilot.createSession(
                    buildSessionConfig({
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
                    const abortPromise = new Promise<never>((_, reject) => {
                        agentSendReject = reject;
                    });
                    try {
                        // sendAndWait blocks until session.idle so the spinner
                        // stays up until the agent actually finishes. Plain
                        // send() resolves as soon as the RPC is acknowledged.
                        // Race against agentSendReject so an agent_abort or
                        // cancel can break out without waiting for the SDK
                        // to surface session.idle (the CLI may not emit it
                        // until any in-flight tool call returns).
                        const f = snap.currentFailure;
                        const manualPreamble =
                            config.agent.mode === "manual"
                                ? "You are in MANUAL mode. Always call ask_user before edit_file — the walkthrough SKILL describes the conversation pattern.\n\n"
                                : "";
                        await Promise.race([abortPromise, agentSession!.sendAndWait(
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
                                    `The test browser is reachable via CDP at http://localhost:${config.cdp.port}.\n\n` +
                                    `Decide your inspection approach using the walkthrough SKILL:\n` +
                                    `- If this is an element-related failure (selector miss, "not found", ` +
                                    `"not interactable", stale element, wrong-element assertions), call the ` +
                                    `pick_element tool first so QA shows you the real element — that is more ` +
                                    `reliable for selector work than DOM inspection.\n` +
                                    `- For non-element failures (timing, navigation, console errors, network, ` +
                                    `page state, frame topology), use the playwright-cli skill — its references ` +
                                    `cover the attach/-s/detach pattern and each inspection capability.\n\n` +
                                    `Do NOT run mocha, npm test, or any test command yourself. The GUI ` +
                                    `orchestrates test execution. After you apply the fix via edit_file, stop ` +
                                    `and let QA click Run in the GUI to re-execute the suite — that is the ` +
                                    `only correct way to verify the fix.`,
                            },
                            config.agent.idleTimeoutMs,
                        )]);
                    } catch (e: any) {
                        if (aborting) {
                            hub.broadcast({ type: "chat_final", content: "[aborted by user]" });
                        } else {
                            hub.broadcast({ type: "error", message: `Agent send: ${e?.message ?? e}` });
                            console.error("agent.send failed:", e);
                        }
                    } finally {
                        agentSendReject = null;
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
            // After QA approves a fix during pause, tell them not to click
            // Continue: Mocha's per-process require cache holds the spec /
            // page-object modules from suite-load, so the retry's in-flight
            // it() body will still see the OLD selector (the agent's edit
            // changed disk, not memory). Continue → same error; Run → fresh
            // process → fix takes effect. See login.spec.js + login.page.js
            // for the canonical case.
            if (cmd.action === "approved") {
                hub.broadcast({
                    type: "notice",
                    kind: "info",
                    message:
                        "Fix saved to disk. Mocha can't reload modules mid-run, " +
                        "so clicking Continue will hit the same error. " +
                        "Click Run to re-execute the suite with the fix applied.",
                });
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
            link.sendResume();
            session.markResumed();
        }
        if (cmd.type === "agent_abort") {
            if (currentAgentSession) {
                aborting = true;
                // Trip the local race first (synchronous reject) so the
                // catch+finally in onChange clears UI state immediately.
                // Then RPC the CLI to actually halt the agent. Order
                // matters: aborting=true must be set before the reject
                // schedules its microtask, so the catch's `if (aborting)`
                // branch routes to "[aborted by user]" instead of the
                // generic error message.
                if (agentSendReject) {
                    const reject = agentSendReject;
                    agentSendReject = null;
                    reject(new Error("aborted by user"));
                }
                try {
                    await currentAgentSession.abort();
                } catch (e: any) {
                    aborting = false;
                    hub.broadcast({ type: "error", message: `Agent abort: ${e?.message ?? e}` });
                }
            }
            await killAllPicks();
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
                if (agentSendReject) {
                    const reject = agentSendReject;
                    agentSendReject = null;
                    reject(new Error("cancelled by user"));
                }
                try { await currentAgentSession.abort(); } catch { /* ignore */ }
            }
            // Kill picks before sendStopAndKill — the latter waits up to
            // 5 s for graceful worker shutdown, and we don't want the pick
            // overlay lingering in the test browser during that wait.
            await killAllPicks();
            // Graceful stop with hard-kill fallback. Sends {type:'stop'} so
            // afterEach throws → Mocha runs afterAll (WDIO deleteSession)
            // → worker exits cleanly. Falls back to killTree() after 5 s
            // if the worker is wedged (WDIO session hung, etc.).
            await runner.sendStopAndKill();
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
    main(process.cwd(), port).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
