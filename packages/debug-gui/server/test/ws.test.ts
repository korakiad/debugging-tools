import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WsHub } from "../src/server.js";
import { saveConfig } from "../src/config.js";

describe("WsHub", () => {
    it("broadcasts to all registered sockets", () => {
        const hub = new WsHub();
        const s1: any = { send: (data: string) => (s1.sent = data), readyState: 1 };
        const s2: any = { send: (data: string) => (s2.sent = data), readyState: 1 };
        hub.add(s1);
        hub.add(s2);
        hub.broadcast({ type: "status", state: "running" });
        expect(JSON.parse(s1.sent).type).toBe("status");
        expect(JSON.parse(s2.sent).type).toBe("status");
    });

    it("routes client commands via onMessage", () => {
        const hub = new WsHub();
        const received: any[] = [];
        hub.onMessage((c) => received.push(c));
        hub.handleIncoming('{"type":"run","spec":"a.spec.js"}');
        expect(received[0].type).toBe("run");
        expect(received[0].spec).toBe("a.spec.js");
    });

    it("settings_update writes preRun to package.json and broadcasts config_updated", async () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}, null, 2));

        const broadcasts: any[] = [];
        const hub = new WsHub();
        const fakeWs: any = { readyState: 1, send: (p: string) => broadcasts.push(JSON.parse(p)) };
        hub.add(fakeWs);

        // Wire the handler exactly like index.ts will.
        hub.onMessage(async (cmd) => {
            if (cmd.type === "settings_update") {
                const cfg = saveConfig(dir, { preRun: cmd.preRun });
                hub.broadcast({ type: "config_updated", config: cfg });
            }
        });

        hub.handleIncoming(JSON.stringify({ type: "settings_update", preRun: "npm run build" }));
        // Handler is async; yield.
        await new Promise((r) => setImmediate(r));

        expect(broadcasts[0]).toMatchObject({ type: "config_updated" });
        expect((broadcasts[0] as any).config.preRun).toBe("npm run build");
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].preRun).toBe("npm run build");
    });
});
