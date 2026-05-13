import { spawn } from "child_process";
import type { CopilotClient, CopilotSession, Tool } from "@github/copilot-sdk";
import type { FailureInfo, ServerEvent } from "@debug-gui/protocol";
import { buildSessionConfig } from "../agent.js";
import { makeEditFileTool } from "../tools/editFile.js";
import { makePickElementTool } from "../tools/pickElement.js";
import { makeAskUserTool } from "../tools/askUser.js";
import { drainResolvers, type PendingResolver } from "../resolvers.js";
import { killTree } from "../runner.js";

// Local FSM. The plan's vision is "idle → creating → ready → sending →
// aborted | torn-down" — but `aborted` is a transient state inside
// tearDown, so we collapse to four observable states here. `isTornDown`
// is the public predicate the lifetime owner uses to gate stale-tool
// callbacks.
type AgentState = "idle" | "creating" | "ready" | "sending" | "torn-down";

export interface AgentSessionDeps {
    /** Long-lived CLI client. The session is created per-AgentSession. */
    readonly copilot: CopilotClient;
    /** Live config accessor — re-read at each tool callback and pause
     *  send so a settings_update during a paused turn (e.g. QA toggles
     *  Manual/Auto) takes effect immediately. Returns the same shape
     *  every call; the class reads `.mode` / `.idleTimeoutMs` lazily. */
    readonly config: () => { mode: "auto" | "manual"; idleTimeoutMs: number };
    /** Returns the live CDP port for the test browser. Called at
     *  paused-prompt build time, so a Continue swap that relaunches
     *  Chrome under a new port doesn't bake the old one into the prompt. */
    readonly cdpPort: () => number;
    /** Emit a wire event to all connected clients. The class owns *what*
     *  to broadcast (chat_final, agent_thinking, …); the caller wires
     *  the actual transport. */
    readonly broadcast: (event: ServerEvent) => void;
    /** Resolved absolute path to the playwright-cli pick-element script.
     *  Threaded as a dep so the class doesn't reach into __dirname. */
    readonly pickScriptPath: string;
    /** Fallback CDP port from config when chrome handle is missing. */
    readonly fallbackCdpPort: number;
}

// Pulled out as a top-level constant so test mocks can construct an
// AgentSession with predictable reqId generation.
const newReqId = () => Math.random().toString(36).slice(2);

export class AgentSession {
    private state: AgentState = "idle";
    private sdk: CopilotSession | null = null;
    private abortCtrl: AbortController | null = null;
    // True when the next sendOnPause rejection should be silent (Continue
    // swap teardown surfaces "[aborted by user]" otherwise — misleading).
    private suppressNextAbortChat = false;
    // Dedupe latch on failure.pausedAt — protects against double-fire
    // when the same paused snapshot triggers multiple "change" events
    // (e.g. consumer re-emits during a save). undefined means "no prior
    // pause observed" so the first real timestamp always lands.
    private lastPausedAt: number | undefined = undefined;

    private readonly editResolvers = new Map<string, PendingResolver<{ approved: boolean; reason?: string }>>();
    private readonly pickResolvers = new Map<string, PendingResolver<Record<string, unknown>>>();
    private readonly askResolvers = new Map<string, PendingResolver<{ choice: string | null; freeText: string | null }>>();
    // PIDs of in-flight playwright-cli pick subprocesses, keyed by reqId.
    // Lets cancelPick / tearDown kill the right child without leaking
    // handles after natural completion.
    private readonly pickPids = new Map<string, number>();

    constructor(private readonly deps: AgentSessionDeps) {}

    getState(): AgentState {
        return this.state;
    }

    isTornDown(): boolean {
        return this.state === "torn-down";
    }

