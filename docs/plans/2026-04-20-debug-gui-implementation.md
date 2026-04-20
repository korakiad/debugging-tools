# Debug GUI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a pure web-app debug GUI (Playwright UI–style) that drives the existing `walkthrough` skill through a Copilot-SDK–powered agent, so non-technical QA can debug failing E2E tests with clicks instead of CLI typing.

**Architecture:** Monorepo package `packages/debug-gui/`. Backend (Express + ws) spawns mocha (reusing the project's `walkthrough-hooker.js` + `package.json:mocha` config), runs a Copilot CLI agent via `copilot-sdk` with `skillDirectories: [".claude/skills"]`, overrides `edit_file` to route through a UI diff modal, and exposes `pick_element` as a custom tool. Frontend (React + Vite + shadcn) renders a test tree, cockpit, diff view, chat drawer, and picker overlay.

**Tech Stack:** Node 20 · TypeScript · Express · `ws` · `@github/copilot-sdk` · React · Vite · Tailwind · shadcn/ui · `@assistant-ui/react` · `react-diff-viewer-continued` · Vitest · Supertest

**Design reference:** `docs/plans/2026-04-20-debug-gui-design.md`

---

## Preconditions (one-time, before Task 1)

- Node 20+ installed
- Chrome launched with `--remote-debugging-port=9222` when testing
- `typescript-language-server` installed globally: `npm install -g typescript-language-server`
- Logged into Copilot: `gh auth login` (with Copilot subscription)
- Working branch: `feature/debug-gui` (create if missing)

Confirm each precondition in the first task before touching code.

---

## Phase 0 — Scaffold monorepo structure

### Task 1: Verify preconditions and create branch

**Files:** none yet

**Step 1: Check Node version**

Run: `node --version`
Expected: `v20.x.x` or newer (fail immediately if lower)

**Step 2: Confirm copilot-sdk is reachable via npm**

Run: `npm view @github/copilot-sdk version`
Expected: version string printed

**Step 3: Confirm typescript-language-server installed**

Run: `typescript-language-server --version`
Expected: version string. If missing: `npm install -g typescript-language-server`

**Step 4: Create working branch**

Run:
```bash
git checkout -b feature/debug-gui
```
Expected: `Switched to a new branch 'feature/debug-gui'`

**Step 5: No commit** — branch creation only.

---

### Task 2: Create monorepo workspace config

**Files:**
- Modify: `package.json` (root) — add `workspaces`
- Create: `packages/debug-gui/package.json`
- Create: `packages/debug-gui/.gitignore`

**Step 1: Read root `package.json`**

Run: `cat package.json`
Expected: existing content; note current fields so nothing is dropped

**Step 2: Edit root `package.json` — add workspaces**

Add (preserve all existing fields):
```json
{
  "workspaces": ["packages/*"]
}
```

**Step 3: Create the package directory and its `package.json`**

`packages/debug-gui/package.json`:
```json
{
  "name": "@debug-tools/ui",
  "version": "0.0.1",
  "private": true,
  "description": "Web GUI for walkthrough E2E debug sessions",
  "bin": {
    "debug-gui": "./bin/debug-gui.js"
  },
  "workspaces": ["server", "web"],
  "scripts": {
    "build": "npm run build -w server && npm run build -w web",
    "dev": "npm run dev -w server & npm run dev -w web",
    "test": "npm run test -w server && npm run test -w web"
  }
}
```

**Step 4: Create `.gitignore`**

`packages/debug-gui/.gitignore`:
```
node_modules/
dist/
*.log
.vite/
coverage/
```

**Step 5: Verify npm can resolve workspaces**

Run: `npm install --ignore-scripts --workspaces`
Expected: no errors; `package-lock.json` updated

**Step 6: Commit**

```bash
git add package.json packages/debug-gui/package.json packages/debug-gui/.gitignore
git commit -m "chore: scaffold debug-gui monorepo package"
```

---

### Task 3: Initialize `server` workspace

**Files:**
- Create: `packages/debug-gui/server/package.json`
- Create: `packages/debug-gui/server/tsconfig.json`
- Create: `packages/debug-gui/server/vitest.config.ts`
- Create: `packages/debug-gui/server/src/index.ts` (placeholder)
- Create: `packages/debug-gui/server/test/sanity.test.ts`

**Step 1: Create `server/package.json`**

```json
{
  "name": "@debug-gui/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@github/copilot-sdk": "^0.1.0",
    "express": "^4.19.2",
    "ws": "^8.17.0",
    "open": "^10.1.0",
    "zod": "^3.23.0",
    "glob": "^10.3.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.10",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["test/**/*.test.ts"],
    },
});
```

**Step 4: Create placeholder entry**

`packages/debug-gui/server/src/index.ts`:
```ts
export const VERSION = "0.0.1";
```

**Step 5: Write a sanity test**

`packages/debug-gui/server/test/sanity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { VERSION } from "../src/index.js";

describe("sanity", () => {
    it("exports a version string", () => {
        expect(VERSION).toBe("0.0.1");
    });
});
```

**Step 6: Install and run**

Run (from repo root):
```bash
npm install
npm run test -w @debug-gui/server
```
Expected: 1 passed

**Step 7: Commit**

```bash
git add packages/debug-gui/server package-lock.json
git commit -m "chore: init debug-gui server workspace with vitest"
```

---

### Task 4: Initialize `web` workspace

**Files:**
- Create: `packages/debug-gui/web/package.json`
- Create: `packages/debug-gui/web/tsconfig.json`, `tsconfig.node.json`
- Create: `packages/debug-gui/web/vite.config.ts`
- Create: `packages/debug-gui/web/index.html`
- Create: `packages/debug-gui/web/src/main.tsx`
- Create: `packages/debug-gui/web/src/App.tsx`
- Create: `packages/debug-gui/web/postcss.config.js`, `tailwind.config.js`
- Create: `packages/debug-gui/web/src/index.css`

**Step 1: Create `web/package.json`**

```json
{
  "name": "@debug-gui/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@assistant-ui/react": "^0.5.0",
    "react-diff-viewer-continued": "^3.4.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "jsdom": "^24.0.0"
  }
}
```

**Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`web/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

**Step 3: Create `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5555,
        proxy: {
            "/api": "http://localhost:5556",
            "/ws": { target: "ws://localhost:5556", ws: true },
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./src/test-setup.ts"],
    },
});
```

(Dev: vite on `:5555` proxies to backend `:5556`. Prod: backend serves static build on `:5555`.)

**Step 4: Create Tailwind + PostCSS configs**

`web/postcss.config.js`:
```js
export default {
    plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

`web/tailwind.config.js`:
```js
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: { extend: {} },
    plugins: [],
};
```

**Step 5: Create entry files**

`web/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Debug GUI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
```

`web/src/App.tsx`:
```tsx
export default function App() {
    return <div className="p-8 text-lg">Debug GUI (scaffold)</div>;
}
```

`web/src/test-setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

**Step 6: Install and build**

Run:
```bash
npm install
npm run build -w @debug-gui/web
```
Expected: `dist/` folder created, no errors

**Step 7: Commit**

```bash
git add packages/debug-gui/web package-lock.json
git commit -m "chore: init debug-gui web workspace with vite+react+tailwind"
```

---

## Phase 1 — Backend foundation

### Task 5: Config parser (read `package.json:mocha` + `debug-gui`)

Use **@superpowers:test-driven-development** for this task.

**Files:**
- Create: `packages/debug-gui/server/src/config.ts`
- Create: `packages/debug-gui/server/test/config.test.ts`

**Step 1: Write failing test**

`test/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadConfig", () => {
    it("reads mocha + debug-gui sections from package.json", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            mocha: { file: ["./hooks.js"], require: "tsx", exclude: ["dist/**"] },
            "debug-gui": { cdp: { port: 9222 }, walkthroughPort: 3456 }
        }));

        const cfg = loadConfig(dir);

        expect(cfg.mocha.file).toEqual(["./hooks.js"]);
        expect(cfg.mocha.require).toBe("tsx");
        expect(cfg.cdp.port).toBe(9222);
        expect(cfg.walkthroughPort).toBe(3456);
    });

    it("applies defaults when debug-gui section missing", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}));

        const cfg = loadConfig(dir);

        expect(cfg.cdp.port).toBe(9222);
        expect(cfg.walkthroughPort).toBe(3456);
        expect(cfg.discovery.globs).toContain("test/**/*.spec.{js,ts}");
    });
});
```

**Step 2: Run test — verify fail**

Run: `npm run test -w @debug-gui/server -- config`
Expected: FAIL — `loadConfig is not defined`

**Step 3: Implement**

`src/config.ts`:
```ts
import { readFileSync } from "fs";
import { join } from "path";

