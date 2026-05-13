#!/usr/bin/env node
import { Browser, detectBrowserPlatform, install, resolveBuildId } from "@puppeteer/browsers";
import os from "os";
import path from "path";

const cacheDir = process.env.PUPPETEER_CACHE_DIR ?? path.join(os.homedir(), ".cache", "puppeteer");
const platform = detectBrowserPlatform();
if (!platform) {
    console.error("Unsupported platform.");
    process.exit(1);
}

const buildId = await resolveBuildId(Browser.CHROMIUM, platform, "latest");
console.log(`Installing pure Chromium ${buildId} (${platform}) into ${cacheDir} ...`);

let lastPct = -1;
const installed = await install({
    browser: Browser.CHROMIUM,
    buildId,
    cacheDir,
    downloadProgressCallback: (downloaded, total) => {
        const pct = Math.floor((downloaded / total) * 100);
        if (pct !== lastPct && pct % 10 === 0) {
            console.log(`  ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`);
            lastPct = pct;
        }
    },
});

console.log(`\nInstalled at: ${installed.executablePath}`);
console.log("debug-gui will hard-link this to dgui-ui.exe on first launch (survives team mocha's chrome/edge kill).");
