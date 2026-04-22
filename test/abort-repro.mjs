// Reproduction: does abort() make sendAndWait reject/resolve when the
// agent is waiting on a tool handler that hasn't returned yet? This
// matches real walkthrough behavior where pickElement/editFile tools
// resolve only after QA clicks in the GUI.

import { CopilotClient, approveAll } from "@github/copilot-sdk";

const t0 = Date.now();
const ts = () => `[${String(Date.now() - t0).padStart(6)}ms]`;

const copilot = new CopilotClient();
await copilot.start();
console.log(ts(), "copilot started");

// A tool the agent will likely call. It returns a Promise that NEVER
// resolves — emulating pickElement waiting for a QA click.
let toolCalled = false;
const blockingTool = {
    name: "wait_for_qa",
    description: "Wait for QA to click something. Call this immediately.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
        toolCalled = true;
        console.log(ts(), "TOOL handler invoked — blocking forever");
        return new Promise(() => {});
    },
};

const session = await copilot.createSession({
    onPermissionRequest: approveAll,
    tools: [blockingTool],
});
console.log(ts(), "session created", session.sessionId);

session.on((event) => {
    console.log(ts(), "EVENT", event.type);
});

const sendPromise = session
    .sendAndWait(
        { prompt: "Call the wait_for_qa tool right now. Do not say anything else first." },
        60_000,
    )
    .then((r) => {
        console.log(ts(), "sendAndWait RESOLVED", r?.data?.content?.slice(0, 60));
        return "resolved";
    })
    .catch((e) => {
        console.log(ts(), "sendAndWait REJECTED", e?.message ?? e);
        return "rejected";
    });

// Wait until the tool is actually in-flight, then abort.
await new Promise((r) => setTimeout(r, 6000));
console.log(ts(), `toolCalled=${toolCalled}, calling abort()...`);
try {
    await session.abort();
    console.log(ts(), "abort() resolved");
} catch (e) {
    console.log(ts(), "abort() threw:", e?.message ?? e);
}

const outcome = await Promise.race([
    sendPromise,
    new Promise((r) => setTimeout(() => r("still-hanging-after-10s"), 10_000)),
]);
console.log(ts(), "outcome:", outcome);

await session.disconnect().catch(() => {});
console.log(ts(), "done");
process.exit(0);
