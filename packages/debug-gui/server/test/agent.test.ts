import { describe, it, expect, vi } from "vitest";
import { buildSessionConfig, BUNDLED_SKILLS_PATH } from "../src/agent.js";
import { existsSync } from "fs";

describe("buildSessionConfig", () => {
    it("lists target cwd skills first, bundled fallback second", () => {
        const cfg = buildSessionConfig({
            cwd: "/repo",
            tools: [],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.skillDirectories).toHaveLength(2);
        expect(cfg.skillDirectories?.[0]).toMatch(/\.claude[\\/]skills$/);
        expect(cfg.skillDirectories?.[1]).toBe(BUNDLED_SKILLS_PATH);
    });

    it("bundled skills path points to real dir shipped with the package", () => {
        expect(existsSync(BUNDLED_SKILLS_PATH)).toBe(true);
    });

    it("attaches custom tools", () => {
        const cfg = buildSessionConfig({
            cwd: "/repo",
            tools: [{ name: "pick_element" } as any],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.tools?.length).toBe(1);
    });
});
