import express, { Express } from "express";
import type { WebSocket } from "ws";
import { Suite } from "./discovery.js";
import { DebugGuiConfig } from "./config.js";
import { SessionSnapshot } from "./session.js";
import type { ServerEvent, ClientCommand } from "./messages.js";

export interface InitPayload {
    suites: Suite[];
    config: DebugGuiConfig;
    state: SessionSnapshot;
}

export interface AppDeps {
    cwd: string;
    loadInit: () => InitPayload;
}

export function createApp(deps: AppDeps): Express {
    const app = express();
    app.use(express.json());
    app.get("/api/init", (_req, res) => {
        res.json(deps.loadInit());
    });
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
