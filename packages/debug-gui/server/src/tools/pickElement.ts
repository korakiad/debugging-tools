import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export interface PickElementDeps {
    onPick: (hint: string) => Promise<Record<string, unknown>>;
}

const pickElementSchema = z.object({
    hint: z.string().describe("natural-language description of the element QA should click"),
});

export function makePickElementTool(deps: PickElementDeps) {
    return defineTool<z.infer<typeof pickElementSchema>>("pick_element", {
        description: "Ask QA to visually click the target element on the current page. Use this FIRST for any element-related failure (wrong selector, element not found, not interactable, wrong element clicked, assertion on element text/value) — letting QA point at the real element is more reliable than guessing from a DOM snapshot, and it works the same whether the app is large or small. Only fall back to playwright-cli snapshot/eval for non-element issues (timing, navigation, console errors) or to confirm details after picking. Returns DOM attributes (tag, id, classes, data-*, aria-*, frame chain) for selector building.",
        parameters: pickElementSchema,
        handler: async ({ hint }) => {
            return await deps.onPick(hint);
        },
    });
}
