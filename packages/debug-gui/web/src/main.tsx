import React from "react";
import ReactDOM from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import App from "./App";
import {
    useStore,
    type MochaLogLine,
    type SelectedNode,
    type ServerEvent,
    type SuiteTree,
} from "./state/store";

import "./ui";
import "./index.css";

interface DemoFixture {
    events?: ServerEvent[];
    selection?: { spec: string; node?: SelectedNode | null };
    suiteTrees?: Record<string, SuiteTree>;
    runStartedAt?: number;
    mochaLog?: MochaLogLine[];
    chatMessages?: Array<{ role: "assistant" | "user"; content: string }>;
}

// Pierre's portable worker — Vite emits this as a separate worker chunk via
// the `new URL(..., import.meta.url)` pattern. The factory wraps the URL
// because @pierre/diffs' WorkerPoolOptions takes a `workerFactory: () => Worker`,
// not a URL field.
const workerUrl = new URL(
    "@pierre/diffs/worker/worker-portable.js",
    import.meta.url,
);
const workerFactory = () => new Worker(workerUrl, { type: "module" });

// `?demo=<name>` loads /demo/<name>.json (a static array of ServerEvents)
// and replays it into the Zustand store before the WS hook connects, so
// the app renders a deterministic mocked state for screenshot capture.
// useWebSocket() reads window.__DEMO_MODE__ and skips opening the socket
// so a real `init` event from the server can't clobber the fixture.
async function bootstrap() {
    const params = new URLSearchParams(location.search);
    const demo = params.get("demo");
    if (demo && /^[a-z0-9-]+$/i.test(demo)) {
        (window as unknown as { __DEMO_MODE__: boolean }).__DEMO_MODE__ = true;
        try {
            const res = await fetch(`/demo/${demo}.json`);
            if (res.ok) {
                const fixture = (await res.json()) as DemoFixture;
                const apply = useStore.getState().applyEvent;
                for (const event of fixture.events ?? []) apply(event);
                // Selection + parsed suite trees aren't set by applyEvent —
                // they're populated by user clicks and an /api/suite/tree
                // fetch under normal use. Patch them directly so the captured
                // screenshots show CodePreview, the right-panel selection,
                // etc.
                const patch: Record<string, unknown> = {};
                if (fixture.selection) {
                    patch.selectedSpec = fixture.selection.spec;
                    patch.selectedNode = fixture.selection.node ?? null;
                }
                if (fixture.suiteTrees) patch.suiteTrees = fixture.suiteTrees;
                // Rebase timestamps so the StatusHeader's "ELAPSED" pill
                // doesn't show two-year-old run times. The fixture authors
                // pick relative offsets from runStartedAt; on load we shift
                // runStartedAt to a few seconds before "now" and apply the
                // same delta to every mochaLog entry's receivedAt.
                if (fixture.runStartedAt != null) {
                    const tail = fixture.mochaLog?.length
                        ? fixture.mochaLog[fixture.mochaLog.length - 1].receivedAt
                        : fixture.runStartedAt + 2500;
                    const totalElapsed = tail - fixture.runStartedAt;
                    const targetStart = Date.now() - totalElapsed - 500;
                    const delta = targetStart - fixture.runStartedAt;
                    patch.runStartedAt = targetStart;
                    if (fixture.mochaLog) {
                        patch.mochaLog = fixture.mochaLog.map((line) => ({
                            ...line,
                            receivedAt: line.receivedAt + delta,
                        }));
                    }
                } else if (fixture.mochaLog) {
                    patch.mochaLog = fixture.mochaLog;
                }
                if (fixture.chatMessages) patch.chatMessages = fixture.chatMessages;
                if (Object.keys(patch).length > 0) useStore.setState(patch);
            }
        } catch {
            // Demo fixtures are best-effort; falling through renders the
            // default empty state, which is still useful for capture.
        }
    }

    ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
            <WorkerPoolContextProvider
                poolOptions={{ poolSize: 2, workerFactory }}
                highlighterOptions={{
                    theme: "pierre-dark",
                    langs: ["javascript", "typescript", "tsx", "jsx", "json"],
                }}
            >
                <App />
            </WorkerPoolContextProvider>
        </React.StrictMode>,
    );
}

bootstrap();