    /**
     * Create the underlying SDK session and install listeners. Must be
     * called exactly once per AgentSession instance. Throws if the
     * SDK fails to create a session (caller decides whether to retry
     * or surface an error event).
     */
    async setup(): Promise<void> {
        if (this.state !== "idle") {
            throw new Error(`AgentSession.setup invalid in state=${this.state}`);
        }
        this.state = "creating";
        let sdk: CopilotSession;
        try {
            sdk = await this.deps.copilot.createSession(
                buildSessionConfig({
                    tools: this.buildTools(),
                    // Permission shims — the tool handlers above already
                    // funnel through this.editResolvers / this.pickResolvers
                    // so these callbacks never observe a real decision.
                    onPick: () => Promise.resolve({}),
                    onEdit: async () => ({ approved: true }),
                }),
            );
        } catch (e) {
            this.state = "torn-down";
            throw e;
        }
        // Setup/teardown race: createSession is async and Stop can fire
        // while we're awaiting it. tearDown flips state → "torn-down"
        // before we observe the resolution; if we proceed to assign sdk +
        // install listeners + flip state to "ready", the SDK session
        // is leaked (no longer reachable from the index.ts ref). Detect
        // and immediately disconnect the orphan.
        // Cast through AgentState — TS only sees straight-line setup() code
        // and assumes state stayed "creating". A concurrent tearDown() from
        // a separate async stack can have flipped it to "torn-down" while
        // we awaited createSession.
        if ((this.state as AgentState) === "torn-down") {
            try { await sdk.abort(); } catch { /* ignore */ }
            try { await sdk.disconnect(); } catch { /* ignore */ }
            return;
        }
        this.sdk = sdk;
        this.installSdkListeners(sdk);
        this.state = "ready";
    }

    /**
     * Send the paused-failure prompt to the agent and wait for it to
     * idle (or for tearDown to break the race). Caller invokes this
     * when the session manager transitions into "paused".
     *
     * No-op (and no broadcast) if the agent isn't `ready` — guards
     * against late "change" events firing after tearDown.
     */
    async sendOnPause(failure: FailureInfo): Promise<void> {
        if (this.state !== "ready" || !this.sdk) return;
        const at = failure.pausedAt;
        if (at !== undefined && at === this.lastPausedAt) return;
        this.lastPausedAt = at;
        this.state = "sending";
        const ac = new AbortController();
        this.abortCtrl = ac;
        let aborted = false;
        this.deps.broadcast({ type: "agent_thinking", active: true });
        try {
            const abortPromise = new Promise<never>((_, reject) => {
                if (ac.signal.aborted) reject(ac.signal.reason as Error);
                else ac.signal.addEventListener("abort", () => reject(ac.signal.reason as Error), { once: true });
            });
            const cfg = this.deps.config();
            await Promise.race([
                abortPromise,
                this.sdk.sendAndWait(
                    { prompt: this.buildPausePrompt(failure) },
                    cfg.idleTimeoutMs,
                ),
            ]);
        } catch (e) {
            aborted = ac.signal.aborted;
            if (aborted) {
                if (!this.suppressNextAbortChat) {
                    this.deps.broadcast({ type: "chat_final", content: "[aborted by user]" });
                }
                this.suppressNextAbortChat = false;
            } else if (!this.isTornDown()) {
                // Genuine SDK error path. The teardown one is silent.
                const msg = e instanceof Error ? e.message : String(e);
                this.deps.broadcast({ type: "error", message: `Agent send: ${msg}` });
                console.error("AgentSession.sendOnPause failed:", e);
            }
        } finally {
            this.abortCtrl = null;
            // Only return to `ready` if we weren't torn down mid-flight.
            if (this.state === "sending") this.state = "ready";
            this.deps.broadcast({ type: "agent_thinking", active: false });
            this.deps.broadcast({ type: "agent_activity", label: "" });
        }
    }

    /**
     * Atomic teardown: trips the local sendAndWait race, RPCs abort to
     * the CLI, disconnects the session, drains tool resolvers, and
     * kills in-flight pick subprocesses.
     *
     * `suppressChat`: true when the caller is a Continue swap (the
     * teardown is internal, not user-initiated). Skips the
     * "[aborted by user]" chat line that sendOnPause would otherwise
     * emit on the abort path.
     *
     * Idempotent — safe to call multiple times. State becomes
     * `torn-down` after the first successful call; subsequent calls
     * short-circuit.
     */
    async tearDown(opts: { reason: string; suppressChat?: boolean } = { reason: "teardown" }): Promise<void> {
        if (this.state === "torn-down") return;
        const wasSending = this.state === "sending";
        this.suppressNextAbortChat = opts.suppressChat ?? false;
        this.state = "torn-down";
        if (this.abortCtrl && wasSending) {
            this.abortCtrl.abort(new Error(opts.reason));
        }
        const sdk = this.sdk;
        this.sdk = null;
        if (sdk) {
            try { await sdk.abort(); } catch { /* ignore */ }
            try { await sdk.disconnect(); } catch { /* ignore */ }
        }
        this.drainAllResolvers();
        await this.killAllPicks();
        // Defensive UI clear: if abortCtrl was never tripped (sendOnPause
        // already resolved or never fired), the spinner sticks. Force-
        // clear so the lifetime owner gives the user agency back.
        this.deps.broadcast({ type: "agent_thinking", active: false });
        this.deps.broadcast({ type: "agent_activity", label: "" });
    }

