import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { HookerClient } from "../src/hooker.js";

describe("API /api/init", () => {
    it("returns suites, config, and current state", async () => {
        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({
                suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
                config: {} as any,
                state: { state: "idle" },
            }),
        });
        const res = await request(app).get("/api/init").expect(200);
        expect(res.body.suites[0].relPath).toBe("a.spec.js");
        expect(res.body.state.state).toBe("idle");
    });
});

describe("Hook IPC routes", () => {
    function makeApp() {
        const hooker = new HookerClient();
        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({ suites: [], config: {} as any, state: { state: "idle" } }),
            hooker,
        });
        return { app, hooker };
    }

    it("POST /hook/status updates hooker state", async () => {
        const { app, hooker } = makeApp();
        await request(app)
            .post("/hook/status")
            .send({ state: "running", startedAt: 1 })
            .expect(200);
        expect(await hooker.getStatus()).toMatchObject({ state: "running" });
    });

    it("POST /hook/status rejects body missing 'state'", async () => {
        const { app } = makeApp();
        await request(app).post("/hook/status").send({}).expect(400);
    });

    it("POST /hook/paused transitions state to paused with failure details", async () => {
        const { app, hooker } = makeApp();
        await request(app)
            .post("/hook/paused")
            .send({ test: "t", file: "a.spec.js", error: "boom", stack: "" })
            .expect(200);
        const status = await hooker.getStatus();
        expect(status.state).toBe("paused");
        const f = await hooker.getPaused();
        expect(f.test).toBe("t");
    });

    it("POST /hook/paused rejects body missing test/file", async () => {
        const { app } = makeApp();
        await request(app).post("/hook/paused").send({ error: "e" }).expect(400);
    });

    it("POST /hook/heartbeat records lastHeartbeatAt", async () => {
        const { app, hooker } = makeApp();
        const before = Date.now();
        await request(app).post("/hook/heartbeat").send({ pid: 1, at: before }).expect(200);
        expect(hooker.getLastHeartbeatAt()).toBeGreaterThanOrEqual(before);
    });

    it("GET /hook/should-continue returns false when flag not set, true after postContinue", async () => {
        const { app, hooker } = makeApp();
        const r1 = await request(app).get("/hook/should-continue").expect(200);
        expect(r1.body).toEqual({ shouldContinue: false });

        await hooker.postContinue();
        const r2 = await request(app).get("/hook/should-continue").expect(200);
        expect(r2.body).toEqual({ shouldContinue: true });

        // Second GET returns false — hook shouldn't resume twice.
        const r3 = await request(app).get("/hook/should-continue").expect(200);
        expect(r3.body).toEqual({ shouldContinue: false });
    });
});
