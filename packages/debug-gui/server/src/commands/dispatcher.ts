import type { ClientCommand } from "@debug-gui/protocol";
import { assertNever } from "@debug-gui/protocol";
import type { GuiSession } from "../domain/GuiSession.js";
import type { WsHub } from "../server.js";
import type { Suite } from "../discovery.js";
import type { DebugGuiConfig } from "../config.js";
import { handleSettingsUpdate } from "./settingsUpdate.js";

export interface DispatcherDeps {
    readonly cwd: string;
    readonly gui: GuiSession;
    readonly hub: WsHub;
    /** Live accessor for the in-memory suites list. Settings updates can
     *  re-scan and `onSuitesRefreshed` is the writeback. */
    readonly suites: () => Suite[];
    readonly onSuitesRefreshed: (suites: Suite[]) => void;
    /** Live config ref so settings_update mutates the same object the
     *  GuiSession config thunk reads. */
    readonly config: DebugGuiConfig;
}

// Typed handler signature: per-variant cmd is narrowed by Extract.
type Handler<K extends ClientCommand["type"]> =
    (cmd: Extract<ClientCommand, { type: K }>) => Promise<void> | void;

// Compiler-enforced exhaustiveness: every ClientCommand variant must have
// a key. Adding a new variant to the union without a handler entry is a
// compile error.
type HandlerMap = { [K in ClientCommand["type"]]: Handler<K> };

function buildHandlers(deps: DispatcherDeps): HandlerMap {
    return {
        run: async (cmd) => {
            const spec = deps.suites().find((s) => s.relPath === cmd.spec)?.absPath;
            if (!spec) return;
            await deps.gui.start(
                {
                    spec,
                    specRel: cmd.spec,
                    grep: cmd.grep,
                    bailOnFailure: cmd.bailOnFailure,
                },
                !cmd.skipPreRun,
            );
        },
        cancel: () => deps.gui.stop(),
        continue: () => deps.gui.continueSession(),
        agent_abort: () => deps.gui.abortAgent(),
        diff_decision: (cmd) =>
            deps.gui.resolveDiff(cmd.reqId, cmd.action === "approved", cmd.reason),
        pick_cancel: (cmd) => deps.gui.cancelPick(cmd.reqId),
        prompt_response: (cmd) =>
            deps.gui.respondPrompt(cmd.reqId, cmd.choice, cmd.freeText),
        // Reserved for future agent free-text input from the UI; currently
        // unused at the server. Declared here for exhaustiveness.
        chat_send: () => {},
        settings_update: (cmd) =>
            handleSettingsUpdate(cmd, {
                cwd: deps.cwd,
                config: deps.config,
                hub: deps.hub,
                gui: deps.gui,
                onSuitesRefreshed: deps.onSuitesRefreshed,
            }),
    };
}

export function registerCommandHandlers(deps: DispatcherDeps): void {
    const handlers = buildHandlers(deps);
    deps.hub.onMessage(async (cmd) => {
        const handler = handlers[cmd.type as ClientCommand["type"]] as
            | Handler<ClientCommand["type"]>
            | undefined;
        if (!handler) {
            // Phase 6 will replace this with a runtime parse guard at
            // the WS receiver; for now, log + drop unknowns so a future
            // client variant the server doesn't recognise doesn't crash.
            console.warn("[ws] unknown command:", cmd);
            return;
        }
        try {
            await handler(cmd);
        } catch (e: any) {
            console.error(`[ws] handler for ${cmd.type} failed:`, e);
            deps.hub.broadcast({
                type: "error",
                message: `Command ${cmd.type}: ${e?.message ?? e}`,
            });
        }
    });
    // Lint-only: ensure the exhaustive check is reachable even if all
    // ClientCommand variants are handled. assertNever fires here at
    // compile time if a new variant is added without a handler entry.
    const _exhaustiveCheck = (cmd: never): never => assertNever(cmd, "registerCommandHandlers");
    void _exhaustiveCheck;
}
