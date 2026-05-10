import { exec as execCb } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";

const exec = promisify(execCb);

export const SCREENSHOT_DIR = join(tmpdir(), "debug-gui-shots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// playwright-cli is session-scoped: every command runs against an attached
// session, and there is no PLAYWRIGHT_CDP_PORT env var. Attach a uniquely-
// named session, take the screenshot, best-effort detach so concurrent shots
// don't collide. The CLI flag is --filename (not --out — that one silently
// no-ops and writes to the cwd default).
export async function captureScreenshot(cdpPort: number): Promise<{ id: string; absPath: string }> {
    const id = `${randomUUID()}.png`;
    const absPath = join(SCREENSHOT_DIR, id);
    const sessionName = `dgui_shot_${randomUUID().slice(0, 8)}`;
    const cmd =
        `npx playwright-cli attach --cdp="http://localhost:${cdpPort}" --session=${sessionName} ` +
        `&& npx playwright-cli -s=${sessionName} screenshot --filename="${absPath}"`;
    try {
        await exec(cmd, { encoding: "utf8" });
        return { id, absPath };
    } finally {
        try {
            await exec(`npx playwright-cli -s=${sessionName} detach`, { encoding: "utf8" });
        } catch { /* ignore */ }
    }
}
