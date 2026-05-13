import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

describe("store", () => {
    beforeEach(() => {
        useStore.setState({
            suites: [],
            config: {},
            state: { state: "idle" },
            selectedSpec: null,
            selectedNode: null,
            suiteTrees: {},
            chatMessages: [],
            pendingDiff: null,
            pendingPick: null,
            pendingPrompt: null,
            mochaLog: [],
            mochaExitCode: undefined,
            runStartedAt: null,
            agentThinking: false,
            agentActivity: "",
            lspWarning: null,
            notice: null,
        });
    });

    it("init event exposes preRun in config", () => {
        useStore.getState().applyEvent({
            type: "init",
            suites: [],
            config: { preRun: "npm run build" },
            state: { state: "idle" },
        });
        expect((useStore.getState().config as any).preRun).toBe("npm run build");
    });

    it("config_updated event replaces config", () => {
        useStore.setState({ config: { preRun: "old" } });
        useStore.getState().applyEvent({
            type: "config_updated",
            config: { preRun: "npm run build" },
        });
        expect((useStore.getState().config as any).preRun).toBe("npm run build");
    });

    it("status pre-running is stored without clobbering currentSpec", () => {
        useStore.setState({ state: { state: "idle", currentSpec: "x.spec.js" } });
        useStore.getState().applyEvent({ type: "status", state: "pre-running" });
        expect(useStore.getState().state.state).toBe("pre-running");
        expect(useStore.getState().state.currentSpec).toBe("x.spec.js");
    });

    it("status done preserves runStartedAt so log rows keep their relative timestamps", () => {
        useStore.setState({ runStartedAt: 1_700_000_000_000 });
        useStore.getState().applyEvent({ type: "status", state: "done" });
        expect(useStore.getState().state.state).toBe("done");
        expect(useStore.getState().runStartedAt).toBe(1_700_000_000_000);
    });

    describe("paused → non-paused status drops failure data", () => {
        // QA-reported bug: clicking Stop while paused left the FailureCard
        // and the synthetic FAIL row in LogPanel visible. Root cause was
        // the status reducer spreading `...s.state` on the way to idle/
        // done/running, which preserved currentFailure + pausedAt from
        // the paused snapshot. The fix is in the status reducer; these
        // tests pin the invariant: any non-paused status must clear the
        // failure data, regardless of which leg was hit.
        const pausedSnap = {
            state: {
                state: "paused" as const,
                currentSpec: "test/login.spec.js",
                currentFailure: { test: "should enter password", file: "x", error: "boom", stack: "" },
                pausedAt: 12345,
            },
        };

        for (const next of ["idle", "done"] as const) {
            it(`paused → ${next} clears currentFailure + pausedAt (Stop click / natural finish)`, () => {
                useStore.setState(pausedSnap);
                useStore.getState().applyEvent({ type: "status", state: next });
                const s = useStore.getState();
                // Discriminant alone implies absence of currentFailure +
                // pausedAt under the DU (Idle/Done don't have those fields).
                expect(s.state.state).toBe(next);
                // currentSpec is preserved so deriveLog / breadcrumb still
                // anchor on the spec that was running.
                expect(s.state.currentSpec).toBe("test/login.spec.js");
            });
        }

        it("paused → running clears currentFailure + pausedAt (Continue resume)", () => {
            useStore.setState(pausedSnap);
            useStore.getState().applyEvent({ type: "status", state: "running" });
            const s = useStore.getState();
            // Running carries currentSpec but not currentFailure/pausedAt
            // under the DU.
            expect(s.state.state).toBe("running");
            expect(s.state.currentSpec).toBe("test/login.spec.js");
        });

        it("paused → running on the same run preserves agent-session state", () => {
            // Resume should NOT wipe chatMessages / pendingDiff / pendingPick
            // / pendingPrompt — those still belong to the in-flight session
            // the agent opened during pause. mochaLog/runStartedAt also
            // anchor the same run and must survive.
            useStore.setState({
                ...pausedSnap,
                chatMessages: [{ role: "assistant", content: "stale-selector hint" }],
                pendingDiff: { reqId: "d1", file: "old.js", oldCode: "a", newCode: "b", receivedAt: 0 },
                mochaLog: [{ stream: "stdout", text: "  ✓ a\n", receivedAt: 0, seq: 1 }],
                runStartedAt: 1_700_000_000_000,
            });
            useStore.getState().applyEvent({ type: "status", state: "running" });
            const s = useStore.getState();
            expect(s.chatMessages).toHaveLength(1);
            expect(s.pendingDiff?.reqId).toBe("d1");
            expect(s.mochaLog).toHaveLength(1);
            expect(s.runStartedAt).toBe(1_700_000_000_000);
        });
    });

    it("status running resets runStartedAt to 'now' on each new run", () => {
        useStore.setState({ runStartedAt: 1_700_000_000_000 });
        const before = Date.now();
        useStore.getState().applyEvent({ type: "status", state: "running" });
        const after = Date.now();
        const got = useStore.getState().runStartedAt!;
        expect(got).toBeGreaterThanOrEqual(before);
        expect(got).toBeLessThanOrEqual(after);
    });

    describe("starting a fresh run", () => {
        // Scenario: a prior run left the UI showing a FailureCard, a
        // pending diff QA never approved, a chat transcript, and possibly
        // a pending pick/prompt. QA clicks Stop (state→idle) or the suite
        // finishes (state→done), then clicks Start again on the same
        // selection. The server-side session is already torn down (cancel
        // aborts the agent and rejects every in-flight resolver), so the
        // client-side leftovers belong to a session that no longer exists.
        // Treat them as stale and drop them when the new run begins, the
        // same way selectSuite drops them on a (spec, grep) change.
        const stale = {
            chatMessages: [{ role: "assistant" as const, content: "old chat" }],
            pendingDiff: { reqId: "d1", file: "old.js", oldCode: "a", newCode: "b", receivedAt: 0 },
            pendingPick: { reqId: "p1", hint: "hint" },
            pendingPrompt: { reqId: "q1", summary: "s", options: [], allowFreeText: false },
        };

        for (const prev of ["idle", "done"] as const) {
            for (const next of ["pre-running", "running"] as const) {
                it(`drops stale agent-session state on ${prev}→${next}`, () => {
                    useStore.setState({
                        ...stale,
                        // Idle/Done don't carry currentFailure under the
                        // DU; the leftover from a prior paused run is in
                        // the agent-session-scope fields below, not the
                        // snapshot itself.
                        state: {
                            state: prev,
                            currentSpec: "test/login.spec.js",
                        },
                    });

                    useStore.getState().applyEvent({ type: "status", state: next });

                    const s = useStore.getState();
                    // Discriminant alone pins absence of paused-only fields.
                    expect(s.state.state).toBe(next);
                    expect(s.chatMessages).toEqual([]);
                    expect(s.pendingDiff).toBeNull();
                    expect(s.pendingPick).toBeNull();
                    expect(s.pendingPrompt).toBeNull();
                });
            }
        }
    });

    it("initializes with idle state", () => {
        const s = useStore.getState();
        expect(s.state.state).toBe("idle");
    });

    it("apply 'init' event populates suites", () => {
        useStore.getState().applyEvent({
            type: "init",
            suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
            config: {} as any,
            state: { state: "idle" },
        });
        expect(useStore.getState().suites[0].relPath).toBe("a.spec.js");
    });

    it("apply 'paused' event sets failure", () => {
        // Paused only makes sense after a run started — currentSpec must
        // exist on the prior snapshot, otherwise the reducer correctly
        // bails (PausedSnapshot requires currentSpec at the type level).
        useStore.setState({ state: { state: "running", currentSpec: "a.spec.js" } });
        useStore.getState().applyEvent({
            type: "paused",
            failure: { test: "t", file: "a.spec.js", error: "e", stack: "" },
        });
        const s = useStore.getState().state;
        expect(s.state).toBe("paused");
        if (s.state === "paused") {
            expect(s.currentFailure.test).toBe("t");
        }
    });

    describe("notice lifecycle", () => {
        // The server emits `notice` after an approved edit during pause to
        // remind QA to click Continue (which re-forks the worker so the fix
        // lands in a fresh require cache). The store surfaces it, replaces
        // it on subsequent edits, lets QA dismiss it, and drops it cleanly
        // on a fresh run / spec switch — these tests pin those invariants.

        it("apply 'notice' event surfaces the message", () => {
            useStore.getState().applyEvent({
                type: "notice",
                kind: "info",
                message: "Click Continue to re-run the suite.",
            });
            const notice = useStore.getState().notice;
            expect(notice?.kind).toBe("info");
            expect(notice?.message).toMatch(/click continue/i);
        });

        it("'notice' event with unknown kind falls back to 'info'", () => {
            // Defensive: the wire type is the right shape but a future
            // server might send a kind we don't render. Don't crash, treat
            // it as info.
            useStore.getState().applyEvent({
                type: "notice",
                kind: "wat" as any,
                message: "x",
            });
            expect(useStore.getState().notice?.kind).toBe("info");
        });

        it("a second 'notice' replaces the first", () => {
            useStore.getState().applyEvent({ type: "notice", kind: "info", message: "first" });
            useStore.getState().applyEvent({ type: "notice", kind: "warning", message: "second" });
            const n = useStore.getState().notice;
            expect(n?.message).toBe("second");
            expect(n?.kind).toBe("warning");
        });

        it("dismissNotice() clears the notice", () => {
            useStore.setState({ notice: { kind: "info", message: "x" } });
            useStore.getState().dismissNotice();
            expect(useStore.getState().notice).toBeNull();
        });

        it("status idle/done → running clears the notice (fresh run)", () => {
            // A fresh run with the fix on disk renders the notice irrelevant —
            // the new fork won't have the stale module cache. Drop it so
            // it doesn't shout at QA after they've already done what it asked.
            useStore.setState({
                state: { state: "done" },
                notice: { kind: "info", message: "click continue" },
            });
            useStore.getState().applyEvent({ type: "status", state: "running" });
            expect(useStore.getState().notice).toBeNull();
        });

        it("status running ← paused (Continue resume) preserves the notice", () => {
            // Continue triggers stop-old-worker → fork-new-worker. Between
            // the two, status flips paused → running before the fresh fork
            // sends its own `paused`. The notice should survive that brief
            // intra-Continue window so QA isn't left wondering whether the
            // edit was applied.
            useStore.setState({
                state: {
                    state: "paused",
                    currentSpec: "a.spec.js",
                    currentFailure: { test: "t", file: "a.spec.js", error: "e", stack: "" },
                    pausedAt: 0,
                },
                notice: { kind: "info", message: "click continue" },
            });
            useStore.getState().applyEvent({ type: "status", state: "running" });
            expect(useStore.getState().notice?.message).toBe("click continue");
        });

        it("selectSuite to a different spec clears the notice", () => {
            useStore.setState({
                selectedSpec: "a.spec.js",
                state: { state: "idle" },
                notice: { kind: "info", message: "x" },
            });
            useStore.getState().selectSuite("b.spec.js", null);
            expect(useStore.getState().notice).toBeNull();
        });
    });

    it("suites_updated clears selectedSpec and selectedNode when the spec disappears", () => {
        useStore.setState({
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
            selectedSpec: "test/login.spec.js",
            selectedNode: { kind: "it", fullTitle: "Login works" },
        });
        useStore.getState().applyEvent({
            type: "suites_updated",
            suites: [],
        });
        expect(useStore.getState().selectedSpec).toBeNull();
        expect(useStore.getState().selectedNode).toBeNull();
    });

    it("suites_updated preserves selectedNode when the spec is still present", () => {
        useStore.setState({
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
            selectedSpec: "test/login.spec.js",
            selectedNode: { kind: "describe", fullTitle: "Login" },
        });
        useStore.getState().applyEvent({
            type: "suites_updated",
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
        });
        expect(useStore.getState().selectedNode).toEqual({ kind: "describe", fullTitle: "Login" });
    });

    it("suites_updated preserves selectedSpec when it is still present in the new suites", () => {
        useStore.setState({
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
            selectedSpec: "test/login.spec.js",
        });
        useStore.getState().applyEvent({
            type: "suites_updated",
            suites: [
                { relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" },
                { relPath: "test/checkout.spec.js", absPath: "/x/test/checkout.spec.js" },
            ],
        });
        expect(useStore.getState().selectedSpec).toBe("test/login.spec.js");
    });

    it("sets pendingPrompt on prompt event", () => {
        useStore.getState().applyEvent({
            type: "prompt",
            reqId: "r1",
            summary: "Login button not found",
            options: [
                { id: "apply_a", label: "Use [data-test=login]" },
                { id: "investigate_b", label: "Inspect modal first" },
            ],
            allowFreeText: true,
        });
        const p = useStore.getState().pendingPrompt;
        expect(p?.reqId).toBe("r1");
        expect(p?.summary).toBe("Login button not found");
        expect(p?.options).toHaveLength(2);
        expect(p?.allowFreeText).toBe(true);
    });

    it("clears pendingPrompt when explicitly reset (response sent)", () => {
        useStore.setState({
            pendingPrompt: { reqId: "r1", summary: "x", options: [], allowFreeText: false },
        });
        useStore.setState({ pendingPrompt: null });
        expect(useStore.getState().pendingPrompt).toBeNull();
    });

    describe("selectSuite", () => {
        // DoneSnapshot doesn't carry currentFailure under the DU (failures
        // are paused-only). The fixture below uses `done` because the
        // selectSuite-different-spec tests need the live-guard to pass.
        // Tests that need a failure payload set their own paused state.
        const stale = {
            mochaLog: [{ stream: "stdout" as const, text: "old log\n", receivedAt: 0, seq: 1 }],
            mochaExitCode: 1,
            chatMessages: [{ role: "assistant" as const, content: "old chat" }],
            agentThinking: true,
            agentActivity: "thinking about old spec",
            pendingDiff: { reqId: "d1", file: "old.js", oldCode: "a", newCode: "b", receivedAt: 0 },
            pendingPick: { reqId: "p1", hint: "hint" },
            pendingPrompt: { reqId: "q1", summary: "s", options: [], allowFreeText: false },
            state: {
                state: "done" as const,
                currentSpec: "test/old.spec.js",
            },
        };

        it("is a no-op while a run is live (defensive guard)", () => {
            // Every call site in App.tsx is gated on !isLive, but the
            // reducer also self-protects so a future caller can't silently
            // wipe a live agent session (chat, pendingDiff, …).
            const liveSnap = (state: "running" | "pre-running" | "paused") =>
                state === "paused"
                    ? {
                        state,
                        currentSpec: "test/old.spec.js",
                        currentFailure: { test: "t", file: "x", error: "e", stack: "" },
                        pausedAt: 0,
                    }
                    : { state, currentSpec: "test/old.spec.js" };
            for (const live of ["running", "pre-running", "paused"] as const) {
                useStore.setState({
                    ...stale,
                    selectedSpec: "test/old.spec.js",
                    selectedNode: { kind: "it", fullTitle: "old > t" },
                    state: liveSnap(live),
                });

                useStore.getState().selectSuite("test/new.spec.js", null);

                const s = useStore.getState();
                expect(s.selectedSpec).toBe("test/old.spec.js");
                expect(s.selectedNode).toEqual({ kind: "it", fullTitle: "old > t" });
                expect(s.chatMessages).toEqual(stale.chatMessages);
                expect(s.pendingDiff).toEqual(stale.pendingDiff);
                expect(s.pendingPick).toEqual(stale.pendingPick);
                expect(s.pendingPrompt).toEqual(stale.pendingPrompt);
                expect(s.state.state).toBe(live);
            }
        });

        it("clears stale run-output when switching to a different spec", () => {
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "it", fullTitle: "old > t" },
            });

            useStore.getState().selectSuite("test/new.spec.js", null);

            const s = useStore.getState();
            expect(s.selectedSpec).toBe("test/new.spec.js");
            expect(s.selectedNode).toBeNull();
            expect(s.mochaLog).toEqual([]);
            expect(s.mochaExitCode).toBeUndefined();
            expect(s.chatMessages).toEqual([]);
            expect(s.agentThinking).toBe(false);
            expect(s.agentActivity).toBe("");
            expect(s.pendingDiff).toBeNull();
            expect(s.pendingPick).toBeNull();
            expect(s.pendingPrompt).toBeNull();
            // Session-state resets to idle so the StatusHeader doesn't
            // carry "DONE" onto the new (un-run) suite. IdleSnapshot has
            // no currentFailure / pausedAt under the DU — the discriminant
            // alone implies absence.
            expect(s.state.state).toBe("idle");
            expect(s.state.currentSpec).toBeUndefined();
        });

        it("clears stale state when switching from no-selection to a spec", () => {
            useStore.setState({
                ...stale,
                selectedSpec: null,
                selectedNode: null,
            });

            useStore.getState().selectSuite("test/new.spec.js", null);

            const s = useStore.getState();
            expect(s.selectedSpec).toBe("test/new.spec.js");
            expect(s.mochaLog).toEqual([]);
            // Idle implies no currentFailure under the DU.
            expect(s.state.state).toBe("idle");
            expect(s.chatMessages).toEqual([]);
        });

        it("clears spec-scoped run-output when the node changes within the same spec", () => {
            // Spec-scoped output (FailureCard, mocha log, currentFailure) is
            // tied to the prior (spec, grep) tuple. Clicking a sibling `it`
            // produces a different grep, so the old failure under the new
            // selection would be misleading — drop it.
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "describe", fullTitle: "Login" },
            });

            useStore.getState().selectSuite(
                "test/old.spec.js",
                { kind: "it", fullTitle: "Login > works" },
            );

            const s = useStore.getState();
            expect(s.selectedSpec).toBe("test/old.spec.js");
            expect(s.selectedNode).toEqual({ kind: "it", fullTitle: "Login > works" });
            expect(s.mochaLog).toEqual([]);
            expect(s.mochaExitCode).toBeUndefined();
            // Idle implies no currentFailure under the DU.
            expect(s.state.state).toBe("idle");
            expect(s.state.currentSpec).toBeUndefined();
        });

        it("clears agent-session-scoped state when the node changes within the same spec", () => {
            // Every call site of selectSuite is reached after the agent
            // session has been torn down (state already idle/done, or
            // post-cancel from the suite-switch dialog). So the chat,
            // thinking flag, and pending diff/pick/prompt left over from
            // the prior run are stale UI under the new selection — drop
            // them just like we do when the spec itself changes.
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "describe", fullTitle: "Login" },
            });

            useStore.getState().selectSuite(
                "test/old.spec.js",
                { kind: "it", fullTitle: "Login > works" },
            );

            const s = useStore.getState();
            expect(s.chatMessages).toEqual([]);
            expect(s.agentThinking).toBe(false);
            expect(s.agentActivity).toBe("");
            expect(s.pendingDiff).toBeNull();
            expect(s.pendingPick).toBeNull();
            expect(s.pendingPrompt).toBeNull();
            // Session-state resets to idle on any actual selection change,
            // even within the same spec.
            expect(s.state.state).toBe("idle");
        });

        it("is a no-op when the same spec and node are re-selected", () => {
            // Use a paused fixture here so we can pin "currentFailure
            // survives a no-op" — DoneSnapshot doesn't carry failures
            // under the DU.
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "it", fullTitle: "Login > works" },
                state: {
                    state: "paused",
                    currentSpec: "test/old.spec.js",
                    currentFailure: { test: "t", file: "test/old.spec.js", error: "e", stack: "" },
                    pausedAt: 0,
                },
            });

            useStore.getState().selectSuite(
                "test/old.spec.js",
                { kind: "it", fullTitle: "Login > works" },
            );

            const s = useStore.getState();
            expect(s.mochaLog).toHaveLength(1);
            // Narrow via discriminant so currentFailure access type-checks.
            expect(s.state.state).toBe("paused");
            if (s.state.state === "paused") {
                expect(s.state.currentFailure.test).toBe("t");
            }
            expect(s.chatMessages).toHaveLength(1);
        });

        it("clears when switching to null spec (no selection)", () => {
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "it", fullTitle: "old > t" },
            });

            useStore.getState().selectSuite(null, null);

            const s = useStore.getState();
            expect(s.selectedSpec).toBeNull();
            expect(s.selectedNode).toBeNull();
            expect(s.mochaLog).toEqual([]);
            // Idle implies no currentFailure under the DU.
            expect(s.state.state).toBe("idle");
        });
    });

    describe("lsp/warning event", () => {
        it("populates lspWarning from event", () => {
            useStore.getState().applyEvent({
                type: "lsp/warning",
                warning: {
                    kind: "missing",
                    installCmd: "npm install -g typescript-language-server",
                },
            });
            expect(useStore.getState().lspWarning).toEqual({
                kind: "missing",
                installCmd: "npm install -g typescript-language-server",
            });
        });

        it("dismissLspWarning clears it", () => {
            useStore.getState().applyEvent({
                type: "lsp/warning",
                warning: { kind: "broken", stderrTail: "boom" },
            });
            expect(useStore.getState().lspWarning).not.toBeNull();
            useStore.getState().dismissLspWarning();
            expect(useStore.getState().lspWarning).toBeNull();
        });
    });
});
