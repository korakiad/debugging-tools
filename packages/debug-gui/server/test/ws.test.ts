import { describe, it, expect } from "vitest";
import { WsHub } from "../src/server.js";

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
});
