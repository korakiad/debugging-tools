import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
    name: string;
    dependencies?: Record<string, string>;
}

// Guardrail for the debug-gui publishing quirk.
//
// packages/debug-gui/package.json is what npm publishes to consumers.
// packages/debug-gui/server/package.json ships INSIDE the tarball via
// `files`, but npm never installs its deps for consumers — it only reads
// the outer manifest. Any runtime dep declared only in the server
// workspace will throw `Cannot find module '<x>'` for end users (exactly
// how `tree-kill` and `@puppeteer/browsers` got missed).
//
// Policy: name + version-range equality. A server dep is "missing from
// outer" iff outer lacks the name OR declares a different version range.
// Catches both the bugs we already saw AND future drift (e.g. server
// bumps a dep's major and outer is left behind).
function findMissingOuterDeps(outer: PackageJson, server: PackageJson): string[] {
    const outerDeps = outer.dependencies ?? {};
    const serverDeps = server.dependencies ?? {};
    const missing: string[] = [];
    for (const [name, range] of Object.entries(serverDeps)) {
        if (outerDeps[name] !== range) missing.push(`${name}@${range}`);
    }
    return missing;
}

describe("publish-deps sync (outer package.json vs server/package.json)", () => {
    it("returns [] when outer fully mirrors server runtime deps", () => {
        const outer: PackageJson = {
            name: "@debug-tools/ui",
            dependencies: { express: "^4.19.2", "tree-kill": "^1.2.2" },
        };
        const server: PackageJson = {
            name: "@debug-gui/server",
            dependencies: { express: "^4.19.2", "tree-kill": "^1.2.2" },
        };
        expect(findMissingOuterDeps(outer, server)).toEqual([]);
    });

    it("flags a server dep that outer does not declare", () => {
        const outer: PackageJson = {
            name: "@debug-tools/ui",
            dependencies: { express: "^4.19.2" },
        };
        const server: PackageJson = {
            name: "@debug-gui/server",
            dependencies: { express: "^4.19.2", "tree-kill": "^1.2.2" },
        };
        const missing = findMissingOuterDeps(outer, server);
        expect(missing.length).toBe(1);
        expect(missing[0]).toContain("tree-kill");
    });

    it("the real outer manifest is in sync with the real server manifest", () => {
        const outer = JSON.parse(
            readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
        ) as PackageJson;
        const server = JSON.parse(
            readFileSync(join(__dirname, "..", "package.json"), "utf8"),
        ) as PackageJson;
        expect(findMissingOuterDeps(outer, server)).toEqual([]);
    });
});
