import { isPaused, STATE, type ServerEvent } from "@debug-gui/protocol";
import type { CopilotClient } from "@github/copilot-sdk";
import type { DebugGuiConfig } from "../config.js";
import type { SessionManager } from "../session.js";
import { MochaRunner, spawnShellCommand, killTree } from "../runner.js";
import type { ChromeManager } from "../chromeManager.js";
import type { WsHub } from "../server.js";
import { AgentSession } from "./AgentSession.js";
import { WorkerRun, type WorkerRunOpts } from "./WorkerRun.js";

// Top-level GUI session orchestrator. Owns one AgentSession + one
// WorkerRun at a time, plus the shared ChromeManager and the "what spec
// is loaded for Continue" snapshot. Replaces the imperative
// startMochaWorker / setupAgentForRun / Continue / Cancel / agent_abort
// flows that used to live as flat blocks + 4 closure flags in index.ts.
//
// The 5 states are:
//   - idle      — no run, no agent
//   - pre-running — pre-run shell command active (cancel'able)
//   - running   — worker + agent live (paused is observable via
//                 SessionManager; this top-level state doesn't split)
//   - swapping  — Continue: tear old run + agent, fork new ones; the
//                 runner.on('exit') skip-broadcast guard reads this
//   - stopping  — Stop: tear everything, then back to idle
//
// Transitions are linear within each public method; the FSM gate at the
// top of each method drops racing clicks rather than queueing them.
type GuiSessionState = "idle" | "pre-running" | "running" | "swapping" | "stopping";

export interface GuiSessionDeps {
    readonly cwd: string;
    readonly session: SessionManager;
    readonly runner: MochaRunner;
    readonly chrome: ChromeManager;
    readonly copilot: CopilotClient;
    readonly hub: WsHub;
    /** Live config accessor — re-read in every read site so a
     *  settings_update during a paused turn takes effect immediately. */
    readonly config: () => DebugGuiConfig;
    readonly pickScriptPath: string;
}

export class GuiSession {
    private state: GuiSessionState = "idle";
    private agent: AgentSession | null = null;
    private run: WorkerRun | null = null;
    private lastOpts: WorkerRunOpts | null = null;
    private preRunPid: number | undefined;
    private preRunCanceled = false;

    constructor(private readonly deps: GuiSessionDeps) {
        this.installRunnerSubscriptions();
        this.installSessionSubscription();
    }

    getState(): GuiSessionState {
        return this.state;
    }

    // ── Lifecycle methods invoked by the WS command dispatcher ───────

    /**
     * Run flow: pre-run shell (if configured) → fresh Chrome → new
     * WorkerRun → new AgentSession.
     *
     * Idempotent at the FSM level — concurrent Run clicks drop with
     * no side-effects.
     */
    async start(opts: WorkerRunOpts, doPreRun: boolean): Promise<void> {
        if (this.state !== "idle" && this.state !== "stopping") return;
        // Tear any straggling agent first — a fresh Run gets a clean
        // agent context. The previous run's resolvers (if any) are
        // drained inside tearDown.
        await this.agent?.tearDown({ reason: "superseded by new run" });
        this.agent = null;

        if (doPreRun) {
            const ok = await this.runPreRun(opts);
            if (!ok) return;
        }

        // Fresh browser per Run. Continue takes the opposite path
        // (no kill) — that's enforced by Continue calling chrome.launch
        // again on the existing handle.
        await this.deps.chrome.kill();
        const handle = await this.deps.chrome.launch();

        this.run = new WorkerRun({
            opts,
            runner: this.deps.runner,
            session: this.deps.session,
            cdpAddress: handle.debuggerAddress,
        });
        await this.run.start();
        this.lastOpts = opts;

        await this.spawnAgent();
        this.state = "running";
    }

    /**
     * Continue: tear current agent (suppressing the "[aborted by user]"
     * chat line because this is a swap, not a user abort), stop the
     * current worker, then fork a fresh worker + agent for the same
     * spec. Chrome stays alive so login/navigation state carries across.
     *
     * Reentrancy guard: drops racing clicks.
     */
    async continueSession(): Promise<void> {
        if (this.state === "swapping") return;
        if (!this.lastOpts) return;
        if (this.deps.session.getState().state !== STATE.PAUSED) return;

        this.state = "swapping";
        try {
            await this.agent?.tearDown({ reason: "superseded by continue", suppressChat: true });
            this.agent = null;

            await this.run?.stopGracefully();
            this.run = null;

            // Chrome handle survives — reuse the current address. If
            // the handle was nulled by a stray kill, launch will return
            // a fresh one.
            const handle = await this.deps.chrome.launch();
            this.run = new WorkerRun({
                opts: this.lastOpts,
                runner: this.deps.runner,
                session: this.deps.session,
                cdpAddress: handle.debuggerAddress,
            });
            await this.run.start();
            await this.spawnAgent();
        } finally {
            this.state = "running";
        }
    }

    /**
     * Stop: cancel pre-run if active, tear agent, stop worker, kill
     * Chrome, reset session.
     */
    async stop(): Promise<void> {
        if (this.state === "stopping") return;
        this.state = "stopping";
        try {
            if (this.preRunPid) {
                this.preRunCanceled = true;
                await killTree(this.preRunPid);
                this.preRunPid = undefined;
            }
            await this.agent?.tearDown({ reason: "cancelled by user" });
            this.agent = null;
            await this.run?.stopGracefully();
            this.run = null;
            await this.deps.chrome.kill();
            this.deps.session.reset();
            this.lastOpts = null;
        } finally {
            this.state = "idle";
        }
    }

