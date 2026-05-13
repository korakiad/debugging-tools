import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import type { LspWarning } from "@debug-gui/protocol";
import type { SessionManager } from "../session.js";
import type { WsHub } from "../server.js";
import type { Suite } from "../discovery.js";
import type { DebugGuiConfig } from "../config.js";

export interface WsRoutesDeps {
    readonly hub: WsHub;
    readonly session: SessionManager;
    /** Live accessor — re-read on each new connection so settings_update
     *  changes are reflected for newly connected clients. */
    readonly init: () => {
        suites: Suite[];
        config: DebugGuiConfig;
        lspWarning: LspWarning | null;
    };
}

export function attachWsServer(httpServer: HttpServer, deps: WsRoutesDeps): WebSocketServer {
    const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    wss.on("connection", (ws) => {
        deps.hub.add(ws);
        const snapshot = deps.init();
        ws.send(JSON.stringify({
            type: "init",
            suites: snapshot.suites,
            config: snapshot.config,
            state: deps.session.getState(),
        }));
        if (snapshot.lspWarning) {
            ws.send(JSON.stringify({ type: "lsp/warning", warning: snapshot.lspWarning }));
        }
        ws.on("message", (raw) => deps.hub.handleIncoming(raw.toString()));
        ws.on("close", () => deps.hub.remove(ws));
    });
    return wss;
}
