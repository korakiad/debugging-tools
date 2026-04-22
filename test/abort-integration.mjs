// Integration repro: wires up the actual server modules (SessionManager,
// CopilotClient, tools, the same onChange handler) without mocha/wdio,
// then injects a paused state and simulates a Stop click. Captures every
// WS broadcast so we can see whether agent_thinking:false is emitted.

import { CopilotClient, approveAll } from "@github/copilot-sdk";
import { SessionManager } from "../packages/debug-gui/server/dist/session.js";
import { makeEditFileTool } from "../packages/debug-gui/server/dist/tools/editFile.js";
import { makePickElementTool } from "../packages/debug-gui/server/dist/tools/pickElement.js";
import { buildSessionConfig } from "../packages/debug-gui/server/dist/agent.js";

const t0 = Date.now();
const ts = () => `[${String(Date.now() - t0).padStart(6)}ms]`;

// A fake hub that records every broadcast.
const broadcasts = [];
const hub = {
    broadcast(e) {
        broadcasts.push({ at: Date.now() - t0, e });
        console.log(ts(), "BROADCAST", JSON.stringify(e));
    },
};

const session = new SessionManager();

const copilot = new CopilotClient();
await copilot.start();
console.log(ts(), "copilot started");

let currentAgentSession = null;
let aborting = false;

const editResolvers = new Map();
const pickResolvers = new Map();

const tools = [
    makeEditFileTool({
        onPropose: (file, oldCode, newCode) => {
            const reqId = Math.random().toString(36).slice(2);
            return new Promise((resolve) => {
                editResolvers.set(reqId, resolve);
                hub.broadcast({ type: "diff", reqId, file, oldCode, newCode });
            });
        },
    }),
    makePickElementTool({
        onPick: async (hint) => {
            const reqId = Math.random().toString(36).slice(2);
            return new Promise((resolve) => {
                pickResolvers.set(reqId, resolve);
                hub.broadcast({ type: "pick", reqId, imageUrl: "", hint });
            });
        },
    }),
];

const agentSession = await copilot.createSession(
    buildSessionConfig({
        cwd: process.cwd(),
        tools,
        onPick: () => Promise.resolve({}),
        onEdit: async () => ({ approved: true }),
    }),
);
currentAgentSession = agentSession;
console.log(ts(), "agent session created");

agentSession.on("assistant.message", (ev) => {
    const content = ev?.data?.content ?? "";
    if (content) hub.broadcast({ type: "chat_final", content });
});
agentSession.on("command.execute", (ev) => {
    const name = ev?.data?.name ?? ev?.data?.tool ?? "tool";
    hub.broadcast({ type: "agent_activity", label: `calling ${name}` });
});
agentSession.on("command.completed", () => {
    hub.broadcast({ type: "agent_activity", label: "" });
});

let lastPausedAt = 0;
const onChange = async (snap) => {
    if (snap.state !== "paused" || !snap.currentFailure) return;
    const at = snap.currentFailure.pausedAt ?? 0;
    if (at === lastPausedAt) return;
    lastPausedAt = at;
    hub.broadcast({ type: "agent_thinking", active: true });
    try {
        await agentSession.sendAndWait(
            {
                prompt:
                    `A mocha test just failed and the walkthrough hook paused execution.\n` +
                    `Read .walkthrough/paused.json for full failure details. Follow the walkthrough SKILL: ` +
                    `inspect the live app via playwright-cli (CDP port 9222) ` +
                    `to find the correct selector/fix, then call edit_file. ` +
                    `After QA approves, write .walkthrough/continue to resume.`,
            },
            10 * 60 * 1000,
        );
        console.log(ts(), "sendAndWait returned normally");
    } catch (e) {
        if (aborting) {
            hub.broadcast({ type: "chat_final", content: "[aborted by user]" });
        } else {
            hub.broadcast({ type: "error", message: `Agent send: ${e?.message ?? e}` });
        }
    } finally {
        aborting = false;
        hub.broadcast({ type: "agent_thinking", active: false });
        hub.broadcast({ type: "agent_activity", label: "" });
    }
};
session.events.on("change", onChange);

// Trigger the paused state like the mocha hook would.
console.log(ts(), "injecting paused state");
session.markPaused({
    test: "should enter username",
    suite: "SauceDemo Login",
    file: "login.spec.js",
    error: "Can't call setValue on element with selector \"#username\"",
    stack: "Error: ...",
    pausedAt: Date.now(),
});

// Wait long enough for agent to start working / probably start a tool call.
await new Promise((r) => setTimeout(r, 8000));

// Simulate the Stop click — the exact same code as the server's agent_abort handler.
console.log(ts(), "simulating agent_abort");
if (currentAgentSession) {
    aborting = true;
    try {
        await currentAgentSession.abort();
        console.log(ts(), "abort() resolved");
    } catch (e) {
        aborting = false;
        console.log(ts(), "abort() threw:", e?.message ?? e);
    }
}

// Give the finally block a moment to run.
await new Promise((r) => setTimeout(r, 2000));

console.log(ts(), "=== SUMMARY ===");
console.log("Broadcasts received:");
for (const b of broadcasts) {
    console.log(`  +${b.at}ms`, JSON.stringify(b.e).slice(0, 120));
}

const hadThinkingOff = broadcasts.some(
    (b) => b.e.type === "agent_thinking" && b.e.active === false,
);
console.log(ts(), "agent_thinking:false was broadcast =", hadThinkingOff);

await agentSession.disconnect().catch(() => {});
process.exit(0);
