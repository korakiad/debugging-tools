import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

describe("API /api/init", () => {
    it("returns suites, config, and current state", async () => {
        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({
                suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
                config: { walkthroughPort: 3456 } as any,
                state: { state: "idle" },
            }),
        });
        const res = await request(app).get("/api/init").expect(200);
        expect(res.body.suites[0].relPath).toBe("a.spec.js");
        expect(res.body.state.state).toBe("idle");
    });
});
