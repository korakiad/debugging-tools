import { describe, it, expect, vi } from "vitest";
import { buildSessionConfig, BUNDLED_SKILLS_PATH } from "../src/agent.js";
import { existsSync } from "fs";

describe("buildSessionConfig", () => {
    it("uses only the bundled skills directory — no consumer-cwd override", () => {
        const cfg = buildSessionConfig({
            tools: [],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.skillDirectories).toEqual([BUNDLED_SKILLS_PATH]);
    });

    it("bundled skills path points to real dir shipped with the package", () => {
        expect(existsSync(BUNDLED_SKILLS_PATH)).toBe(true);
    });

    it("pins the model to gpt-5.2", () => {
        const cfg = buildSessionConfig({
            tools: [],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.model).toBe("gpt-5.2");
    });

    it("attaches custom tools", () => {
        const cfg = buildSessionConfig({
            tools: [{ name: "pick_element" } as any],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.tools?.length).toBe(1);
    });
});
