import { approveAll, type Tool, type SessionConfig } from "@github/copilot-sdk";
import { fileURLToPath } from "node:url";

// Bundled skills shipped with @debug-tools/ui. Resolves to:
//   dev (tsx):       packages/debug-gui/.claude/skills
//   prod (installed): node_modules/@debug-tools/ui/.claude/skills
// Both layouts have agent.{ts,js} sitting at <pkg>/server/{src,dist}/
export const BUNDLED_SKILLS_PATH = fileURLToPath(
    new URL("../../.claude/skills", import.meta.url)
);

export interface AgentDeps {
    tools: Tool<any>[];
    onPick: (hint: string) => Promise<Record<string, unknown>>;
    onEdit: (file: string, oldCode: string, newCode: string) => Promise<{ approved: boolean; reason?: string }>;
}

export function buildSessionConfig(deps: AgentDeps): SessionConfig {
    return {
        model: "gpt-5.2",
        // Bundled-only: consumer projects' .claude/skills must NOT shadow the
        // shipped SKILLs, otherwise stale or incompatible local copies would
        // silently override the contract debug-gui ships against.
        skillDirectories: [BUNDLED_SKILLS_PATH],
        tools: deps.tools,
        onPermissionRequest: approveAll,
    };
}
