import http from "http";
import { WebSocketServer } from "ws";
import open from "open";
import { loadConfig } from "./config.js";
import { discoverSuites } from "./discovery.js";
import { SessionManager } from "./session.js";
import { HookerClient } from "./hooker.js";
import { MochaRunner, buildMochaCommand } from "./runner.js";
import { Orchestrator } from "./orchestrator.js";
import { createApp, WsHub } from "./server.js";
import { buildSessionConfig } from "./agent.js";
import { makeEditFileTool } from "./tools/editFile.js";
import { makePickElementTool } from "./tools/pickElement.js";
import { CopilotClient } from "@github/copilot-sdk";

export const VERSION = "0.0.1";

export async function main(cwd: string = process.cwd(), port: number = 5555): Promise<void> {
    const config = loadConfig(cwd);
    const suites = discoverSuites(cwd, {
        globs: config.discovery.globs,
        exclude: config.mocha.exclude,
    });

    const session = new SessionManager();
    const hooker = new HookerClient(config.walkthroughPort);
    const orch = new Orchestrator(session, hooker);
    const runner = new MochaRunner();
    const hub = new WsHub();

    const editResolvers = new Map<string, (d: { approved: boolean; reason?: string }) => void>();
    const pickResolvers = new Map<string, (attrs: Record<string, unknown>) => void>();

    const app = createApp({
        cwd,
        loadInit: () => ({ suites, config, state: session.getState() }),
    });
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

    const copilot = new CopilotClient();
    await copilot.start();

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
            onPick: (hint) => {
                const reqId = Math.random().toString(36).slice(2);
                const imageUrl = "";
                return new Promise((resolve) => {
                    pickResolvers.set(reqId, resolve);
                    hub.broadcast({ type: "pick", reqId, imageUrl, hint });
                });
            },
        }),
    ];

    hub.onMessage(async (cmd) => {
        if (cmd.type === "run") {
            const spec = suites.find((s) => s.relPath === cmd.spec)?.absPath;
            if (!spec) return;
            const mochaCmd = buildMochaCommand({
                spec,
                walkthroughPort: config.walkthroughPort,
                mocha: config.mocha,
            });
            runner.start(mochaCmd);
            session.markRunning(cmd.spec);
            orch.start(500);

            const agentSession = await copilot.createSession(
                buildSessionConfig({
                    cwd,
                    tools,
                    onPick: () => Promise.resolve({}),
                    onEdit: async () => ({ approved: true }),
                })
            );

            session.events.once("change", async (snap) => {
                if (snap.state === "paused") {
                    await agentSession.send({
                        prompt: "A test just failed. Read /paused via curl, then follow the walkthrough SKILL to investigate and propose fixes.",
                    });
                }
            });
        }
        if (cmd.type === "diff_decision") {
            const resolver = editResolvers.get(cmd.reqId);
            if (resolver) {
                resolver({ approved: cmd.action === "approved", reason: cmd.reason });
                editResolvers.delete(cmd.reqId);
            }
        }
        if (cmd.type === "pick_result") {
            const resolver = pickResolvers.get(cmd.reqId);
            if (resolver) {
                resolver(cmd.attrs);
                pickResolvers.delete(cmd.reqId);
            }
        }
        if (cmd.type === "cancel") {
            runner.kill();
            orch.stop();
            session.reset();
        }
    });

    httpServer.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`Debug GUI ready at ${url}`);
        open(url).catch(() => console.log(`Open ${url} in your browser`));
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const port = process.env.PORT ? Number(process.env.PORT) : 5555;
    main(process.cwd(), port).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
