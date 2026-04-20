import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";

const exec = promisify(execFile);

export const SCREENSHOT_DIR = join(tmpdir(), "debug-gui-shots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

export async function captureScreenshot(cdpPort: number): Promise<{ id: string; absPath: string }> {
    const id = `${randomUUID()}.png`;
    const absPath = join(SCREENSHOT_DIR, id);
    await exec("playwright-cli", ["screenshot", "--out", absPath], {
        env: { ...process.env, PLAYWRIGHT_CDP_PORT: String(cdpPort) },
    });
    return { id, absPath };
}
