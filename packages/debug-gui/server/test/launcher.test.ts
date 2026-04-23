import { describe, it, expect, vi } from "vitest";
import { ensureRenamedChromium, findChromiumBrowser } from "../src/launcher.js";

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

describe("ensureRenamedChromium", () => {
    const WIN_SRC = "C:\\Users\\q\\AppData\\Local\\ms-playwright\\chromium-1140\\chrome-win\\chrome.exe";
    const WIN_TARGET = "C:\\Users\\q\\AppData\\Local\\ms-playwright\\chromium-1140\\chrome-win\\dgui-ui.exe";

    it("returns existing target without linking when target file already exists", () => {
        const link = vi.fn();
        const copy = vi.fn();
        const result = ensureRenamedChromium(WIN_SRC, {
            fileExists: (p) => p === WIN_TARGET,
            link,
            copy,
        });
        expect(result).toBe(WIN_TARGET);
        expect(link).not.toHaveBeenCalled();
        expect(copy).not.toHaveBeenCalled();
    });

    it("hard-links source to target when target missing", () => {
        const link = vi.fn();
        const copy = vi.fn();
        const result = ensureRenamedChromium(WIN_SRC, {
            fileExists: () => false,
            link,
            copy,
        });
        expect(result).toBe(WIN_TARGET);
        expect(link).toHaveBeenCalledWith(WIN_SRC, WIN_TARGET);
        expect(copy).not.toHaveBeenCalled();
    });

    it("falls back to copy when linkSync throws (e.g. EXDEV cross-volume)", () => {
        const link = vi.fn(() => { throw Object.assign(new Error("EXDEV"), { code: "EXDEV" }); });
        const copy = vi.fn();
        const result = ensureRenamedChromium(WIN_SRC, {
            fileExists: () => false,
            link,
            copy,
        });
        expect(result).toBe(WIN_TARGET);
        expect(link).toHaveBeenCalledOnce();
        expect(copy).toHaveBeenCalledWith(WIN_SRC, WIN_TARGET);
    });

    it("returns null when both link and copy throw", () => {
        const link = vi.fn(() => { throw new Error("link failed"); });
        const copy = vi.fn(() => { throw new Error("copy failed"); });
        const result = ensureRenamedChromium(WIN_SRC, {
            fileExists: () => false,
            link,
            copy,
        });
        expect(result).toBeNull();
        expect(link).toHaveBeenCalledOnce();
        expect(copy).toHaveBeenCalledOnce();
    });

    it("preserves source extension (mac/linux source has no extension → target has none)", () => {
        // path.* uses host separators, so we just verify the basename behavior.
        const link = vi.fn();
        const noExtSource = "/some/dir/Chromium";
        const result = ensureRenamedChromium(noExtSource, {
            fileExists: () => false,
            link,
            copy: vi.fn(),
        });
        expect(result).not.toBeNull();
        // basename has no extension on mac/linux source
        const basename = result!.split(/[\\/]/).pop();
        expect(basename).toBe("dgui-ui");
    });

    it("uses .exe extension when source is chrome.exe", () => {
        const link = vi.fn();
        const result = ensureRenamedChromium(WIN_SRC, {
            fileExists: () => false,
            link,
            copy: vi.fn(),
        });
        const basename = result!.split(/[\\/]/).pop();
        expect(basename).toBe("dgui-ui.exe");
    });
});
