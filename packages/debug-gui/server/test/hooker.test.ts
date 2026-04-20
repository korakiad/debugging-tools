import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookerClient } from "../src/hooker.js";

describe("HookerClient", () => {
    beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it("getStatus returns parsed JSON", async () => {
        (fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ state: "running", startedAt: 1 }),
        });
        const client = new HookerClient(3456);
        expect(await client.getStatus()).toEqual({ state: "running", startedAt: 1 });
    });

    it("getPaused returns failure object", async () => {
        (fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ test: "t", file: "a", error: "e", stack: "" }),
        });
        const client = new HookerClient(3456);
        const p = await client.getPaused();
        expect(p.test).toBe("t");
    });

    it("postContinue sends POST request", async () => {
        (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
        const client = new HookerClient(3456);
        await client.postContinue();
        expect(fetch).toHaveBeenCalledWith(
            "http://127.0.0.1:3456/continue",
            expect.objectContaining({ method: "POST" })
        );
    });
});
