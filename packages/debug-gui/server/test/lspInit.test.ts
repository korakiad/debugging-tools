import { describe, it, expect } from "vitest";
import { mergeLspConfig, DEFAULT_TS_BLOCK, probeBinary, ensureLspConfig } from "../src/lspInit.js";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempCwd(): string {
    return mkdtempSync(join(tmpdir(), "lsp-init-"));
}

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

describe("ensureLspConfig", () => {
    it("returns missing without writing config when binary is absent", async () => {
        const cwd = makeTempCwd();
        const result = await ensureLspConfig(cwd, {
            probe: async () => ({ kind: "missing" }),
        });
        expect(result.status).toBe("missing");
        expect(result.installCmd).toContain("typescript-language-server");
        expect(existsSync(join(cwd, ".github/lsp.json"))).toBe(false);
    });

    it("returns broken with stderrTail without writing config", async () => {
        const cwd = makeTempCwd();
        const result = await ensureLspConfig(cwd, {
            probe: async () => ({ kind: "broken", stderrTail: "version mismatch" }),
        });
        expect(result.status).toBe("broken");
        expect(result.stderrTail).toBe("version mismatch");
        expect(result.installCmd).toBeDefined();
        expect(existsSync(join(cwd, ".github/lsp.json"))).toBe(false);
    });

    it("creates .github/lsp.json when missing", async () => {
        const cwd = makeTempCwd();
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("ok");
        const written = JSON.parse(readFileSync(join(cwd, ".github/lsp.json"), "utf8"));
        expect(written.lspServers.typescript.command).toBe("typescript-language-server");
    });

    it("merges typescript into existing config without touching other keys", async () => {
        const cwd = makeTempCwd();
        mkdirSync(join(cwd, ".github"));
        writeFileSync(
            join(cwd, ".github/lsp.json"),
            JSON.stringify({ lspServers: { python: { command: "pylsp", args: [] } } }, null, 2),
        );
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("ok");
        const written = JSON.parse(readFileSync(join(cwd, ".github/lsp.json"), "utf8"));
        expect(written.lspServers.python).toEqual({ command: "pylsp", args: [] });
        expect(written.lspServers.typescript).toBeDefined();
    });

    it("does not modify file when typescript entry already exists", async () => {
        const cwd = makeTempCwd();
        mkdirSync(join(cwd, ".github"));
        const path = join(cwd, ".github/lsp.json");
        writeFileSync(
            path,
            JSON.stringify({ lspServers: { typescript: { command: "custom-tsserver" } } }, null, 2),
        );
        const mtimeBefore = statSync(path).mtimeMs;
        // Wait a tick so a write would change mtime measurably.
        await new Promise((r) => setTimeout(r, 20));
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("ok");
        expect(statSync(path).mtimeMs).toBe(mtimeBefore);
        const written = JSON.parse(readFileSync(path, "utf8"));
        expect(written.lspServers.typescript.command).toBe("custom-tsserver");
    });

    it("returns config-invalid when existing JSON is malformed", async () => {
        const cwd = makeTempCwd();
        mkdirSync(join(cwd, ".github"));
        writeFileSync(join(cwd, ".github/lsp.json"), "{ this is not json");
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("config-invalid");
        // File is left untouched.
        expect(readFileSync(join(cwd, ".github/lsp.json"), "utf8")).toBe("{ this is not json");
    });
});
