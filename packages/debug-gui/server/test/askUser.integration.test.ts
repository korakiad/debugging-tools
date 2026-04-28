import { describe, it, expect } from "vitest";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createApp, WsHub } from "../src/server.js";
import { HookerClient } from "../src/hooker.js";
import type { PendingResolver } from "../src/resolvers.js";

describe("ask_user WS round-trip", () => {
    it("resolves the pending resolver when client sends prompt_response", async () => {
        const hub = new WsHub();
        const askResolvers = new Map<
            string,
            PendingResolver<{ choice: string | null; freeText: string | null }>
        >();

        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({ suites: [], config: {} as any, state: { state: "idle" } }),
            hooker: new HookerClient(),
        });
        const server = http.createServer(app);
        const wss = new WebSocketServer({ server, path: "/ws" });
        wss.on("connection", (ws) => {
            hub.add(ws);
            ws.on("message", (raw) => hub.handleIncoming(raw.toString()));
            ws.on("close", () => hub.remove(ws));
        });

        hub.onMessage((cmd) => {
            if (cmd.type === "prompt_response") {
                const r = askResolvers.get(cmd.reqId);
                if (r) {
                    r.resolve({ choice: cmd.choice, freeText: cmd.freeText });
                    askResolvers.delete(cmd.reqId);
                }
            }
        });

        await new Promise<void>((resolve) => server.listen(0, resolve));
        const port = (server.address() as any).port;

        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        await new Promise((resolve) => ws.on("open", resolve));

        ws.on("message", (raw) => {
            const evt = JSON.parse(raw.toString());
            if (evt.type === "prompt") {
                ws.send(
                    JSON.stringify({
                        type: "prompt_response",
                        reqId: evt.reqId,
                        choice: "apply_a",
                        freeText: null,
                    }),
                );
            }
        });

        const reqId = "test-req";
        const result = await new Promise<{ choice: string | null; freeText: string | null }>(
            (resolve, reject) => {
                askResolvers.set(reqId, { resolve, reject });
                hub.broadcast({
                    type: "prompt",
                    reqId,
                    summary: "test",
                    options: [{ id: "apply_a", label: "A" }],
                    allowFreeText: true,
                });
            },
        );
        expect(result).toEqual({ choice: "apply_a", freeText: null });

        ws.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }, 5000);
});