export interface DebugGuiConfig {
    mocha: {
        file?: string[];
        require?: string | string[];
        exclude?: string[];
        spec?: string[];
    };
    cdp: { port: number };
    walkthroughPort: number;
    discovery: { globs: string[] };
}

const DEFAULT_GLOBS = [
    "test/**/*.spec.{js,ts}",
    "spec/**/*.test.{js,ts}",
];

export function loadConfig(cwd: string): DebugGuiConfig {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const dg = pkg["debug-gui"] ?? {};
    return {
        mocha: pkg.mocha ?? {},
        cdp: { port: dg.cdp?.port ?? 9222 },
        walkthroughPort: dg.walkthroughPort ?? 3456,
        discovery: { globs: dg.discovery?.globs ?? DEFAULT_GLOBS },
    };
}
```

**Step 4: Run test — verify pass**

Run: `npm run test -w @debug-gui/server -- config`
Expected: 2 passed

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/config.ts packages/debug-gui/server/test/config.test.ts
git commit -m "feat(debug-gui): load config from package.json mocha + debug-gui sections"
```

---

### Task 6: Suite discovery (glob + filter by mocha.exclude)

**Files:**
- Create: `packages/debug-gui/server/src/discovery.ts`
- Create: `packages/debug-gui/server/test/discovery.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { discoverSuites } from "../src/discovery.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("discoverSuites", () => {
    it("finds specs matching globs and respects exclude", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        mkdirSync(join(dir, "test"), { recursive: true });
        mkdirSync(join(dir, "test/playwright"), { recursive: true });
        writeFileSync(join(dir, "test/login.spec.js"), "");
        writeFileSync(join(dir, "test/cart.spec.js"), "");
        writeFileSync(join(dir, "test/playwright/foo.spec.js"), "");

        const suites = discoverSuites(dir, {
            globs: ["test/**/*.spec.{js,ts}"],
            exclude: ["test/playwright/**"],
        });

        const names = suites.map((s) => s.relPath).sort();
        expect(names).toEqual(["test/cart.spec.js", "test/login.spec.js"]);
    });
});
```

**Step 2: Run — expect FAIL**

**Step 3: Implement**

`src/discovery.ts`:
```ts
import { globSync } from "glob";

export interface Suite {
    relPath: string;
    absPath: string;
}

export function discoverSuites(
    cwd: string,
    opts: { globs: string[]; exclude?: string[] }
): Suite[] {
    const matches = globSync(opts.globs, {
        cwd,
        ignore: opts.exclude ?? [],
        absolute: false,
    });
    return matches
        .map((relPath) => ({ relPath, absPath: `${cwd}/${relPath}` }))
        .sort((a, b) => a.relPath.localeCompare(b.relPath));
}
```

**Step 4: Run — expect PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): discover mocha suites via glob with exclude"
```

---

### Task 7: Session state machine

**Files:**
- Create: `packages/debug-gui/server/src/session.ts`
- Create: `packages/debug-gui/server/test/session.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "../src/session.js";

