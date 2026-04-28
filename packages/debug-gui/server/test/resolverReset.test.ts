import { describe, it, expect } from "vitest";
import { drainResolvers, type PendingResolver } from "../src/resolvers.js";

describe("drainResolvers", () => {
    it("rejects every pending resolver and clears the map", async () => {
        const m = new Map<string, PendingResolver<{ ok: boolean }>>();
        const promises: Promise<{ ok: boolean }>[] = [];
        for (const id of ["a", "b"]) {
            promises.push(new Promise((resolve, reject) => m.set(id, { resolve, reject })));
        }
        drainResolvers(m);
        await expect(promises[0]).rejects.toThrow("session aborted");
        await expect(promises[1]).rejects.toThrow("session aborted");
        expect(m.size).toBe(0);
    });
});
