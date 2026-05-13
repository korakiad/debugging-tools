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
import { ChromeManager } from "./chromeManager.js";
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
import { isPaused } from "@debug-gui/protocol";
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
    const chrome = new ChromeManager();
    const hub = new WsHub();

    // Continue stops the current worker and forks a new one for the same spec
    // (fresh require cache → agent's edit takes effect). `switchingWorkers`
    // suppresses the exit/cleanup handlers below during that swap so the GUI
    // doesn't flash mocha_exit / done between forks. Last-run options drive
    // the re-fork.
    let switchingWorkers = false;
    let lastRunOpts:
        | { spec: string; specRel: string; grep?: string; bailOnFailure?: boolean }
        | null = null;

    runner.on("stdout", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stdout", text }));
    runner.on("stderr", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stderr", text }));
    runner.on("exit", (code: number | null) => {
        if (switchingWorkers) return; // worker swap, not a session-end
        hub.broadcast({ type: "mocha_exit", code });
        if (!isPaused(session.getState().state)) session.markDone();
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

    // Tell the UI to clear any open prompt panels driven by ask_user
    // tool calls. drainResolvers rejects the agent-side promise but
    // doesn't touch the UI's pendingPrompt state — without an explicit
    // prompt_done broadcast the panel sticks after Stop. Call this
    // BEFORE drainResolvers(askResolvers) so the reqIds are still in
    // the map.
    const closeAllPrompts = () => {
        for (const reqId of askResolvers.keys()) {
            hub.broadcast({ type: "prompt_done", reqId });
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
        if (isPaused(snap.state) && snap.currentFailure) {
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
    // Continue tears down the agent as a side-effect of the worker swap, not
    // as a user-initiated abort, so the chat_final "[aborted by user]" line
    // would mislead QA into thinking the resume failed. Set true only by the
    // continue path; cleared by onChange's finally so the next real abort
    // surfaces normally.
    let suppressAbortChat = false;
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

    // Tracked so Run/Continue can off the prior listener + exit handler
    // before installing fresh ones for the new agent session. Without this
    // the closures over the old (aborted) agent session would still fire
    // on subsequent pauses and call sendAndWait on a dead session — the
    // observed "spinner stuck, Stop does nothing" symptom.
    let currentOnChange: ((snap: ReturnType<typeof session.getState>) => void) | null = null;
    let currentExitHandler: (() => void) | null = null;

    // Forks the Mocha worker, attaches the IPC link, and records the options
    // so a later Continue can re-fork the same spec. markRunning happens
    // before attach so any IPC frame arriving during boot finds currentSpec
    // already set — WorkerLink uses currentSpec when reflecting status:running.
    //
    // Idempotently ensures a server-managed Chrome is running and threads
    // its CDP debuggerAddress into the worker via DEBUG_GUI_ATTACH_CDP.
    // The worker's launcher monkey-patches webdriverio.remote() to inject
    // `goog:chromeOptions.debuggerAddress`, so consumer wdio-setup attaches
    // instead of launching — Chrome survives the worker swap on Continue.
    //
    // Run is responsible for calling `chrome.kill()` BEFORE this when the
    // user wants a fresh browser; Continue must NOT kill so the running
    // page state (login, navigation) is preserved across the re-fork.
    async function startMochaWorker(opts: {
        spec: string;
        specRel: string;
        grep?: string;
        bailOnFailure?: boolean;
    }): Promise<void> {
        const handle = await chrome.launch();
        const forkSpec = buildMochaFork({
            spec: opts.spec,
            grep: opts.grep,
            bailOnFailure: opts.bailOnFailure,
        });
        forkSpec.env.DEBUG_GUI_ATTACH_CDP = handle.debuggerAddress;
        session.markRunning(opts.specRel);
        const child = await runner.start(forkSpec);
        link.attach(child);
        lastRunOpts = opts;
    }

    // Fully tears down the current agent: trips local race, aborts the
    // mid-flight message, AND disconnects the session. abort() alone is
    // not enough — per the Copilot SDK docs it only cancels the current
    // *message*, "the session remains valid and can continue to be used."
    // In-flight tool calls (Bash/playwright-cli subprocesses, streaming
    // LLM responses) keep firing events on the original session, which
    // bleed through stale `assistant.message` / `command.execute`
    // listeners as background activity after Stop. disconnect() severs
    // the session connection so those events stop.
    //
    // Run + Continue call this before creating a new session;
    // agent_abort + cancel call it as the terminal teardown.
    //
    // `suppressAbortChat`: when true AND a sendAndWait reject is actually
    // fired, skip the "[aborted by user]" chat line. Continue passes this
    // because the teardown is a worker swap, not a user abort.
    async function tearDownCurrentAgent(
        reason: string,
        opts: { suppressAbortChat?: boolean } = {},
    ): Promise<void> {
        if (agentSendReject) {
            if (opts.suppressAbortChat) suppressAbortChat = true;
            aborting = true;
            const reject = agentSendReject;
            agentSendReject = null;
            reject(new Error(reason));
        }
        if (currentAgentSession) {
            const sess = currentAgentSession;
            currentAgentSession = null; // prevent re-entry
            try { await sess.abort(); } catch { /* ignore */ }
            try { await sess.disconnect(); } catch { /* ignore */ }
        }
    }

    // Stale-tool guard: when Stop / Cancel / Continue tears down the agent
    // session, currentAgentSession is null'd before the disconnect await
    // resolves. The Copilot SDK can still invoke our tool callbacks during
    // that window from buffered events. Without this gate, a late ask_user
    // creates a new prompt panel AFTER "[aborted by user]" — the user
    // observed this as a stuck prompt panel post-Stop.
    const isAgentTornDown = () => currentAgentSession === null;

    const tools = [
        makeEditFileTool({
            onPropose: (file, oldCode, newCode) => {
                if (isAgentTornDown()) {
                    return Promise.reject(new Error("agent session torn down"));
                }
                const reqId = Math.random().toString(36).slice(2);
                return new Promise((resolve, reject) => {
                    editResolvers.set(reqId, { resolve, reject });
                    hub.broadcast({ type: "diff", reqId, file, oldCode, newCode });
                });
            },
        }),
        makePickElementTool({
            onPick: (hint) => {
                if (isAgentTornDown()) {
                    return Promise.reject(new Error("agent session torn down"));
                }
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
                // Use the live Chrome's auto-picked port. ChromeManager
                // launches with --remote-debugging-port=0, so config.cdp.port
                // (legacy default 9222) is no longer where Chrome listens.
                // Falling back to config.cdp.port preserves behaviour for
                // any out-of-band CDP user during the transition.
                const cdpPort = chrome.getHandle()?.port ?? config.cdp.port;
                hub.broadcast({ type: "pick", reqId, hint });
                return new Promise<Record<string, unknown>>((resolve, reject) => {
                    pickResolvers.set(reqId, { resolve, reject });
                    const cmd = [
                        `npx playwright-cli attach --cdp="http://localhost:${cdpPort}" --session=${sessionName}`,
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
                if (isAgentTornDown()) {
                    return Promise.reject(new Error("agent session torn down"));
                }
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

    // Creates a fresh agent session for the just-started worker. Both Run
    // and Continue call this AFTER startMochaWorker so each fork gets a
    // clean agent context — reusing an aborted session leaves sendAndWait
    // pending forever (no idle event fires) and the spinner sticks.
    //
    // Off's any prior listener + exit handler before installing fresh
    // ones; the prior closures referenced the now-aborted agent session.
    async function setupAgentForRun(): Promise<void> {
        // Drop stale references — these are closures over the previous
        // (aborted) agent session.
        if (currentOnChange) {
            session.events.off("change", currentOnChange);
            currentOnChange = null;
        }
        if (currentExitHandler) {
            runner.off("exit", currentExitHandler);
            currentExitHandler = null;
        }

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
            return;
        }
        if (!agentSession) return;

        // Stale-session guard: when Stop fires tearDownCurrentAgent, the
        // SDK's `await sess.disconnect()` may resolve while events are still
        // buffered in flight. Without this check those late events bleed
        // through as new chat lines and "calling ask_user" activity AFTER
        // "[aborted by user]". Compare the closure-captured session with
        // the module-level currentAgentSession (null'd in tearDown) to drop
        // them.
        const mySession = agentSession;
        agentSession.on("assistant.message", (ev: any) => {
            if (mySession !== currentAgentSession) return;
            const content: string = ev?.data?.content ?? "";
            if (content && !aborting) hub.broadcast({ type: "chat_final", content });
        });
        agentSession.on("command.execute", (ev: any) => {
            if (mySession !== currentAgentSession) return;
            const name: string = ev?.data?.name ?? ev?.data?.tool ?? "tool";
            hub.broadcast({ type: "agent_activity", label: `calling ${name}` });
        });
        agentSession.on("command.completed", () => {
            if (mySession !== currentAgentSession) return;
            hub.broadcast({ type: "agent_activity", label: "" });
        });

        let lastPausedAt = 0;
        const onChange = async (snap: ReturnType<typeof session.getState>) => {
            if (snap.state !== "paused") return;
            // DU narrowed: PausedSnapshot guarantees currentFailure + pausedAt.
            const at = snap.pausedAt;
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
                            `The test browser is reachable via CDP at http://localhost:${chrome.getHandle()?.port ?? config.cdp.port}.\n\n` +
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
                            `and let QA click Continue in the GUI to re-execute the suite with the ` +
                            `fix applied — the GUI re-forks the worker so a fresh require cache ` +
                            `picks up your edit.`,
                    },
                    config.agent.idleTimeoutMs,
                )]);
            } catch (e: any) {
                if (aborting) {
                    if (!suppressAbortChat) {
                        hub.broadcast({ type: "chat_final", content: "[aborted by user]" });
                    }
                } else {
                    hub.broadcast({ type: "error", message: `Agent send: ${e?.message ?? e}` });
                    console.error("agent.send failed:", e);
                }
            } finally {
                agentSendReject = null;
                aborting = false;
                suppressAbortChat = false;
                hub.broadcast({ type: "agent_thinking", active: false });
                hub.broadcast({ type: "agent_activity", label: "" });
            }
        };
        currentOnChange = onChange;
        session.events.on("change", onChange);

        // Self-re-registering exit handler so the listener survives a
        // Continue worker swap. During swap, switchingWorkers is true →
        // re-arm and skip cleanup. On a real session-end (Stop/Cancel/done),
        // switchingWorkers is false → tear down. currentExitHandler tracks
        // the live registration so the next setupAgentForRun call can
        // remove it before installing its own.
        const installRunCleanup = () => {
            const handler = () => {
                if (switchingWorkers) {
                    installRunCleanup();
                    return;
                }
                if (currentOnChange) {
                    session.events.off("change", currentOnChange);
                    currentOnChange = null;
                }
                currentAgentSession = null;
                currentExitHandler = null;
            };
            currentExitHandler = handler;
            runner.once("exit", handler);
        };
        installRunCleanup();
    }

    hub.onMessage(async (cmd) => {
        if (cmd.type === "run") {
            const spec = suites.find((s) => s.relPath === cmd.spec)?.absPath;
            if (!spec) return;
            await tearDownCurrentAgent("superseded by new run");
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
            const resolver = editResolvers.get(cmd.reqId);
            if (resolver) {
                resolver.resolve({ approved: cmd.action === "approved", reason: cmd.reason });
                editResolvers.delete(cmd.reqId);
            }
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
                // suppressAbortChat: this teardown is a worker swap, not a
                // user-initiated abort — surfacing "[aborted by user]" in
                // chat would falsely suggest the resume failed.
                await tearDownCurrentAgent("superseded by continue", { suppressAbortChat: true });
                await killAllPicks();
                closeAllPrompts();
                drainResolvers(editResolvers);
                drainResolvers(pickResolvers);
                drainResolvers(askResolvers);

                // Graceful stop with hard-kill fallback (5 s cap inside
                // sendStopAndKill). Browser stays alive — server-managed
                // Chrome (chromeManager) preserves login/navigation state
                // across the swap.
                await runner.sendStopAndKill();
                link.detach();
                await startMochaWorker(lastRunOpts);
                await setupAgentForRun();
            } finally {
                switchingWorkers = false;
            }
        }
        if (cmd.type === "agent_abort") {
            // tearDownCurrentAgent: rejects local race → onChange's
            // catch+finally clears UI; then abort + disconnect the session
            // so in-flight tool calls stop firing background events.
            await tearDownCurrentAgent("aborted by user");
            await killAllPicks();
            closeAllPrompts();
            drainResolvers(editResolvers);
            drainResolvers(pickResolvers);
            drainResolvers(askResolvers);
            // Defensive UI clear: onChange's finally already clears these
            // on the rejector path, but if agentSendReject was null
            // (sendAndWait already resolved, or consumed by a prior
            // Continue) the spinner can stick. Force-clear so Stop
            // always gives the user agency back.
            hub.broadcast({ type: "agent_thinking", active: false });
            hub.broadcast({ type: "agent_activity", label: "" });
        }
        if (cmd.type === "cancel") {
            if (preRunPid) {
                preRunCanceled = true;
                await killTree(preRunPid);
                preRunPid = undefined;
            }
            await tearDownCurrentAgent("cancelled by user");
            // Kill picks before sendStopAndKill — the latter waits up to
            // 5 s for graceful worker shutdown, and we don't want the pick
            // overlay lingering in the test browser during that wait.
            await killAllPicks();
            closeAllPrompts();
            // Graceful stop with hard-kill fallback. Sends {type:'stop'} so
            // afterEach throws → Mocha runs afterAll (WDIO deleteSession)
            // → worker exits cleanly. Falls back to killTree() after 5 s
            // if the worker is wedged (WDIO session hung, etc.).
            await runner.sendStopAndKill();
            // Stop ends the run AND the browser session; tear down Chrome
            // so the next Run gets a clean profile. Continue takes the
            // opposite path (no kill).
            await chrome.kill();
            session.reset();
            drainResolvers(editResolvers);
            drainResolvers(pickResolvers);
            drainResolvers(askResolvers);
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
