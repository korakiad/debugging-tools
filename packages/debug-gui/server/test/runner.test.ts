import { describe, it, expect } from "vitest";
import { buildMochaCommand } from "../src/runner.js";

describe("buildMochaCommand", () => {
    it("injects WALKTHROUGH_PORT and propagates mocha require", () => {
        const cmd = buildMochaCommand({
            spec: "test/login.spec.js",
            walkthroughPort: 3456,
            mocha: { require: "tsx", file: ["./hooks.js"] },
        });
        expect(cmd.env.WALKTHROUGH_PORT).toBe("3456");
        expect(cmd.args).toContain("test/login.spec.js");
        expect(cmd.command).toBe("npx");
    });

    it("uses custom mocha command when provided", () => {
        const cmd = buildMochaCommand({
            spec: "test/login.spec.js",
            walkthroughPort: 3456,
            mocha: {},
            customCommand: "./bin/mocha",
        });
        expect(cmd.command).toBe("./bin/mocha");
    });

    it("threads mocha.require (string or array) into --require args", () => {
        const one = buildMochaCommand({
            spec: "t.spec.js",
            walkthroughPort: 3456,
            mocha: { require: "tsx" },
        });
        expect(one.args).toEqual(["mocha", "t.spec.js", "--require", "tsx"]);

        const many = buildMochaCommand({
            spec: "t.spec.js",
            walkthroughPort: 3456,
            mocha: { require: ["tsx", "./setup.js"] },
        });
        expect(many.args).toEqual([
            "mocha", "t.spec.js", "--require", "tsx", "--require", "./setup.js",
        ]);
    });

    it("threads mocha.file into --file args", () => {
        const cmd = buildMochaCommand({
            spec: "t.spec.js",
            walkthroughPort: 3456,
            mocha: { file: ["./hooks.js"] },
        });
        expect(cmd.args).toContain("--file");
        expect(cmd.args).toContain("./hooks.js");
    });
});
