import { describe, it, expect } from "vitest";
import { mergeLspConfig, DEFAULT_TS_BLOCK, probeBinary } from "../src/lspInit.js";

describe("mergeLspConfig", () => {
    it("returns default block when existing is null", () => {
        const { next, changed } = mergeLspConfig(null);
        expect(changed).toBe(true);
        expect(next).toEqual(DEFAULT_TS_BLOCK);
    });

    it("adds typescript key when lspServers is empty", () => {
        const existing = { lspServers: {} };
        const { next, changed } = mergeLspConfig(existing);
        expect(changed).toBe(true);
        expect((next as any).lspServers.typescript).toEqual(
            DEFAULT_TS_BLOCK.lspServers.typescript,
        );
    });

    it("preserves other lspServers entries when merging typescript", () => {
        const existing = {
            lspServers: { python: { command: "pylsp", args: [] } },
        };
        const { next, changed } = mergeLspConfig(existing);
        expect(changed).toBe(true);
        expect((next as any).lspServers.python).toEqual({ command: "pylsp", args: [] });
        expect((next as any).lspServers.typescript).toBeDefined();
    });

    it("leaves file untouched when typescript already present", () => {
        const existing = {
            lspServers: {
                typescript: { command: "tsserver-custom", args: ["--my-flag"] },
            },
        };
        const { next, changed } = mergeLspConfig(existing);
        expect(changed).toBe(false);
        expect(next).toBe(existing);
    });

    it("preserves unknown top-level keys", () => {
        const existing = {
            version: 2,
            lspServers: {},
            customExtension: { foo: "bar" },
        };
        const { next } = mergeLspConfig(existing);
        expect((next as any).version).toBe(2);
        expect((next as any).customExtension).toEqual({ foo: "bar" });
    });
});

describe("probeBinary", () => {
    it("returns ok when command exits 0", async () => {
        const result = await probeBinary("node", ["--version"], 1500);
        expect(result.kind).toBe("ok");
    });

    it("returns missing when command does not exist", async () => {
        const result = await probeBinary("definitely-not-a-real-binary-xyz", ["--version"], 1500);
        expect(result.kind).toBe("missing");
    });

    it("returns broken with stderr tail when command exits non-zero", async () => {
        // `node -e "process.stderr.write('boom'); process.exit(1)"` reliably exits 1 on every platform.
        const result = await probeBinary("node", ["-e", "process.stderr.write('boom'); process.exit(1)"], 1500);
        expect(result.kind).toBe("broken");
        if (result.kind === "broken") {
            expect(result.stderrTail).toContain("boom");
        }
    });

    it("returns broken on timeout", async () => {
        const result = await probeBinary("node", ["-e", "setTimeout(() => {}, 5000)"], 500);
        expect(result.kind).toBe("broken");
        if (result.kind === "broken") {
            expect(result.stderrTail).toContain("timeout");
        }
    });
});