describe("SessionManager", () => {
    it("starts in idle state", () => {
        const s = new SessionManager();
        expect(s.getState().state).toBe("idle");
    });

    it("transitions idle → running on start", () => {
        const s = new SessionManager();
        s.markRunning("login.spec.js");
        expect(s.getState().state).toBe("running");
        expect(s.getState().currentSpec).toBe("login.spec.js");
    });

    it("transitions running → paused with failure", () => {
        const s = new SessionManager();
        s.markRunning("login.spec.js");
        s.markPaused({ test: "t1", file: "login.spec.js", error: "err", stack: "" });
        expect(s.getState().state).toBe("paused");
        expect(s.getState().currentFailure?.error).toBe("err");
    });

    it("emits 'change' event on transitions", () => {
        const s = new SessionManager();
        const listener = vi.fn();
        s.events.on("change", listener);
        s.markRunning("a.spec.js");
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

`src/session.ts`:
```ts
import { EventEmitter } from "events";

export type SessionState = "idle" | "running" | "paused" | "done";

export interface FailureInfo {
    test: string;
    file: string;
    error: string;
    stack: string;
    suite?: string;
}

export interface SessionSnapshot {
    state: SessionState;
    currentSpec?: string;
    currentFailure?: FailureInfo;
}

export class SessionManager {
    readonly events = new EventEmitter();
    private snapshot: SessionSnapshot = { state: "idle" };

    getState(): SessionSnapshot {
        return { ...this.snapshot };
    }

    markRunning(spec: string): void {
        this.snapshot = { state: "running", currentSpec: spec };
        this.events.emit("change", this.getState());
    }

    markPaused(failure: FailureInfo): void {
        this.snapshot = { ...this.snapshot, state: "paused", currentFailure: failure };
        this.events.emit("change", this.getState());
    }

    markResumed(): void {
        this.snapshot = { ...this.snapshot, state: "running", currentFailure: undefined };
        this.events.emit("change", this.getState());
    }

    markDone(): void {
        this.snapshot = { state: "done", currentSpec: this.snapshot.currentSpec };
        this.events.emit("change", this.getState());
    }

    reset(): void {
        this.snapshot = { state: "idle" };
        this.events.emit("change", this.getState());
    }
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): SessionManager state machine with events"
```

---

### Task 8: Mocha runner (spawn + hooker polling)

**Files:**
- Create: `packages/debug-gui/server/src/runner.ts`
- Create: `packages/debug-gui/server/test/runner.test.ts`

**Step 1: Failing test — we verify command assembly and env, not real spawn**

```ts
import { describe, it, expect } from "vitest";
import { buildMochaCommand } from "../src/runner.js";

describe("buildMochaCommand", () => {
    it("injects WALKTHROUGH_PORT and propagates mocha require", () => {
        const cmd = buildMochaCommand({
            spec: "test/login.spec.js",
            walkthroughPort: 3456,
            mocha: { require: "tsx", file: ["./hooks.js"] },
        });
        expect(cmd.env.WALKTHROUGH_PORT).toBe("3456");
        // mocha reads package.json:mocha itself — no duplication in args
        expect(cmd.args).toContain("test/login.spec.js");
        expect(cmd.command).toBe("npx");
    });

    it("uses custom mocha command when provided", () => {
        const cmd = buildMochaCommand({
            spec: "test/login.spec.js",
            walkthroughPort: 3456,
            mocha: {},
            customCommand: "./bin/mocha",
        });
        expect(cmd.command).toBe("./bin/mocha");
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

`src/runner.ts`:
```ts
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface BuildOptions {
    spec: string;
    walkthroughPort: number;
    mocha: { require?: string | string[]; file?: string[] };
    customCommand?: string;
}

export interface MochaCommand {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
}

export function buildMochaCommand(opts: BuildOptions): MochaCommand {
    const command = opts.customCommand ?? "npx";
    const args = opts.customCommand ? [opts.spec] : ["mocha", opts.spec];
    return {
        command,
        args,
        env: { ...process.env, WALKTHROUGH_PORT: String(opts.walkthroughPort) },
    };
}

export class MochaRunner extends EventEmitter {
    private proc?: ChildProcess;

    start(cmd: MochaCommand, logFile: string): ChildProcess {
        this.proc = spawn(cmd.command, cmd.args, { env: cmd.env, shell: true });
        this.proc.stdout?.on("data", (d) => this.emit("stdout", d.toString()));
        this.proc.stderr?.on("data", (d) => this.emit("stderr", d.toString()));
        this.proc.on("exit", (code) => this.emit("exit", code));
        return this.proc;
    }

    kill(): void {
        this.proc?.kill();
    }
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): buildMochaCommand + MochaRunner spawn wrapper"
```

---

### Task 9: Hooker IPC poller

**Files:**
- Create: `packages/debug-gui/server/src/hooker.ts`
- Create: `packages/debug-gui/server/test/hooker.test.ts`

**Step 1: Failing test — use mocked fetch**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookerClient } from "../src/hooker.js";

describe("HookerClient", () => {
    beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it("getStatus returns parsed JSON", async () => {
        (fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ state: "running", startedAt: 1 }),
        });
        const client = new HookerClient(3456);
        expect(await client.getStatus()).toEqual({ state: "running", startedAt: 1 });
    });

    it("getPaused returns failure object", async () => {
        (fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ test: "t", file: "a", error: "e", stack: "" }),
        });
        const client = new HookerClient(3456);
        const p = await client.getPaused();
        expect(p.test).toBe("t");
    });

    it("postContinue sends POST request", async () => {
        (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
        const client = new HookerClient(3456);
        await client.postContinue();
        expect(fetch).toHaveBeenCalledWith(
            "http://127.0.0.1:3456/continue",
            expect.objectContaining({ method: "POST" })
        );
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

`src/hooker.ts`:
```ts
export class HookerClient {
    private base: string;
    constructor(port: number) {
        this.base = `http://127.0.0.1:${port}`;
    }

    async getStatus(): Promise<{ state: string; startedAt?: number; pausedAt?: number; finishedAt?: number }> {
        const r = await fetch(`${this.base}/status`);
        if (!r.ok) throw new Error(`hooker /status ${r.status}`);
        return r.json();
    }

    async getPaused(): Promise<{ test: string; file: string; error: string; stack: string; suite?: string }> {
        const r = await fetch(`${this.base}/paused`);
        if (!r.ok) throw new Error(`hooker /paused ${r.status}`);
        return r.json();
    }

    async postContinue(): Promise<void> {
        const r = await fetch(`${this.base}/continue`, { method: "POST" });
        if (!r.ok) throw new Error(`hooker /continue ${r.status}`);
    }
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): HookerClient for walkthrough-hooker HTTP IPC"
```

---

### Task 10: Express API scaffold + `/api/init`

**Files:**
- Create: `packages/debug-gui/server/src/server.ts`
- Create: `packages/debug-gui/server/test/server.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

describe("API /api/init", () => {
    it("returns suites, config, and current state", async () => {
        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({
                suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
                config: { walkthroughPort: 3456 } as any,
                state: { state: "idle" },
            }),
        });
        const res = await request(app).get("/api/init").expect(200);
        expect(res.body.suites[0].relPath).toBe("a.spec.js");
        expect(res.body.state.state).toBe("idle");
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

`src/server.ts`:
```ts
import express, { Express } from "express";
import { Suite } from "./discovery.js";
import { DebugGuiConfig } from "./config.js";
import { SessionSnapshot } from "./session.js";

export interface InitPayload {
    suites: Suite[];
    config: DebugGuiConfig;
    state: SessionSnapshot;
}

export interface AppDeps {
    cwd: string;
    loadInit: () => InitPayload;
}

export function createApp(deps: AppDeps): Express {
    const app = express();
    app.use(express.json());
    app.get("/api/init", (_req, res) => {
        res.json(deps.loadInit());
    });
    return app;
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): Express app scaffold + /api/init"
```

---

### Task 11: WebSocket hub + message router

**Files:**
- Modify: `packages/debug-gui/server/src/server.ts` (add `createWsHub`)
- Create: `packages/debug-gui/server/src/messages.ts` (types only)
- Create: `packages/debug-gui/server/test/ws.test.ts`

**Step 1: Create message type module first**

`src/messages.ts`:
```ts
import type { FailureInfo, SessionSnapshot } from "./session.js";

export type ServerEvent =
    | { type: "init"; suites: unknown[]; config: unknown; state: SessionSnapshot }
    | { type: "status"; state: SessionSnapshot["state"] }
    | { type: "paused"; failure: FailureInfo }
    | { type: "test_progress"; test: string; result: "pass" | "fail" | "pending" }
    | { type: "chat_delta"; text: string }
    | { type: "chat_final"; content: string }
    | { type: "diff"; reqId: string; file: string; oldCode: string; newCode: string }
    | { type: "pick"; reqId: string; imageUrl: string; hint: string }
    | { type: "error"; message: string };

export type ClientCommand =
    | { type: "run"; spec: string }
    | { type: "cancel" }
    | { type: "chat_send"; prompt: string }
    | { type: "diff_decision"; reqId: string; action: "approved" | "rejected"; reason?: string }
    | { type: "pick_result"; reqId: string; selector: string; attrs: Record<string, unknown> };
```

**Step 2: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { WsHub } from "../src/server.js";

describe("WsHub", () => {
    it("broadcasts to all registered sockets", () => {
        const hub = new WsHub();
        const s1: any = { send: (data: string) => (s1.sent = data), readyState: 1 };
        const s2: any = { send: (data: string) => (s2.sent = data), readyState: 1 };
        hub.add(s1); hub.add(s2);
        hub.broadcast({ type: "status", state: "running" });
        expect(JSON.parse(s1.sent).type).toBe("status");
        expect(JSON.parse(s2.sent).type).toBe("status");
    });

    it("routes client commands via onMessage", () => {
        const hub = new WsHub();
        const received: any[] = [];
        hub.onMessage((c) => received.push(c));
        hub.handleIncoming('{"type":"run","spec":"a.spec.js"}');
        expect(received[0].type).toBe("run");
        expect(received[0].spec).toBe("a.spec.js");
    });
});
```

**Step 3: Run — FAIL**

**Step 4: Implement — add to `server.ts`**

Append to existing `server.ts`:
```ts
import type { WebSocket } from "ws";
import type { ServerEvent, ClientCommand } from "./messages.js";

export class WsHub {
    private sockets = new Set<WebSocket>();
    private handlers = new Set<(c: ClientCommand) => void>();

    add(ws: WebSocket): void { this.sockets.add(ws); }
    remove(ws: WebSocket): void { this.sockets.delete(ws); }

    broadcast(event: ServerEvent): void {
        const payload = JSON.stringify(event);
        for (const ws of this.sockets) {
            if (ws.readyState === 1) ws.send(payload);
        }
    }

    onMessage(fn: (cmd: ClientCommand) => void): void {
        this.handlers.add(fn);
    }

    handleIncoming(raw: string): void {
        try {
            const cmd = JSON.parse(raw) as ClientCommand;
            for (const fn of this.handlers) fn(cmd);
        } catch (e) {
            // ignore malformed
        }
    }
}
```

**Step 5: Run — PASS**

**Step 6: Commit**

```bash
git commit -am "feat(debug-gui): WsHub for WebSocket broadcast + command routing"
```

---

### Task 12: Wire runner + hooker polling into SessionManager

**Files:**
- Create: `packages/debug-gui/server/src/orchestrator.ts`
- Create: `packages/debug-gui/server/test/orchestrator.test.ts`

**Step 1: Failing test — mock HookerClient**

```ts
import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { SessionManager } from "../src/session.js";

describe("Orchestrator", () => {
    it("transitions session to paused when hooker reports paused", async () => {
        const session = new SessionManager();
        const hooker = {
            getStatus: vi.fn().mockResolvedValue({ state: "paused" }),
            getPaused: vi.fn().mockResolvedValue({
                test: "t1", file: "a.spec.js", error: "e", stack: "",
            }),
            postContinue: vi.fn(),
        };
        const orch = new Orchestrator(session, hooker as any);
        session.markRunning("a.spec.js");
        await orch.pollOnce();
        expect(session.getState().state).toBe("paused");
        expect(session.getState().currentFailure?.test).toBe("t1");
    });

    it("transitions to done when hooker reports done", async () => {
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        const hooker = { getStatus: vi.fn().mockResolvedValue({ state: "done" }) } as any;
        const orch = new Orchestrator(session, hooker);
        await orch.pollOnce();
        expect(session.getState().state).toBe("done");
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

`src/orchestrator.ts`:
```ts
import { SessionManager } from "./session.js";
import { HookerClient } from "./hooker.js";

export class Orchestrator {
    private timer?: NodeJS.Timeout;
    constructor(
        private session: SessionManager,
        private hooker: HookerClient
    ) {}

    async pollOnce(): Promise<void> {
        const status = await this.hooker.getStatus();
        const current = this.session.getState().state;
        if (status.state === "paused" && current !== "paused") {
            const failure = await this.hooker.getPaused();
            this.session.markPaused(failure);
        } else if (status.state === "done") {
            this.session.markDone();
        }
    }

    start(intervalMs = 500): void {
        this.timer = setInterval(() => this.pollOnce().catch(() => {}), intervalMs);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
    }
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): Orchestrator polls hooker and updates session"
```

---

## Phase 2 — Agent integration

### Task 13: Add LSP config file

**Files:**
- Create: `.github/lsp.json`

**Step 1: Write the file**

`.github/lsp.json`:
```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileExtensions": {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript"
      }
    }
  }
}
```

**Step 2: Verify shape is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.github/lsp.json','utf8'))"`
Expected: no output (success)

**Step 3: Commit**

```bash
git add .github/lsp.json
git commit -m "chore: add Copilot CLI LSP config (typescript-language-server)"
```

---

### Task 14: Copilot agent wrapper with skill directories

**Files:**
- Create: `packages/debug-gui/server/src/agent.ts`
- Create: `packages/debug-gui/server/test/agent.test.ts`

**Step 1: Failing test — verify config plumbing only (no real CLI)**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildSessionConfig } from "../src/agent.js";

describe("buildSessionConfig", () => {
    it("sets skillDirectories to .claude/skills", () => {
        const cfg = buildSessionConfig({
            cwd: "/repo",
            tools: [],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.skillDirectories).toEqual(["/repo/.claude/skills"]);
    });

    it("attaches custom tools", () => {
        const cfg = buildSessionConfig({
            cwd: "/repo",
            tools: [{ name: "pick_element" } as any],
            onPick: vi.fn(),
            onEdit: vi.fn(),
        });
        expect(cfg.tools?.length).toBe(1);
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement (buildSessionConfig only — real CopilotClient wired in Task 17)**

`src/agent.ts`:
```ts
import { approveAll } from "@github/copilot-sdk";
import { join } from "path";

export interface AgentDeps {
    cwd: string;
    tools: unknown[];
    onPick: (hint: string) => Promise<Record<string, unknown>>;
    onEdit: (file: string, oldCode: string, newCode: string) => Promise<{ approved: boolean; reason?: string }>;
}

export function buildSessionConfig(deps: AgentDeps) {
    return {
        skillDirectories: [join(deps.cwd, ".claude/skills")],
        tools: deps.tools,
        onPermissionRequest: approveAll,
    };
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): buildSessionConfig wires skillDirectories + approveAll"
```

---

### Task 15: `edit_file` override tool

**Files:**
- Create: `packages/debug-gui/server/src/tools/editFile.ts`
- Create: `packages/debug-gui/server/test/tools/editFile.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { makeEditFileTool } from "../../src/tools/editFile.js";
import { writeFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("edit_file override", () => {
    it("writes file when approved", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "a.js");
        writeFileSync(file, "old");
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: true }),
        });
        const result = await (tool as any).handler({ path: file, oldContent: "old", newContent: "new" }, {});
        expect(result.applied).toBe(true);
        expect(readFileSync(file, "utf8")).toBe("new");
    });

    it("returns rejection when denied", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "a.js");
        writeFileSync(file, "old");
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: false, reason: "wrong" }),
        });
        const result = await (tool as any).handler({ path: file, oldContent: "old", newContent: "new" }, {});
        expect(result.applied).toBe(false);
        expect(result.rejection).toBe("wrong");
        expect(readFileSync(file, "utf8")).toBe("old");
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

`src/tools/editFile.ts`:
```ts
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { writeFile } from "fs/promises";

export interface EditFileDeps {
    onPropose: (
        file: string,
        oldCode: string,
        newCode: string
    ) => Promise<{ approved: boolean; reason?: string }>;
}

export function makeEditFileTool(deps: EditFileDeps) {
    return defineTool("edit_file", {
        description: "Edit a file after QA reviews the diff. Always routes through the UI diff modal.",
        overridesBuiltInTool: true,
        parameters: z.object({
            path: z.string(),
            oldContent: z.string(),
            newContent: z.string(),
        }),
        handler: async ({ path, oldContent, newContent }) => {
            const decision = await deps.onPropose(path, oldContent, newContent);
            if (decision.approved) {
                await writeFile(path, newContent);
                return { applied: true };
            }
            return { applied: false, rejection: decision.reason ?? "rejected" };
        },
    });
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): edit_file override routes through UI diff modal"
```

---

### Task 16: `pick_element` custom tool

**Files:**
- Create: `packages/debug-gui/server/src/tools/pickElement.ts`
- Create: `packages/debug-gui/server/test/tools/pickElement.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { makePickElementTool } from "../../src/tools/pickElement.js";

describe("pick_element", () => {
    it("calls onPick with hint and returns attrs", async () => {
        const onPick = vi.fn().mockResolvedValue({
            tag: "BUTTON", id: "", testid: "login-submit", aria: "Login",
        });
        const tool = makePickElementTool({ onPick });
        const result = await (tool as any).handler({ hint: "login button" }, {});
        expect(onPick).toHaveBeenCalledWith("login button");
        expect(result.testid).toBe("login-submit");
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

`src/tools/pickElement.ts`:
```ts
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export interface PickElementDeps {
    onPick: (hint: string) => Promise<Record<string, unknown>>;
}

export function makePickElementTool(deps: PickElementDeps) {
    return defineTool("pick_element", {
        description: "Ask QA to visually click the target element on the current page. Returns DOM attributes the agent can turn into a selector.",
        parameters: z.object({
            hint: z.string().describe("natural-language description of the element QA should click"),
        }),
        handler: async ({ hint }) => {
            return await deps.onPick(hint);
        },
    });
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): pick_element custom tool for visual selector picking"
```

---

### Task 17: Main entry wiring (integrate all pieces)

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`

**Step 1: Replace placeholder with full wiring**

`src/index.ts`:
```ts
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import open from "open";
import { loadConfig } from "./config.js";
import { discoverSuites } from "./discovery.js";
import { SessionManager } from "./session.js";
import { HookerClient } from "./hooker.js";
import { MochaRunner, buildMochaCommand } from "./runner.js";
import { Orchestrator } from "./orchestrator.js";
import { createApp, WsHub } from "./server.js";
import { buildSessionConfig } from "./agent.js";
import { makeEditFileTool } from "./tools/editFile.js";
import { makePickElementTool } from "./tools/pickElement.js";
import { CopilotClient } from "@github/copilot-sdk";

export const VERSION = "0.0.1";

export async function main(cwd: string = process.cwd(), port: number = 5556): Promise<void> {
    const config = loadConfig(cwd);
    const suites = discoverSuites(cwd, {
        globs: config.discovery.globs,
        exclude: config.mocha.exclude,
    });

    const session = new SessionManager();
    const hooker = new HookerClient(config.walkthroughPort);
    const orch = new Orchestrator(session, hooker);
    const runner = new MochaRunner();
    const hub = new WsHub();

    // Pending request maps — for tool round-trips
    const editResolvers = new Map<string, (d: { approved: boolean; reason?: string }) => void>();
    const pickResolvers = new Map<string, (attrs: Record<string, unknown>) => void>();

    const app = createApp({
        cwd,
        loadInit: () => ({ suites, config, state: session.getState() }),
    });
    const server = http.createServer(app);

    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (ws) => {
        hub.add(ws);
        ws.send(JSON.stringify({ type: "init", suites, config, state: session.getState() }));
        ws.on("message", (raw) => hub.handleIncoming(raw.toString()));
        ws.on("close", () => hub.remove(ws));
    });

    // Broadcast session changes
    session.events.on("change", (snap) => {
        hub.broadcast({ type: "status", state: snap.state });
        if (snap.state === "paused" && snap.currentFailure) {
            hub.broadcast({ type: "paused", failure: snap.currentFailure });
        }
    });

    // Set up Copilot client (deferred start)
    const copilot = new CopilotClient();
    await copilot.start();

    const tools = [
        makeEditFileTool({
            onPropose: async (file, oldCode, newCode) => {
                const reqId = Math.random().toString(36).slice(2);
                return await new Promise((resolve) => {
                    editResolvers.set(reqId, resolve);
                    hub.broadcast({ type: "diff", reqId, file, oldCode, newCode });
                });
            },
        }),
        makePickElementTool({
            onPick: async (hint) => {
                const reqId = Math.random().toString(36).slice(2);
                // TODO Task 18: take screenshot via playwright-cli, pass imageUrl
                const imageUrl = "";
                return await new Promise((resolve) => {
                    pickResolvers.set(reqId, resolve);
                    hub.broadcast({ type: "pick", reqId, imageUrl, hint });
                });
            },
        }),
    ];

    // Handle client commands
    hub.onMessage(async (cmd) => {
        if (cmd.type === "run") {
            const spec = suites.find((s) => s.relPath === cmd.spec)?.absPath;
            if (!spec) return;
            const mochaCmd = buildMochaCommand({
                spec,
                walkthroughPort: config.walkthroughPort,
                mocha: config.mocha,
            });
            runner.start(mochaCmd, "/tmp/walkthrough-mocha.log");
            session.markRunning(cmd.spec);
            orch.start(500);

            // Create Copilot session on first run
            const agentSession = await copilot.createSession(
                buildSessionConfig({ cwd, tools, onPick: () => Promise.resolve({}), onEdit: async () => ({ approved: true }) })
            );

            session.events.once("change", async (snap) => {
                if (snap.state === "paused") {
                    await agentSession.send({
                        prompt: "A test just failed. Read /paused via curl, then follow the walkthrough SKILL to investigate and propose fixes.",
                    });
                }
            });
        }
        if (cmd.type === "diff_decision") {
            const resolver = editResolvers.get(cmd.reqId);
            if (resolver) {
                resolver({ approved: cmd.action === "approved", reason: cmd.reason });
                editResolvers.delete(cmd.reqId);
            }
        }
        if (cmd.type === "pick_result") {
            const resolver = pickResolvers.get(cmd.reqId);
            if (resolver) {
                resolver(cmd.attrs);
                pickResolvers.delete(cmd.reqId);
            }
        }
        if (cmd.type === "cancel") {
            runner.kill();
            orch.stop();
            session.reset();
        }
    });

    server.listen(port, () => {
        const url = `http://localhost:5555`;
        console.log(`Debug GUI ready at ${url}`);
        open(url).catch(() => console.log(`Open ${url} in your browser`));
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
```

**Step 2: Typecheck**

Run: `npm run build -w @debug-gui/server`
Expected: compiles cleanly (may show warning if copilot-sdk types mismatch — note and proceed)

**Step 3: Commit**

```bash
git commit -am "feat(debug-gui): wire CopilotClient + runner + orchestrator + ws"
```

---

### Task 18: Screenshot helper for picker

**Files:**
- Create: `packages/debug-gui/server/src/screenshot.ts`
- Modify: `packages/debug-gui/server/src/index.ts` (use it in pickElement)

**Step 1: Implement screenshot helper**

`src/screenshot.ts`:
```ts
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

const exec = promisify(execFile);

export async function captureScreenshot(cdpPort: number): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "dbg-shot-"));
    const file = join(dir, "shot.png");
    await exec("playwright-cli", ["screenshot", "--out", file], {
        env: { ...process.env, PLAYWRIGHT_CDP_PORT: String(cdpPort) },
    });
    return file;
}
```

**Step 2: Modify `index.ts` to use it + expose screenshot via HTTP**

In `src/index.ts`, after the `app` declaration add:
```ts
app.get("/api/screenshot/:id", (req, res) => {
    res.sendFile(req.params.id); // TODO secure — validate path
});
```

Replace the `imageUrl = ""` in `makePickElementTool` with:
```ts
const file = await captureScreenshot(config.cdp.port);
const imageUrl = `/api/screenshot/${encodeURIComponent(file)}`;
```

Add the `captureScreenshot` import.

**Step 3: Typecheck**

Run: `npm run build -w @debug-gui/server`

**Step 4: Commit**

```bash
git commit -am "feat(debug-gui): capture screenshot for picker via playwright-cli"
```

---

## Phase 3 — Frontend state + WS

### Task 19: WebSocket hook + store

**Files:**
- Create: `packages/debug-gui/web/src/hooks/useWebSocket.ts`
- Create: `packages/debug-gui/web/src/state/store.ts`
- Create: `packages/debug-gui/web/src/state/store.test.ts`

**Step 1: Failing store test**

`src/state/store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { useStore } from "./store.js";

describe("store", () => {
    it("initializes with idle state", () => {
        const s = useStore.getState();
        expect(s.state.state).toBe("idle");
    });

    it("apply 'init' event populates suites + config", () => {
        useStore.getState().applyEvent({
            type: "init",
            suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
            config: {} as any,
            state: { state: "idle" },
        });
        expect(useStore.getState().suites[0].relPath).toBe("a.spec.js");
    });

    it("apply 'paused' event sets failure", () => {
        useStore.getState().applyEvent({
            type: "paused",
            failure: { test: "t", file: "a.spec.js", error: "e", stack: "" },
        });
        expect(useStore.getState().state.currentFailure?.test).toBe("t");
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement store**

`src/state/store.ts`:
```ts
import { create } from "zustand";

export type SessionState = "idle" | "running" | "paused" | "done";

interface Suite { relPath: string; absPath: string; }
interface Failure { test: string; file: string; error: string; stack: string; }
interface Snapshot { state: SessionState; currentSpec?: string; currentFailure?: Failure; }
interface Diff { reqId: string; file: string; oldCode: string; newCode: string; }
interface Pick { reqId: string; imageUrl: string; hint: string; }

interface ServerEvent {
    type: string;
    [k: string]: any;
}

interface Store {
    suites: Suite[];
    config: Record<string, unknown>;
    state: Snapshot;
    chatMessages: Array<{ role: "assistant" | "user"; content: string }>;
    pendingDiff: Diff | null;
    pendingPick: Pick | null;
    applyEvent: (e: ServerEvent) => void;
}

export const useStore = create<Store>((set) => ({
    suites: [],
    config: {},
    state: { state: "idle" },
    chatMessages: [],
    pendingDiff: null,
    pendingPick: null,
    applyEvent: (e) =>
        set((s) => {
            if (e.type === "init") {
                return { suites: e.suites, config: e.config, state: e.state };
            }
            if (e.type === "status") {
                return { state: { ...s.state, state: e.state } };
            }
            if (e.type === "paused") {
                return { state: { ...s.state, state: "paused", currentFailure: e.failure } };
            }
            if (e.type === "diff") {
                return { pendingDiff: { reqId: e.reqId, file: e.file, oldCode: e.oldCode, newCode: e.newCode } };
            }
            if (e.type === "pick") {
                return { pendingPick: { reqId: e.reqId, imageUrl: e.imageUrl, hint: e.hint } };
            }
            if (e.type === "chat_delta") {
                const last = s.chatMessages[s.chatMessages.length - 1];
                if (last?.role === "assistant") {
                    return {
                        chatMessages: [...s.chatMessages.slice(0, -1), { ...last, content: last.content + e.text }],
                    };
                }
                return {
                    chatMessages: [...s.chatMessages, { role: "assistant", content: e.text }],
                };
            }
            return {};
        }),
}));
```

**Step 4: Run — PASS**

**Step 5: Implement hook**

`src/hooks/useWebSocket.ts`:
```ts
import { useEffect, useRef } from "react";
import { useStore } from "../state/store";

export function useWebSocket(url: string = "ws://localhost:5555/ws") {
    const ref = useRef<WebSocket | null>(null);
    const apply = useStore((s) => s.applyEvent);

    useEffect(() => {
        const ws = new WebSocket(url);
        ref.current = ws;
        ws.onmessage = (ev) => apply(JSON.parse(ev.data));
        return () => ws.close();
    }, [url, apply]);

    const send = (cmd: Record<string, unknown>) => {
        ref.current?.send(JSON.stringify(cmd));
    };
    return { send };
}
```

**Step 6: Commit**

```bash
git commit -am "feat(debug-gui): zustand store + useWebSocket hook"
```

---

## Phase 4 — Frontend components

### Task 20: `TestTree` component

**Files:**
- Create: `packages/debug-gui/web/src/components/TestTree.tsx`
- Create: `packages/debug-gui/web/src/components/TestTree.test.tsx`

**Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestTree } from "./TestTree";

describe("TestTree", () => {
    it("renders suites and fires onRun when clicked", () => {
        const onRun = vi.fn();
        render(
            <TestTree
                suites={[{ relPath: "test/a.spec.js", absPath: "/x/a.spec.js" }]}
                onRun={onRun}
            />
        );
        const button = screen.getByText("test/a.spec.js");
        fireEvent.click(button);
        expect(onRun).toHaveBeenCalledWith("test/a.spec.js");
    });
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

```tsx
interface Suite { relPath: string; absPath: string; }

export function TestTree({
    suites, onRun,
}: { suites: Suite[]; onRun: (relPath: string) => void }) {
    return (
        <nav className="w-64 border-r h-full overflow-auto p-2">
            <h2 className="text-sm font-bold mb-2">Test Suites</h2>
            <ul>
                {suites.map((s) => (
                    <li key={s.relPath}>
                        <button
                            className="w-full text-left p-2 hover:bg-gray-100"
                            onClick={() => onRun(s.relPath)}
                        >
                            {s.relPath}
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): TestTree component"
```

---

### Task 21: `FailureCard` component

**Files:**
- Create: `packages/debug-gui/web/src/components/FailureCard.tsx`
- Create: `packages/debug-gui/web/src/components/FailureCard.test.tsx`

**Step 1: Failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FailureCard } from "./FailureCard";

it("renders test, file, and error message", () => {
    render(<FailureCard failure={{ test: "login", file: "a.spec.js:15", error: "not found", stack: "" }} />);
    expect(screen.getByText("login")).toBeInTheDocument();
    expect(screen.getByText(/not found/)).toBeInTheDocument();
    expect(screen.getByText("a.spec.js:15")).toBeInTheDocument();
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

```tsx
interface Failure { test: string; file: string; error: string; stack: string; }

export function FailureCard({ failure }: { failure: Failure }) {
    return (
        <div className="border rounded p-4 bg-red-50 space-y-2">
            <div className="font-bold text-red-700">❌ {failure.test}</div>
            <div className="text-sm text-gray-600">📍 {failure.file}</div>
            <pre className="text-xs bg-white p-2 rounded whitespace-pre-wrap">{failure.error}</pre>
            {failure.stack && (
                <details>
                    <summary className="text-xs cursor-pointer">Stack trace</summary>
                    <pre className="text-xs bg-white p-2 rounded mt-1">{failure.stack}</pre>
                </details>
            )}
        </div>
    );
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): FailureCard component"
```

---

### Task 22: `DiffView` component

**Files:**
- Create: `packages/debug-gui/web/src/components/DiffView.tsx`
- Create: `packages/debug-gui/web/src/components/DiffView.test.tsx`

**Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffView } from "./DiffView";

it("fires onApprove/onReject", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
        <DiffView
            file="a.js"
            oldCode="old"
            newCode="new"
            onApprove={onApprove}
            onReject={onReject}
        />
    );
    fireEvent.click(screen.getByText(/approve/i));
    expect(onApprove).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/reject/i));
    expect(onReject).toHaveBeenCalled();
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

```tsx
import ReactDiffViewer from "react-diff-viewer-continued";

export function DiffView({
    file, oldCode, newCode, onApprove, onReject,
}: {
    file: string;
    oldCode: string;
    newCode: string;
    onApprove: () => void;
    onReject: () => void;
}) {
    return (
        <div className="border rounded">
            <div className="text-xs p-2 bg-gray-50 border-b">{file}</div>
            <ReactDiffViewer oldValue={oldCode} newValue={newCode} splitView={false} />
            <div className="p-2 flex gap-2 justify-end border-t">
                <button className="bg-red-500 text-white px-3 py-1 rounded" onClick={onReject}>
                    ✗ Reject
                </button>
                <button className="bg-green-600 text-white px-3 py-1 rounded" onClick={onApprove}>
                    ✓ Approve
                </button>
            </div>
        </div>
    );
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): DiffView component"
```

---

### Task 23: `PickerOverlay` component

**Files:**
- Create: `packages/debug-gui/web/src/components/PickerOverlay.tsx`
- Create: `packages/debug-gui/web/src/components/PickerOverlay.test.tsx`

**Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PickerOverlay } from "./PickerOverlay";

it("calls onPick with click coordinates", () => {
    const onPick = vi.fn();
    render(<PickerOverlay imageUrl="/shot.png" hint="button" onPick={onPick} onCancel={() => {}} />);
    const img = screen.getByAltText("page");
    fireEvent.click(img, { clientX: 120, clientY: 240 });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ x: 120, y: 240 }));
});
```

**Step 2: Run — FAIL**

**Step 3: Implement**

```tsx
export function PickerOverlay({
    imageUrl, hint, onPick, onCancel,
}: {
    imageUrl: string;
    hint: string;
    onPick: (coords: { x: number; y: number }) => void;
    onCancel: () => void;
}) {
    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center p-4">
            <div className="flex justify-between w-full max-w-4xl mb-2 text-white">
                <span>🔍 Click the element: "{hint}"</span>
                <button onClick={onCancel}>✕</button>
            </div>
            <img
                alt="page"
                src={imageUrl}
                className="max-h-[80vh] cursor-crosshair"
                onClick={(e) => onPick({ x: e.clientX, y: e.clientY })}
            />
        </div>
    );
}
```

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git commit -am "feat(debug-gui): PickerOverlay component"
```

---

### Task 24: Chat drawer

**Files:**
- Create: `packages/debug-gui/web/src/components/ChatDrawer.tsx`

**Step 1: Implement (no test — `@assistant-ui/react` owns behaviour)**

```tsx
import { useStore } from "../state/store";

export function ChatDrawer({ onSend }: { onSend: (prompt: string) => void }) {
    const messages = useStore((s) => s.chatMessages);
    return (
        <aside className="w-96 border-l h-full flex flex-col">
            <h2 className="p-2 font-bold text-sm border-b">Chat</h2>
            <div className="flex-1 overflow-auto p-2 space-y-2">
                {messages.map((m, i) => (
                    <div key={i} className="text-sm">
                        <div className="font-bold">{m.role}:</div>
                        <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                ))}
            </div>
            <form
                className="flex border-t"
                onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem("prompt") as HTMLInputElement;
                    if (input.value) { onSend(input.value); input.value = ""; }
                }}
            >
                <input name="prompt" className="flex-1 p-2 text-sm" placeholder="Ask..." />
                <button className="px-3">Send</button>
            </form>
        </aside>
    );
}
```

**Step 2: Typecheck**

Run: `npm run build -w @debug-gui/web`
Expected: success

**Step 3: Commit**

```bash
git commit -am "feat(debug-gui): minimal ChatDrawer (assistant-ui upgrade later)"
```

---

### Task 25: Compose App with all components

**Files:**
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Replace App**

```tsx
import { useWebSocket } from "./hooks/useWebSocket";
import { useStore } from "./state/store";
import { TestTree } from "./components/TestTree";
import { FailureCard } from "./components/FailureCard";
import { DiffView } from "./components/DiffView";
import { PickerOverlay } from "./components/PickerOverlay";
import { ChatDrawer } from "./components/ChatDrawer";

export default function App() {
    const { send } = useWebSocket();
    const suites = useStore((s) => s.suites);
    const state = useStore((s) => s.state);
    const diff = useStore((s) => s.pendingDiff);
    const pick = useStore((s) => s.pendingPick);
    const setDiff = useStore.setState;

    return (
        <div className="flex h-screen">
            <TestTree suites={suites} onRun={(spec) => send({ type: "run", spec })} />
            <main className="flex-1 p-4 overflow-auto space-y-4">
                <div>Status: {state.state}</div>
                {state.currentFailure && <FailureCard failure={state.currentFailure} />}
                {diff && (
                    <DiffView
                        file={diff.file}
                        oldCode={diff.oldCode}
                        newCode={diff.newCode}
                        onApprove={() => {
                            send({ type: "diff_decision", reqId: diff.reqId, action: "approved" });
                            setDiff((s) => ({ ...s, pendingDiff: null }));
                        }}
                        onReject={() => {
                            send({ type: "diff_decision", reqId: diff.reqId, action: "rejected", reason: "" });
                            setDiff((s) => ({ ...s, pendingDiff: null }));
                        }}
                    />
                )}
            </main>
            <ChatDrawer onSend={(prompt) => send({ type: "chat_send", prompt })} />
            {pick && (
                <PickerOverlay
                    imageUrl={pick.imageUrl}
                    hint={pick.hint}
                    onPick={(coords) => {
                        // TODO: call playwright-cli eval at coords in backend
                        send({ type: "pick_result", reqId: pick.reqId, selector: "", attrs: { coords } });
                        setDiff((s) => ({ ...s, pendingPick: null }));
                    }}
                    onCancel={() => {
                        send({ type: "pick_result", reqId: pick.reqId, selector: "", attrs: { cancelled: true } });
                        setDiff((s) => ({ ...s, pendingPick: null }));
                    }}
                />
            )}
        </div>
    );
}
```

**Step 2: Typecheck**

Run: `npm run build -w @debug-gui/web`
Expected: success

**Step 3: Commit**

```bash
git commit -am "feat(debug-gui): compose App with tree, cockpit, diff, chat, picker"
```

---

## Phase 5 — Launcher + smoke test

### Task 26: `bin/debug-gui.js` launcher

**Files:**
- Create: `packages/debug-gui/bin/debug-gui.js`

**Step 1: Implement**

```js
#!/usr/bin/env node
import { main } from "../server/dist/index.js";

main(process.cwd()).catch((e) => {
    console.error(e);
    process.exit(1);
});
```

**Step 2: Make executable + chmod skipped on Windows (still committed)**

Run:
```bash
git add packages/debug-gui/bin/debug-gui.js
git commit -m "feat(debug-gui): bin launcher that delegates to server main"
```

---

### Task 27: Build everything + serve static web from server

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`

**Step 1: Add static serving**

In `createApp` callsite (inside `main`), after `createServer(app)`:
```ts
app.use(express.static(path.join(cwd, "packages/debug-gui/web/dist")));
```

(This serves the built React SPA on the same origin as the API.)

**Step 2: Full build**

Run:
```bash
npm run build -w @debug-gui/web
npm run build -w @debug-gui/server
```
Expected: both succeed

**Step 3: Commit**

```bash
git commit -am "feat(debug-gui): server serves built web SPA as static"
```

---

### Task 28: Smoke test script

**Files:**
- Create: `packages/debug-gui/test/smoke.sh`

**Step 1: Implement**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Start server in background (assumes builds done)
PORT=5556
node packages/debug-gui/bin/debug-gui.js &
PID=$!
trap "kill $PID 2>/dev/null || true" EXIT
sleep 2

# Hit /api/init
RESP=$(curl -s http://localhost:$PORT/api/init)
echo "$RESP" | grep -q '"suites"' || { echo "FAIL: no suites in response"; exit 1; }
echo "SMOKE OK: /api/init returned suites"

# Done
kill $PID
```

**Step 2: Make runnable + commit**

```bash
git add packages/debug-gui/test/smoke.sh
git commit -m "test(debug-gui): smoke test hits /api/init"
```

**Step 3: Run it**

Run: `bash packages/debug-gui/test/smoke.sh`
Expected: `SMOKE OK: /api/init returned suites`

If it fails, follow **@superpowers:systematic-debugging** and fix, then re-commit.

---

### Task 29: Extend walkthrough E2E verification

**Files:**
- Modify: `test/walkthrough-e2e-wdio/verify-wdio.sh` (add debug-gui smoke invocation at end)

**Step 1: Append to `verify-wdio.sh`**

```bash
# At the end of verify-wdio.sh:
echo "--- Smoke testing debug-gui ---"
bash packages/debug-gui/test/smoke.sh
```

**Step 2: Run entire verification**

Run: `bash test/walkthrough-e2e-wdio/verify-wdio.sh`
Expected: original wdio verification passes + smoke test passes

If any failure: **@superpowers:systematic-debugging** first.

**Step 3: Commit**

```bash
git commit -am "test: include debug-gui smoke in walkthrough E2E verification"
```

---

## Phase 6 — Verification before completion

### Task 30: Verify against design doc

Use **@superpowers:verification-before-completion** for this task.

**Step 1: Checklist — open `docs/plans/2026-04-20-debug-gui-design.md` and verify each "Goals" item is achievable with the code you just built:**

- [ ] GUI-first UX — TestTree + Cockpit + DiffView exist
- [ ] Reuse SKILL.md via `skillDirectories` — confirmed in `buildSessionConfig`
- [ ] Reuse walkthrough-hooker — confirmed (no modifications to `walkthrough-hooker.js`)
- [ ] Auto-detect suites — `discovery.ts` parses `package.json`
- [ ] Agent = Copilot CLI via copilot-sdk — confirmed
- [ ] Playwright UI style — web app, `open()` auto-launch

**Step 2: Checklist — each "Non-goal" is indeed absent:**

- [ ] No VS Code extension code
- [ ] No Monaco embed
- [ ] No screencast iframe
- [ ] No multi-session state
- [ ] No shell allowlist — `approveAll` used
- [ ] No new custom runner — `spawn('npx', ['mocha', ...])`

**Step 3: Manual run-through with real project**

Run: from a project root that has mocha + walkthrough-hooker.js + package.json.mocha:
```bash
node packages/debug-gui/bin/debug-gui.js
```

Expected:
- Browser opens to localhost:5555
- TestTree populated
- Clicking a spec spawns mocha (visible in logs)
- If a test fails, FailureCard appears
- Copilot agent invoked (visible via Copilot CLI logs)

**Step 4: If anything broken — fix and re-commit**

**Step 5: Final commit**

```bash
git commit --allow-empty -m "chore: verify debug-gui matches design doc"
```

---

## Phase 7 — Documentation pass

### Task 31: Update repo CLAUDE.md and README references

**Files:**
- Modify: `CLAUDE.md` (root)

**Step 1: Add debug-gui section under "What This Is"**

```markdown
- **debug-gui** (`packages/debug-gui/`) — web GUI that wraps walkthrough sessions for non-technical QA. Launch: `npx @debug-tools/ui` (or `node packages/debug-gui/bin/debug-gui.js`).
```

Add under "Commands":

```bash
# Run Debug GUI locally (requires builds)
node packages/debug-gui/bin/debug-gui.js
```

**Step 2: Commit**

```bash
git commit -am "docs: reference debug-gui in CLAUDE.md"
```

---

## Request Code Review

Use **@superpowers:requesting-code-review** to verify the implementation meets the design doc's contracts and catches anything missed above.

---

## Done

All phases complete. Merge path per **@superpowers:finishing-a-development-branch**.
