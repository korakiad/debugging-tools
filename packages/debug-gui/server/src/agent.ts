import { approveAll, type Tool, type SessionConfig } from "@github/copilot-sdk";
import { join } from "path";

export interface AgentDeps {
    cwd: string;
    tools: Tool<any>[];
    onPick: (hint: string) => Promise<Record<string, unknown>>;
    onEdit: (file: string, oldCode: string, newCode: string) => Promise<{ approved: boolean; reason?: string }>;
}

export function buildSessionConfig(deps: AgentDeps): SessionConfig {
    return {
        skillDirectories: [join(deps.cwd, ".claude/skills")],
        tools: deps.tools,
        onPermissionRequest: approveAll,
    };
}
