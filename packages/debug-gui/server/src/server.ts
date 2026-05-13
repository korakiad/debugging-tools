import express, { Express } from "express";
import type { WebSocket } from "ws";
import { parseClientCommand } from "@debug-gui/protocol";
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

export const FILTER_MAX_LENGTH = 200;

// Detects the most common catastrophic-backtracking shapes seen in the wild:
//   1. Nested quantifier on a group whose body contains another quantifier:
//      (a+)+, (a*)*, (.+)+, (a+|b+)*, etc.
//   2. Alternation with identical branches: (x|x), (foo|foo)+
// Returning true means "reject this without compiling". Returning false does
// not promise the pattern is safe — combined with FILTER_MAX_LENGTH this
// closes the door on the patterns demonstrated to wedge this server's event
// loop in evidence/pr4/. Exported for unit testing.
export function looksAdversarialRegex(pattern: string): boolean {
    if (/\([^()]*[+*][^()]*\)\s*[+*]/.test(pattern)) return true;
    if (/\(([^|()]+)\|\1\)/.test(pattern)) return true;
    return false;
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
    //
    // ReDoS guard: filterRaw is user-supplied (TreePicker extensions, or any
    // localhost caller). `new RegExp(filterRaw).test(name)` runs on every
    // file in the walk, on the server's main event loop. A pathological
    // pattern like `(a+)+b` against a long filename takes seconds-to-minutes
    // for a single .test() call (Node V8 RegExp lacks an execution timeout),
    // wedging the server completely. Two-layer defense:
    //   1. Hard length cap (200 chars) keeps inputs sane.
    //   2. Reject the most common ReDoS shapes (nested quantifier on a
    //      group with internal quantifier; alternation with identical
    //      branches). Combined with the length cap this closes the
    //      demonstrated repro shapes for our threat model (typo from
    //      TreePicker / any reachable caller). It is NOT a complete ReDoS
    //      detector — full safety would need worker-thread RegExp execution
    //      with a hard timeout, which is overkill for a localhost QA tool.
    app.get("/api/fs/tree", (req, res) => {
        const filterRaw = typeof req.query.filter === "string" ? req.query.filter : "\\.(spec|test)\\.(js|ts|tsx|jsx|mjs|cjs)$";
        if (filterRaw.length > FILTER_MAX_LENGTH) {
            return res.status(400).json({ error: `filter too long (max ${FILTER_MAX_LENGTH} chars)` });
        }
        if (looksAdversarialRegex(filterRaw)) {
            return res.status(400).json({ error: "filter pattern looks ReDoS-prone (nested quantifier or overlapping alternation)" });
        }
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
            const result = listProjectTree(deps.cwd, { fileFilter });
            res.json({ root: result.root, truncated: result.truncated });
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
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return; // malformed JSON
        }
        const cmd = parseClientCommand(parsed);
        if (!cmd) {
            console.warn("[ws] dropped malformed client command:", parsed);
            return;
        }
        for (const fn of this.handlers) fn(cmd);
    }
}
