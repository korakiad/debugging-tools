import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export interface AskUserResult {
    choice: string | null;
    freeText: string | null;
}

export interface AskUserDeps {
    onAsk: (
        summary: string,
        options: { id: string; label: string; detail?: string }[],
        allowFreeText: boolean,
    ) => Promise<AskUserResult>;
}

const optionSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "id must be snake_case"),
    label: z.string().min(1),
    detail: z.string().optional(),
});

const askUserSchema = z.object({
    summary: z.string().min(1).describe("1-line context for QA"),
    options: z.array(optionSchema).max(6),
    allowFreeText: z.boolean(),
});

export function makeAskUserTool(deps: AskUserDeps) {
    return defineTool<z.infer<typeof askUserSchema>>("ask_user", {
        description:
            "Ask QA a question with optional A/B/C-style suggested next steps. " +
            "In manual mode this is the only way to surface findings to QA before " +
            "calling edit_file. Option ids that apply a fix MUST start with 'apply_'.",
        parameters: askUserSchema,
        handler: async ({ summary, options, allowFreeText }) => {
            return await deps.onAsk(summary, options, allowFreeText);
        },
    });
}
