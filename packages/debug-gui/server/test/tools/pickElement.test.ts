import { describe, it, expect, vi } from "vitest";
import { makePickElementTool } from "../../src/tools/pickElement.js";

describe("pick_element", () => {
    it("calls onPick with hint and returns attrs", async () => {
        const onPick = vi.fn().mockResolvedValue({
            tag: "BUTTON", id: "", testid: "login-submit", aria: "Login",
        });
        const tool = makePickElementTool({ onPick });
        const result = await (tool as any).handler({ hint: "login button" }, {});
        expect(onPick).toHaveBeenCalledWith("login button");
        expect(result.testid).toBe("login-submit");
    });
});
