import path from "path";
import { existsSync } from "fs";
import express, { type Express } from "express";
import { SCREENSHOT_DIR } from "../screenshot.js";

export interface HttpRoutesDeps {
    /** Absolute path to the resolved server/dist (or server/src in dev)
     *  parent — used to locate the built web SPA at ../../web/dist. */
    readonly here: string;
}

export function registerHttpRoutes(app: Express, deps: HttpRoutesDeps): void {
    app.get("/api/screenshot/:name", (req, res) => {
        const name = req.params.name;
        if (!/^[A-Za-z0-9-]+\.png$/.test(name)) {
            res.status(400).end();
            return;
        }
        res.sendFile(path.join(SCREENSHOT_DIR, name));
    });

    // Serve built web SPA from server/dist/../../web/dist in prod.
    // (In dev, vite serves :5555 and proxies API to backend.)
    const webDist = path.resolve(deps.here, "../../web/dist");
    if (existsSync(webDist)) {
        app.use(express.static(webDist));
        app.get(/^\/(?!api|ws).*/, (_req, res) =>
            res.sendFile(path.join(webDist, "index.html")),
        );
    }
}
