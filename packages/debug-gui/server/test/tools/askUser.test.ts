import { describe, it, expect } from "vitest";
import { makeAskUserTool } from "../../src/tools/askUser.js";

describe("ask_user tool", () => {
    it("returns the resolved choice + freeText to the agent", async () => {
        const tool = makeAskUserTool({
            onAsk: async () => ({ choice: "apply_a", freeText: null }),
        });
        const result = await (tool as any).handler(
            {
                summary: "test",
                options: [{ id: "apply_a", label: "Use [data-test=login]" }],
                allowFreeText: false,
            },
            {},
        );
        expect(result).toEqual({ choice: "apply_a", freeText: null });
    });

    it("propagates freeText when QA types instead of choosing", async () => {
        const tool = makeAskUserTool({
            onAsk: async () => ({ choice: null, freeText: "look at the modal first" }),
        });
        const result = await (tool as any).handler(
            { summary: "...", options: [], allowFreeText: true },
            {},
        );
        expect(result).toEqual({ choice: null, freeText: "look at the modal first" });
    });

    it("rejects malformed option id at parse time", async () => {
        const tool = makeAskUserTool({ onAsk: async () => ({ choice: null, freeText: null }) });
        const schema = (tool as any).parameters;
        expect(() => schema.parse({
            summary: "x",
            options: [{ id: "Apply A!", label: "x" }],
            allowFreeText: false,
        })).toThrow();
    });

    it("caps options at 6", async () => {
        const tool = makeAskUserTool({ onAsk: async () => ({ choice: null, freeText: null }) });
        const schema = (tool as any).parameters;
        const tooMany = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `O${i}` }));
        expect(() => schema.parse({
            summary: "x",
            options: tooMany,
            allowFreeText: false,
        })).toThrow();
    });
});
