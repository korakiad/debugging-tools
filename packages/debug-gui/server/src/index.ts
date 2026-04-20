import http from "http";
import { WebSocketServer } from "ws";
import open from "open";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
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
import { captureScreenshot, SCREENSHOT_DIR } from "./screenshot.js";
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
    const suites = discoverSuites(cwd, {
        globs: config.discovery.globs,
        exclude: config.mocha.exclude,
    });

    const session = new SessionManager();
    const hooker = new HookerClient(cwd);
    const orch = new Orchestrator(session, hooker);
    const runner = new MochaRunner();
    const hub = new WsHub();

    runner.on("stdout", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stdout", text }));
    runner.on("stderr", (text: string) => hub.broadcast({ type: "mocha_log", stream: "stderr", text }));
    runner.on("exit", (code: number | null) => {
        hub.broadcast({ type: "mocha_exit", code });
        if (session.getState().state !== "paused") session.markDone();
    });

    const editResolvers = new Map<string, (d: { approved: boolean; reason?: string }) => void>();
    const pickResolvers = new Map<string, (attrs: Record<string, unknown>) => void>();

    const app = createApp({
        cwd,
        loadInit: () => ({ suites, config, state: session.getState() }),
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
            onPick: async (hint) => {
                const reqId = Math.random().toString(36).slice(2);
                let imageUrl = "";
                try {
                    const shot = await captureScreenshot(config.cdp.port);
                    imageUrl = `/api/screenshot/${encodeURIComponent(shot.id)}`;
                } catch {
                    // screenshot failure is non-fatal — the picker will still render a placeholder
                }
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
                customCommand,
            });
            runner.start(mochaCmd);
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
            } catch (e: any) {
                hub.broadcast({ type: "error", message: `Copilot session: ${e?.message ?? e}` });
                console.error("createSession failed:", e);
            }

            if (agentSession) {
                agentSession.on("assistant.message", (ev: any) => {
                    const content: string = ev?.data?.content ?? "";
                    if (content) hub.broadcast({ type: "chat_final", content });
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
                        await agentSession!.send({
                            prompt:
                                `A mocha test just failed and the walkthrough hook paused execution.\n` +
                                `Read .walkthrough/paused.json for full failure details ` +
                                `(test, file, error, stack). Follow the walkthrough SKILL: ` +
                                `inspect the live app via playwright-cli (CDP port ${config.cdp.port}) ` +
                                `to find the correct selector/fix, then call edit_file with the proposed change. ` +
                                `After QA approves or rejects, write .walkthrough/continue (empty file) ` +
                                `to resume the test runner.`,
                        });
                    } catch (e: any) {
                        hub.broadcast({ type: "error", message: `Agent send: ${e?.message ?? e}` });
                        console.error("agent.send failed:", e);
                    } finally {
                        hub.broadcast({ type: "agent_thinking", active: false });
                        hub.broadcast({ type: "agent_activity", label: "" });
                    }
                };
                session.events.on("change", onChange);
                runner.once("exit", () => session.events.off("change", onChange));
            }
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
        if (cmd.type === "continue") {
            await hooker.postContinue();
            session.markResumed();
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
    main(process.cwd(), port, process.argv.slice(2)).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
