import { spawn } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import open from "open";

export type LaunchMode = "app" | "fallback" | "skipped";

export interface LaunchResult {
    mode: LaunchMode;
    browserPath?: string;
}

export interface FindBrowserDeps {
    env?: NodeJS.ProcessEnv;
    fileExists?: (p: string) => boolean;
    platform?: NodeJS.Platform;
}

function winCandidates(env: NodeJS.ProcessEnv): string[] {
    const local = env.LOCALAPPDATA;
    const chrome = [
        local && path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    const edge = [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    const brave = [
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ];
    return [...chrome, ...edge, ...brave].filter((p): p is string => typeof p === "string");
}

function macCandidates(): string[] {
    return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
}

function linuxCandidates(): string[] {
    return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
        "/usr/bin/brave-browser",
    ];
}

export function findChromiumBrowser(deps: FindBrowserDeps = {}): string | null {
    const env = deps.env ?? process.env;
    const fileExists = deps.fileExists ?? existsSync;
    const platform = deps.platform ?? process.platform;

    const override = env.DEBUG_GUI_CHROME_PATH;
    if (override && fileExists(override)) return override;

    let candidates: string[];
    if (platform === "win32") candidates = winCandidates(env);
    else if (platform === "darwin") candidates = macCandidates();
    else candidates = linuxCandidates();

    for (const p of candidates) {
        if (fileExists(p)) return p;
    }
    return null;
}

export interface LaunchOpts {
    disabled?: boolean;
    windowSize?: { width: number; height: number };
}

export async function launchAppMode(url: string, opts: LaunchOpts = {}): Promise<LaunchResult> {
    if (opts.disabled) return { mode: "skipped" };

    const browser = findChromiumBrowser();
    if (!browser) {
        await open(url).catch(() => { /* user will open manually */ });
        return { mode: "fallback" };
    }

    const { width = 1600, height = 1000 } = opts.windowSize ?? {};
    const profileDir = path.join(os.tmpdir(), "debug-gui-chrome-profile");
    const args = [
        `--app=${url}`,
        `--user-data-dir=${profileDir}`,
        `--window-size=${width},${height}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--test-type=",
    ];

    const child = spawn(browser, args, { detached: true, stdio: "ignore" });
    child.on("error", () => { /* spawn failed post-launch; already returned */ });
    child.unref();

    return { mode: "app", browserPath: browser };
}
