import express, { Express } from "express";
import type { WebSocket } from "ws";
import { Suite } from "./discovery.js";
import { DebugGuiConfig } from "./config.js";
import { SessionSnapshot } from "./session.js";
import type { ServerEvent, ClientCommand } from "./messages.js";
import type { HookerClient, HookFailure, HookStatus } from "./hooker.js";

export interface InitPayload {
    suites: Suite[];
    config: DebugGuiConfig;
    state: SessionSnapshot;
}

export interface AppDeps {
    cwd: string;
    loadInit: () => InitPayload;
    hooker?: HookerClient;
}

export function createApp(deps: AppDeps): Express {
    const app = express();
    app.use(express.json());
    app.get("/api/init", (_req, res) => {
        res.json(deps.loadInit());
    });

    // ── Hook IPC routes (called by runtime/walkthrough-hooks.cjs) ──
    // These replace the v1 filesystem protocol (.walkthrough/*.json).
    if (deps.hooker) {
        const hooker = deps.hooker;

        app.post("/hook/status", (req, res) => {
            const body = req.body as Partial<HookStatus> & { state?: string };
            if (!body?.state) return res.status(400).json({ error: "state required" });
            hooker.setStatus(body as any);
            res.json({ ok: true });
        });

        app.post("/hook/paused", (req, res) => {
            const body = req.body as HookFailure;
            if (!body?.test || !body?.file) {
                return res.status(400).json({ error: "test + file required" });
            }
            hooker.setPaused(body);
            res.json({ ok: true });
        });

        app.post("/hook/heartbeat", (_req, res) => {
            hooker.recordHeartbeat();
            res.json({ ok: true });
        });

        app.get("/hook/should-continue", (_req, res) => {
            res.json({ shouldContinue: hooker.consumeContinue() });
        });
    }

    return app;
}

export class WsHub {
    private sockets = new Set<WebSocket>();
    private handlers = new Set<(c: ClientCommand) => void>();

    add(ws: WebSocket): void { this.sockets.add(ws); }
    remove(ws: WebSocket): void { this.sockets.delete(ws); }

    broadcast(event: ServerEvent): void {
        const payload = JSON.stringify(event);
        for (const ws of this.sockets) {
            if (ws.readyState === 1) ws.send(payload);
        }
    }

    onMessage(fn: (cmd: ClientCommand) => void): void {
        this.handlers.add(fn);
    }

    handleIncoming(raw: string): void {
        try {
            const cmd = JSON.parse(raw) as ClientCommand;
            for (const fn of this.handlers) fn(cmd);
        } catch {
            // ignore malformed
        }
    }
}
