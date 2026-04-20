import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export interface PickElementDeps {
    onPick: (hint: string) => Promise<Record<string, unknown>>;
}

export function makePickElementTool(deps: PickElementDeps) {
    return defineTool("pick_element", {
        description: "Ask QA to visually click the target element on the current page. Returns DOM attributes the agent can turn into a selector.",
        parameters: z.object({
            hint: z.string().describe("natural-language description of the element QA should click"),
        }),
        handler: async ({ hint }) => {
            return await deps.onPick(hint);
        },
    });
}
