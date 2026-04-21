import { describe, it, expect } from "vitest";
import { findChromiumBrowser } from "../src/launcher.js";

const CHROME_WIN = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_WIN = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BRAVE_WIN = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_LINUX = "/usr/bin/google-chrome";
const EDGE_LINUX = "/usr/bin/microsoft-edge";

describe("findChromiumBrowser", () => {
    it("honors DEBUG_GUI_CHROME_PATH override when file exists", () => {
        const override = "C:\\custom\\chrome.exe";
        const found = findChromiumBrowser({
            env: { DEBUG_GUI_CHROME_PATH: override },
            fileExists: (p) => p === override,
            platform: "win32",
        });
        expect(found).toBe(override);
    });

    it("ignores override when file does not exist, falls back to normal detection", () => {
        const found = findChromiumBrowser({
            env: { DEBUG_GUI_CHROME_PATH: "C:\\nope.exe" },
            fileExists: (p) => p === CHROME_WIN,
            platform: "win32",
        });
        expect(found).toBe(CHROME_WIN);
    });

    it("prefers Chrome over Edge on Windows when both exist", () => {
        const found = findChromiumBrowser({
            env: {},
            fileExists: (p) => p === CHROME_WIN || p === EDGE_WIN,
            platform: "win32",
        });
        expect(found).toBe(CHROME_WIN);
    });

    it("falls back to Edge on Windows when Chrome is missing", () => {
        const found = findChromiumBrowser({
            env: {},
            fileExists: (p) => p === EDGE_WIN,
            platform: "win32",
        });
        expect(found).toBe(EDGE_WIN);
    });

    it("falls back to Brave on Windows when Chrome and Edge are missing", () => {
        const found = findChromiumBrowser({
            env: {},
            fileExists: (p) => p === BRAVE_WIN,
            platform: "win32",
        });
        expect(found).toBe(BRAVE_WIN);
    });

    it("returns null on Windows when no browser is found", () => {
        const found = findChromiumBrowser({
            env: {},
            fileExists: () => false,
            platform: "win32",
        });
        expect(found).toBeNull();
    });

    it("uses LOCALAPPDATA Chrome path when set and present", () => {
        const localChrome = "C:\\Users\\q\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
        const found = findChromiumBrowser({
            env: { LOCALAPPDATA: "C:\\Users\\q\\AppData\\Local" },
            fileExists: (p) => p === localChrome,
            platform: "win32",
        });
        expect(found).toBe(localChrome);
    });

    it("finds Chrome on macOS", () => {
        const found = findChromiumBrowser({
            env: {},
            fileExists: (p) => p === CHROME_MAC,
            platform: "darwin",
        });
        expect(found).toBe(CHROME_MAC);
    });

    it("prefers Chrome over Edge on Linux", () => {
        const found = findChromiumBrowser({
            env: {},
            fileExists: (p) => p === CHROME_LINUX || p === EDGE_LINUX,
            platform: "linux",
        });
        expect(found).toBe(CHROME_LINUX);
    });

    it("returns null on Linux when nothing is installed", () => {
        const found = findChromiumBrowser({
            env: {},
            fileExists: () => false,
            platform: "linux",
        });
        expect(found).toBeNull();
    });
});