    // ── Tool callback resolvers — invoked by WS command handlers ────

    resolveEditDecision(reqId: string, approved: boolean, reason?: string): void {
        const resolver = this.editResolvers.get(reqId);
        if (!resolver) return;
        this.editResolvers.delete(reqId);
        resolver.resolve({ approved, reason });
    }

    async cancelPick(reqId: string): Promise<void> {
        const pid = this.pickPids.get(reqId);
        if (pid) {
            try { await killTree(pid); } catch { /* already gone */ }
            this.pickPids.delete(reqId);
        }
        const resolver = this.pickResolvers.get(reqId);
        if (!resolver) return;
        this.pickResolvers.delete(reqId);
        this.deps.broadcast({ type: "pick_done", reqId });
        resolver.reject(new Error("pick cancelled by QA"));
    }

    resolvePromptResponse(reqId: string, choice: string | null, freeText: string | null): void {
        const resolver = this.askResolvers.get(reqId);
        if (!resolver) return;
        this.askResolvers.delete(reqId);
        resolver.resolve({ choice, freeText });
    }

    // ── Internals ────────────────────────────────────────────────────

    private buildTools(): Tool<any>[] {
        const tools: Tool<any>[] = [
            makeEditFileTool({
                onPropose: (file, oldCode, newCode) => {
                    if (this.isTornDown()) {
                        return Promise.reject(new Error("agent session torn down"));
                    }
                    const reqId = newReqId();
                    return new Promise((resolve, reject) => {
                        this.editResolvers.set(reqId, { resolve, reject });
                        this.deps.broadcast({ type: "diff", reqId, file, oldCode, newCode });
                    });
                },
            }),
            makePickElementTool({
                onPick: (hint) => this.runPickElement(hint),
            }),
            makeAskUserTool({
                onAsk: (summary, options, allowFreeText) => {
                    if (this.isTornDown()) {
                        return Promise.reject(new Error("agent session torn down"));
                    }
                    // Manual mode always allows free text so QA can surface
                    // context the agent's CDP inspection can't see; force it
                    // here so a model that disables it in args can't override
                    // the mode. Read mode live so a settings_update during a
                    // paused turn takes effect on the next tool call.
                    const effectiveAllowFreeText =
                        this.deps.config().mode === "manual" ? true : allowFreeText;
                    const reqId = newReqId();
                    return new Promise((resolve, reject) => {
                        this.askResolvers.set(reqId, { resolve, reject });
                        this.deps.broadcast({
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
        return tools as Tool<any>[];
    }

    private runPickElement(hint: string): Promise<Record<string, unknown>> {
        if (this.isTornDown()) {
            return Promise.reject(new Error("agent session torn down"));
        }
        const reqId = newReqId();
        const sessionName = `dgui_pick_${reqId}`;
        const cdpPort = this.deps.cdpPort() || this.deps.fallbackCdpPort;
        this.deps.broadcast({ type: "pick", reqId, hint });
        return new Promise<Record<string, unknown>>((resolve, reject) => {
            this.pickResolvers.set(reqId, { resolve, reject });
            const cmd = [
                `npx playwright-cli attach --cdp="http://localhost:${cdpPort}" --session=${sessionName}`,
                `npx playwright-cli -s=${sessionName} --raw run-code --filename="${this.deps.pickScriptPath}"`,
            ].join(" && ");
            const child = spawn(cmd, { shell: true, env: process.env });
            if (child.pid) this.pickPids.set(reqId, child.pid);
            let stdout = "";
            let stderr = "";
            child.stdout?.on("data", (b) => { stdout += b.toString(); });
            child.stderr?.on("data", (b) => { stderr += b.toString(); });
            const cleanup = () => {
                // best-effort detach so the session daemon doesn't outlive
                // this pick. Errors here are silent — the session may
                // already be gone.
                spawn(`npx playwright-cli -s=${sessionName} detach`, {
                    shell: true,
                    env: process.env,
                    stdio: "ignore",
                });
            };
            child.on("exit", (code) => {
                this.pickPids.delete(reqId);
                const r = this.pickResolvers.get(reqId);
                if (!r) { cleanup(); return; }
                this.pickResolvers.delete(reqId);
                this.deps.broadcast({ type: "pick_done", reqId });
                if (code !== 0) {
                    cleanup();
                    r.reject(new Error(`pick-element exited ${code}: ${(stderr || stdout).trim().slice(-500)}`));
                    return;
                }
                // pick-element.js outputs a single JSON object on the last
                // line. Grab the last {...} block.
                const jsonMatch = stdout.match(/\{[\s\S]*\}\s*$/);
                cleanup();
                if (!jsonMatch) {
                    r.reject(new Error(`pick-element no JSON in stdout: ${stdout.trim().slice(-500)}`));
                    return;
                }
                try {
                    r.resolve(JSON.parse(jsonMatch[0]));
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    r.reject(new Error(`pick-element JSON parse: ${msg}`));
                }
            });
            child.on("error", (e) => {
                this.pickPids.delete(reqId);
                cleanup();
                const r = this.pickResolvers.get(reqId);
                if (!r) return;
                this.pickResolvers.delete(reqId);
                this.deps.broadcast({ type: "pick_done", reqId });
                r.reject(e);
            });
        });
    }

    private installSdkListeners(sdk: CopilotSession): void {
        // String-typed `on(handler)` overload — the SDK accepts this verbatim
        // (verified at refs/copilot-sdk/dist/session.d.ts:183). Each handler
        // checks isTornDown so stale events buffered post-disconnect can't
        // bleed through. (The handlers close over `this`; the AgentSession's
        // own torn-down gate is the trim that the disposed SDK reference
        // alone can't provide.)
        sdk.on((ev) => {
            if (this.isTornDown()) return;
            const data = ev as { type: string; data?: { content?: string; name?: string; tool?: string } };
            if (data.type === "assistant.message") {
                const content = data.data?.content ?? "";
                if (content) this.deps.broadcast({ type: "chat_final", content });
                return;
            }
            if (data.type === "command.execute") {
                const name = data.data?.name ?? data.data?.tool ?? "tool";
                this.deps.broadcast({ type: "agent_activity", label: `calling ${name}` });
                return;
            }
            if (data.type === "command.completed") {
                this.deps.broadcast({ type: "agent_activity", label: "" });
                return;
            }
        });
    }

    private drainAllResolvers(): void {
        // Order: reject before broadcasting clears so the agent-side promise
        // wakes first; the broadcast just clears UI state that was driven
        // by these resolvers.
        for (const reqId of this.askResolvers.keys()) {
            this.deps.broadcast({ type: "prompt_done", reqId });
        }
        drainResolvers(this.editResolvers);
        drainResolvers(this.pickResolvers);
        drainResolvers(this.askResolvers);
    }

    private async killAllPicks(): Promise<void> {
        const entries = [...this.pickPids.entries()];
        this.pickPids.clear();
        for (const [reqId, pid] of entries) {
            try { await killTree(pid); } catch { /* already gone */ }
            this.deps.broadcast({ type: "pick_done", reqId });
        }
    }

    private buildPausePrompt(f: FailureInfo): string {
        const port = this.deps.cdpPort() || this.deps.fallbackCdpPort;
        const manualPreamble =
            this.deps.config().mode === "manual"
                ? "You are in MANUAL mode. Always call ask_user before edit_file — the walkthrough SKILL describes the conversation pattern.\n\n"
                : "";
        return (
            manualPreamble +
            `A mocha test just failed and the walkthrough hook paused execution.\n\n` +
            `Failure details:\n` +
            `  test:  ${f.test}\n` +
            `  suite: ${f.suite ?? "(none)"}\n` +
            `  file:  ${f.file}\n` +
            `  error: ${f.error}\n` +
            `  stack:\n${f.stack}\n\n` +
            `The test browser is reachable via CDP at http://localhost:${port}.\n\n` +
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
            `picks up your edit.`
        );
    }
}
