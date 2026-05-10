import express, { Express } from "express";
import type { WebSocket } from "ws";
import { Suite } from "./discovery.js";
import { DebugGuiConfig } from "./config.js";
import { SessionSnapshot } from "./session.js";
import type { ServerEvent, ClientCommand } from "./messages.js";
import { listProjectTree } from "./fsTree.js";
import { parseSuiteTree } from "./parseSuite.js";

export interface InitPayload {
    suites: Suite[];
    config: DebugGuiConfig;
    state: SessionSnapshot;
    lsp?: string;
}

export interface AppDeps {
    cwd: string;
    loadInit: () => InitPayload;
    // Optional override (for tests). Defaults to the real parser.
    parseTree?: typeof parseSuiteTree;
}

export function createApp(deps: AppDeps): Express {
    const app = express();
    app.use(express.json());
    app.get("/api/init", (_req, res) => {
        res.json(deps.loadInit());
    });

    // Returns the parsed describe/it tree for a single spec file. The UI
    // calls this lazily when the user expands a suite node so we don't pay
    // the parse cost for files they never open.
    //
    // The `spec` query param is a relPath that MUST match a discovered
    // suite — we never read arbitrary paths from the request, both to
    // prevent path traversal and to make it obvious this endpoint is for
    // discovered suites only.
    app.get("/api/suite/tree", (req, res) => {
        const spec = typeof req.query.spec === "string" ? req.query.spec : "";
        if (!spec) return res.status(400).json({ error: "spec required" });
        const init = deps.loadInit();
        const suite = init.suites.find((s) => s.relPath === spec);
        if (!suite) return res.status(404).json({ error: "suite not found" });
        const parse = deps.parseTree ?? parseSuiteTree;
        const tree = parse(suite.absPath, { cwd: deps.cwd });
        res.json(tree);
    });

    // File tree for the settings picker. Filter param narrows to test-like
    // files by default — keeps the payload small for big monorepos.
    app.get("/api/fs/tree", (req, res) => {
        const filterRaw = typeof req.query.filter === "string" ? req.query.filter : "\\.(spec|test)\\.(js|ts|tsx|jsx|mjs|cjs)$";
        let fileFilter: RegExp | undefined;
        try {
            fileFilter = new RegExp(filterRaw);
        } catch {
            return res.status(400).json({ error: "invalid filter regex" });
        }
        // Defensive wrap: listProjectTree should be robust (readdirSync is
        // try/caught internally) but a throw here surfaces as a bare Express
        // 500 with no body, which the TreePicker shows as "HTTP 500" with no
        // diagnostic. Catching lets the dialog display the actual error.
        try {
            const tree = listProjectTree(deps.cwd, { fileFilter });
            res.json({ root: tree });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("[/api/fs/tree] listProjectTree failed:", e);
            res.status(500).json({ error: message });
        }
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
