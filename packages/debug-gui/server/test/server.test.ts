import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

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

describe("API /api/suite/tree", () => {
    it("returns 400 when spec query param is missing", async () => {
        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({
                suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
                config: {} as any,
                state: { state: "idle" },
            }),
        });
        await request(app).get("/api/suite/tree").expect(400);
    });

    it("returns 404 when spec is not in the discovered suites list", async () => {
        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({
                suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
                config: {} as any,
                state: { state: "idle" },
            }),
        });
        await request(app).get("/api/suite/tree?spec=other.spec.js").expect(404);
    });

    it("returns the parsed tree for a discovered suite", async () => {
        const app = createApp({
            cwd: "/proj",
            loadInit: () => ({
                suites: [{ relPath: "a.spec.js", absPath: "/proj/a.spec.js" }],
                config: {} as any,
                state: { state: "idle" },
            }),
            parseTree: (absPath) => ({
                file: absPath,
                relPath: "a.spec.js",
                source: "describe('Login', () => { it('works', () => {}); });\n",
                children: [
                    {
                        kind: "describe", title: "Login", fullTitle: "Login",
                        line: 1, endLine: 1, children: [
                            { kind: "it", title: "works", fullTitle: "Login works", line: 1, endLine: 1, children: [] },
                        ],
                    },
                ],
            }),
        });
        const res = await request(app).get("/api/suite/tree?spec=a.spec.js").expect(200);
        expect(res.body.children[0].title).toBe("Login");
        expect(res.body.children[0].children[0].fullTitle).toBe("Login works");
    });
});
