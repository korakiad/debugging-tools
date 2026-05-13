import type { ClientCommand } from "@debug-gui/protocol";
import { saveConfig, type DebugGuiConfig } from "../config.js";
import { discoverSuites, type Suite } from "../discovery.js";
import type { WsHub } from "../server.js";
import type { GuiSession } from "../domain/GuiSession.js";

export interface SettingsUpdateDeps {
    readonly cwd: string;
    /** Mutable config — saveConfig returns a fresh load which we
     *  Object.assign over `config` so downstream consumers (the GuiSession
     *  config thunk) read fresh values. */
    readonly config: DebugGuiConfig;
    readonly hub: WsHub;
    readonly gui: GuiSession;
    /** Called when discovery globs/excludes changed — handed the
     *  freshly re-scanned suites so index.ts can update its closure. */
    readonly onSuitesRefreshed: (suites: Suite[]) => void;
}

// Validates incoming settings_update fields, persists via saveConfig, and
// broadcasts config_updated + (if discovery changed) suites_updated.
// Returns nothing — caller doesn't need the result.
export async function handleSettingsUpdate(
    cmd: Extract<ClientCommand, { type: "settings_update" }>,
    deps: SettingsUpdateDeps,
): Promise<void> {
    const patch: Parameters<typeof saveConfig>[1] = {};
    if (cmd.preRun !== undefined) {
        if (typeof cmd.preRun !== "string") {
            deps.hub.broadcast({ type: "error", message: "Save settings: preRun must be a string" });
            return;
        }
        patch.preRun = cmd.preRun;
    }
    if (cmd.idleTimeoutMs !== undefined) {
        if (typeof cmd.idleTimeoutMs !== "number" || !Number.isFinite(cmd.idleTimeoutMs) || cmd.idleTimeoutMs <= 0) {
            deps.hub.broadcast({ type: "error", message: "Save settings: idleTimeoutMs must be a positive number" });
            return;
        }
        patch.idleTimeoutMs = cmd.idleTimeoutMs;
    }
    if (cmd.mode !== undefined) {
        if (cmd.mode !== "auto" && cmd.mode !== "manual") {
            deps.hub.broadcast({ type: "error", message: "Save settings: mode must be 'auto' or 'manual'" });
            return;
        }
        patch.mode = cmd.mode;
    }
    if (cmd.discovery !== undefined) {
        const d: { globs?: string[]; exclude?: string[]; extensions?: string[] } = {};
        if (cmd.discovery.globs !== undefined) {
            if (!Array.isArray(cmd.discovery.globs) || !cmd.discovery.globs.every((g) => typeof g === "string")) {
                deps.hub.broadcast({ type: "error", message: "Save settings: discovery.globs must be string[]" });
                return;
            }
            d.globs = cmd.discovery.globs;
        }
        if (cmd.discovery.exclude !== undefined) {
            if (!Array.isArray(cmd.discovery.exclude) || !cmd.discovery.exclude.every((g) => typeof g === "string")) {
                deps.hub.broadcast({ type: "error", message: "Save settings: discovery.exclude must be string[]" });
                return;
            }
            d.exclude = cmd.discovery.exclude;
        }
        if (cmd.discovery.extensions !== undefined) {
            if (!Array.isArray(cmd.discovery.extensions) || !cmd.discovery.extensions.every((g) => typeof g === "string")) {
                deps.hub.broadcast({ type: "error", message: "Save settings: discovery.extensions must be string[]" });
                return;
            }
            d.extensions = cmd.discovery.extensions;
        }
        patch.discovery = d;
    }
    try {
        const nextCfg = saveConfig(deps.cwd, patch);
        // Mutate the captured config so downstream config: () => config
        // thunks see the new value.
        Object.assign(deps.config, nextCfg);
        deps.hub.broadcast({ type: "config_updated", config: nextCfg });
        if (patch.discovery) {
            const suites = discoverSuites(deps.cwd, {
                globs: nextCfg.discovery.globs,
                exclude: nextCfg.discovery.exclude,
            });
            deps.onSuitesRefreshed(suites);
            // If the prior Run's spec is no longer discoverable (excluded
            // by the new globs), drop the snapshot so a stray Continue
            // can't try to re-fork a now-missing spec.
            deps.gui.invalidateLastOptsIfMissing(suites.map((s) => s.relPath));
            deps.hub.broadcast({ type: "suites_updated", suites });
        }
    } catch (e: any) {
        deps.hub.broadcast({ type: "error", message: `Save settings: ${e?.message ?? e}` });
    }
}
