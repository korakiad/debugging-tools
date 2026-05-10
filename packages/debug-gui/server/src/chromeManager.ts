import { spawn, ChildProcess } from "child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import http from "http";
import os from "os";
import path from "path";
import {
    defaultPuppeteerCacheDir,
    ensureRenamedChromium,
    findChromiumBrowser,
    findInstalledChromium,
} from "./launcher.js";
import { killTree } from "./runner.js";

// debug-gui-managed Chrome lifecycle. Server launches Chrome with
// --remote-debugging-port=0 + an isolated --user-data-dir on Run, hands
// the resulting `localhost:<port>` to every Mocha worker fork via the
// DEBUG_GUI_ATTACH_CDP env var. The launcher monkey-patches
// webdriverio.remote() to inject `goog:chromeOptions.debuggerAddress` so
// the user's wdio-setup.js attaches instead of launching — Chrome
// survives the worker swap on Continue, login state intact.
//
// Chrome's binary writes the auto-picked port to <userDataDir>/DevToolsActivePort
// once it boots; we poll the file rather than trying to parse stderr.

export interface ChromeHandle {
    port: number;
    userDataDir: string;
    pid: number;
    debuggerAddress: string; // "localhost:<port>"
}

const READY_TIMEOUT_MS = 15000;
const READY_POLL_MS = 50;
const REAP_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

export class ChromeManager {
    private handle: ChromeHandle | null = null;
    private proc: ChildProcess | null = null;

    isAlive(): boolean {
        return this.proc !== null && this.proc.exitCode === null && this.handle !== null;
    }

    getHandle(): ChromeHandle | null {
        return this.handle;
    }

    // Launch a fresh Chrome. Idempotent in the "already-alive" sense — if
    // the existing process is still up and CDP responds, return its handle
    // without relaunching (so consecutive Run clicks don't churn Chrome).
    async launch(): Promise<ChromeHandle> {
        if (this.isAlive() && this.handle && (await probeCdp(this.handle.port))) {
            return this.handle;
        }
        // Stale handle (process died, CDP unreachable). Hard-reset before
        // relaunch so we don't carry forward zombie state.
        await this.kill();

        reapStaleDirs();

        const browser = await pickBrowser();
        if (!browser) {
            throw new Error(
                "ChromeManager: no Chromium-based browser found (set DEBUG_GUI_CHROME_PATH or run debug-gui-setup-browser)",
            );
        }

        const userDataDir = path.join(
            os.tmpdir(),
            `dgui-cdp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        const args = [
            "--remote-debugging-port=0",
            `--user-data-dir=${userDataDir}`,
            "--no-first-run",
            "--no-default-browser-check",
            // Chrome 111+ requires this for non-localhost CDP origins, but
            // it's also needed for some tooling that probes via 127.0.0.1
            // vs localhost. Allow any origin since the port is
            // ephemeral + machine-local.
            "--remote-allow-origins=*",
            // Hide the "Choose your search engine" dialog and other
            // first-run noise that would freeze the suite if it intercepts
            // a click during a test.
            "--disable-search-engine-choice-screen",
        ];

        const proc = spawn(browser, args, {
            stdio: "ignore",
            // Don't detach: we want killTree to take Chrome down with the
            // server on shutdown. Continue does NOT killTree, so Chrome
            // survives the Mocha worker swap.
            detached: false,
        });
        this.proc = proc;

        proc.on("error", (e) => {
            console.error("[chrome-manager] spawn error:", e.message);
        });

        const port = await waitForDevToolsPort(userDataDir, proc, READY_TIMEOUT_MS);
        await waitForCdpReady(port, READY_TIMEOUT_MS);

        const handle: ChromeHandle = {
            port,
            userDataDir,
            pid: proc.pid ?? 0,
            debuggerAddress: `localhost:${port}`,
        };
        this.handle = handle;
        return handle;
    }

    // Stop Chrome and clean up its profile dir. Called on Stop, Cancel,
    // GUI shutdown — NOT on Continue (Continue must preserve Chrome to
    // keep login state).
    async kill(): Promise<void> {
        const proc = this.proc;
        const handle = this.handle;
        this.proc = null;
        this.handle = null;
        if (proc) {
            await killTree(proc.pid);
        }
        if (handle?.userDataDir) {
            try {
                rmSync(handle.userDataDir, { recursive: true, force: true });
            } catch {
                /* Windows lock files may linger; reap on next launch */
            }
        }
    }
}

async function pickBrowser(): Promise<string | null> {
    // Prefer the bundled Chromium installed by debug-gui-setup-browser,
    // hard-linked to dgui-ui.exe on Windows so consumer team's
    // `killByName('chrome'/'edge')` cleanup hooks don't take it down.
    const cacheDir = defaultPuppeteerCacheDir();
    const installed = await findInstalledChromium(cacheDir);
    if (installed) {
        if (process.platform === "win32") {
            const renamed = ensureRenamedChromium(installed);
            if (renamed) return renamed;
        }
        return installed;
    }
    return findChromiumBrowser();
}

async function waitForDevToolsPort(
    userDataDir: string,
    proc: ChildProcess,
    timeoutMs: number,
): Promise<number> {
    const portFile = path.join(userDataDir, "DevToolsActivePort");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (proc.exitCode !== null) {
            throw new Error(
                `ChromeManager: browser exited before opening CDP (code ${proc.exitCode})`,
            );
        }
        if (existsSync(portFile)) {
            try {
                const raw = readFileSync(portFile, "utf8");
                const portLine = raw.split("\n")[0]?.trim();
                const port = portLine ? Number.parseInt(portLine, 10) : NaN;
                if (Number.isFinite(port) && port > 0) return port;
            } catch {
                /* race: Chrome still writing the file */
            }
        }
        await sleep(READY_POLL_MS);
    }
    throw new Error("ChromeManager: timed out waiting for DevToolsActivePort");
}

async function waitForCdpReady(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probeCdp(port)) return;
        await sleep(READY_POLL_MS);
    }
    throw new Error(`ChromeManager: CDP probe to localhost:${port} timed out`);
}

function probeCdp(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(
            { host: "127.0.0.1", port, path: "/json/version", timeout: 1000 },
            (res) => {
                res.resume();
                resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500);
            },
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
            req.destroy();
            resolve(false);
        });
    });
}

function reapStaleDirs(): void {
    const tmp = os.tmpdir();
    let entries: string[];
    try {
        entries = readdirSync(tmp);
    } catch {
        return;
    }
    const cutoff = Date.now() - REAP_AGE_MS;
    for (const name of entries) {
        if (!name.startsWith("dgui-cdp-")) continue;
        const full = path.join(tmp, name);
        try {
            const st = statSync(full);
            if (st.mtimeMs < cutoff) {
                rmSync(full, { recursive: true, force: true });
            }
        } catch {
            /* ignore */
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
