import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { writeFile } from "fs/promises";

export interface EditFileDeps {
    onPropose: (
        file: string,
        oldCode: string,
        newCode: string
    ) => Promise<{ approved: boolean; reason?: string }>;
}

const editFileSchema = z.object({
    path: z.string(),
    oldContent: z.string(),
    newContent: z.string(),
});

export function makeEditFileTool(deps: EditFileDeps) {
    return defineTool<z.infer<typeof editFileSchema>>("edit_file", {
        description: "Edit a file after QA reviews the diff. Always routes through the UI diff modal.",
        overridesBuiltInTool: true,
        parameters: editFileSchema,
        handler: async ({ path, oldContent, newContent }) => {
            const decision = await deps.onPropose(path, oldContent, newContent);
            if (decision.approved) {
                await writeFile(path, newContent);
                return { applied: true };
            }
            return { applied: false, rejection: decision.reason ?? "rejected" };
        },
    });
}
