import { describe, it, expect } from "vitest";
import { HookerClient } from "../src/hooker.js";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeCwd(): string {
    const cwd = mkdtempSync(join(tmpdir(), "dbg-hk-"));
    mkdirSync(join(cwd, ".walkthrough"));
    return cwd;
}

describe("HookerClient (filesystem protocol)", () => {
    it("getStatus returns parsed status.json", async () => {
        const cwd = makeCwd();
        writeFileSync(join(cwd, ".walkthrough/status.json"), JSON.stringify({ state: "running", startedAt: 1 }));
        const client = new HookerClient(cwd);
        expect(await client.getStatus()).toEqual({ state: "running", startedAt: 1 });
    });

    it("getStatus returns idle when status.json is missing", async () => {
        const cwd = makeCwd();
        const client = new HookerClient(cwd);
        expect(await client.getStatus()).toEqual({ state: "idle" });
    });

    it("getPaused returns failure object from paused.json", async () => {
        const cwd = makeCwd();
        writeFileSync(
            join(cwd, ".walkthrough/paused.json"),
            JSON.stringify({ test: "t", file: "a.spec.js", error: "e", stack: "" })
        );
        const client = new HookerClient(cwd);
        const p = await client.getPaused();
        expect(p.test).toBe("t");
    });

    it("postContinue writes the continue file", async () => {
        const cwd = makeCwd();
        const client = new HookerClient(cwd);
        await client.postContinue();
        expect(existsSync(join(cwd, ".walkthrough/continue"))).toBe(true);
    });
});
