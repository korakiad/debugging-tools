import React from "react";
import ReactDOM from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import App from "./App";
import "./ui";
import "./index.css";

// Pierre's portable worker — Vite emits this as a separate worker chunk via
// the `new URL(..., import.meta.url)` pattern. The factory wraps the URL
// because @pierre/diffs' WorkerPoolOptions takes a `workerFactory: () => Worker`,
// not a URL field.
const workerUrl = new URL(
    "@pierre/diffs/worker/worker-portable.js",
    import.meta.url,
);
const workerFactory = () => new Worker(workerUrl, { type: "module" });

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