    /**
     * Abort just the agent — the worker keeps running. Used by the
     * GUI's "Cancel agent" button so QA can manually drive the paused
     * state without the agent talking over them.
     */
    async abortAgent(): Promise<void> {
        await this.agent?.tearDown({ reason: "aborted by user" });
        this.agent = null;
    }

    /**
     * Drop the last-run snapshot if its spec is no longer in the
     * provided list. Caller (settings_update after re-discovery)
     * should pass the freshly-discovered relPaths so a stray Continue
     * doesn't try to re-fork a spec that's been excluded.
     */
    invalidateLastOptsIfMissing(discoveredRelPaths: Iterable<string>): void {
        if (!this.lastOpts) return;
        const wanted = this.lastOpts.specRel;
        for (const rp of discoveredRelPaths) {
            if (rp === wanted) return; // still discoverable, keep
        }
        this.lastOpts = null;
    }

    // ── WS command surface: delegate to the live agent ───────────────

    resolveDiff(reqId: string, approved: boolean, reason?: string): void {
        this.agent?.resolveEditDecision(reqId, approved, reason);
        if (approved) {
            this.deps.hub.broadcast({
                type: "notice",
                kind: "info",
                message:
                    "Fix saved. Click Continue to re-run the suite with " +
                    "the fix applied.",
            });
        }
    }

    cancelPick(reqId: string): Promise<void> {
        return this.agent?.cancelPick(reqId) ?? Promise.resolve();
    }

    respondPrompt(reqId: string, choice: string | null, freeText: string | null): void {
        this.agent?.resolvePromptResponse(reqId, choice, freeText);
    }

    // ── Internals ────────────────────────────────────────────────────

    private async spawnAgent(): Promise<void> {
        const agent = new AgentSession({
            copilot: this.deps.copilot,
            config: () => ({
                mode: this.deps.config().agent.mode,
                idleTimeoutMs: this.deps.config().agent.idleTimeoutMs,
            }),
            cdpPort: () => this.deps.chrome.getHandle()?.port ?? 0,
            broadcast: (event) => this.deps.hub.broadcast(event),
            pickScriptPath: this.deps.pickScriptPath,
            fallbackCdpPort: this.deps.config().cdp.port,
        });
        this.agent = agent;
        try {
            await agent.setup();
        } catch (e: any) {
            this.deps.hub.broadcast({ type: "error", message: `Copilot session: ${e?.message ?? e}` });
            console.error("createSession failed:", e);
            if (this.agent === agent) this.agent = null;
        }
    }

    private async runPreRun(opts: WorkerRunOpts): Promise<boolean> {
        const preRunCmd = this.deps.config().preRun;
        if (!preRunCmd) return true;
        this.state = "pre-running";
        this.deps.session.markPreRunning(opts.specRel);
        const broadcast: (e: ServerEvent) => void = (e) => this.deps.hub.broadcast(e);
        const exitCode = await spawnShellCommand(preRunCmd, {
            env: process.env,
            onSpawn: (pid) => { this.preRunPid = pid; },
            onStdout: (text) => broadcast({ type: "mocha_log", stream: "stdout", text: `[pre-run] ${text}` }),
            onStderr: (text) => broadcast({ type: "mocha_log", stream: "stderr", text: `[pre-run] ${text}` }),
        });
        this.preRunPid = undefined;
        if (exitCode === 0) return true;
        // Cancel handler owns the reset path. Don't surface a misleading
        // "Pre-run failed" when the user is the one who killed it.
        if (this.preRunCanceled) {
            this.preRunCanceled = false;
            return false;
        }
        this.deps.hub.broadcast({
            type: "error",
            message: `Pre-run failed: ${preRunCmd} (exit ${exitCode})`,
        });
        this.deps.session.reset();
        this.state = "idle";
        return false;
    }

    private installRunnerSubscriptions(): void {
        this.deps.runner.on("stdout", (text: string) =>
            this.deps.hub.broadcast({ type: "mocha_log", stream: "stdout", text }),
        );
        this.deps.runner.on("stderr", (text: string) =>
            this.deps.hub.broadcast({ type: "mocha_log", stream: "stderr", text }),
        );
        this.deps.runner.on("exit", (code: number | null) => {
            // During Continue's swap, the worker exit is internal — don't
            // surface mocha_exit to the GUI and don't flip session to done
            // (the new fork will set markRunning shortly).
            if (this.state === "swapping") return;
            this.deps.hub.broadcast({ type: "mocha_exit", code });
            if (!isPaused(this.deps.session.getState().state)) {
                this.deps.session.markDone();
            }
        });
    }

    private installSessionSubscription(): void {
        this.deps.session.events.on("change", (snap) => {
            // Mirror wire state into the live WorkerRun's FSM so its
            // `state` field stays in sync (Phase 4 forward; not currently
            // consumed externally).
            this.run?.onSessionChanged(snap);
            this.deps.hub.broadcast({ type: "status", state: snap.state });
            if (isPaused(snap.state) && snap.currentFailure) {
                this.deps.hub.broadcast({ type: "paused", failure: snap.currentFailure });
                // Fire-and-forget — AgentSession dedupes by failure.pausedAt
                // and no-ops when state isn't `ready`.
                void this.agent?.sendOnPause(snap.currentFailure);
            }
        });
    }
}
