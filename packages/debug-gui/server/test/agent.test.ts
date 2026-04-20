import { describe, it, expect, vi } from "vitest";
import { buildSessionConfig } from "../src/agent.js";

describe("buildSessionConfig", () => {
    it("sets skillDirectories to .claude/skills", () => {
        const cfg = buildSessionConfig({
            cwd: "/repo",
            tools: [],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.skillDirectories?.[0]).toMatch(/\.claude[\\/]skills$/);
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
