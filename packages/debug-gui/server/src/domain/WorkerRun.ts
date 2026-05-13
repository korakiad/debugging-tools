import type { ChildProcess } from "child_process";
import { STATE, isPaused, type SessionSnapshot } from "@debug-gui/protocol";
import type { SessionManager } from "../session.js";
import { MochaRunner, buildMochaFork } from "../runner.js";
import { WorkerLink } from "../workerLink.js";

// One Mocha fork's lifetime. Internal FSM mirrors the wire-format session
// states the worker visits, with two additional states (`starting` and
// `stopping`) that the wire never sees — `starting` covers the fork +
// attach window before the worker emits status:running; `stopping` is
// the graceful-stop window before the child exits.
type WorkerRunState =
    | "starting"
    | "running"
    | "paused"
    | "stopping"
    | "done";

export interface WorkerRunOpts {
    /** Absolute path to the spec file. */
    spec: string;
    /** Display-relative spec path (the one the GUI sees in init/status). */
    specRel: string;
    /** Mocha --grep regex source. Omit to run the whole file. */
    grep?: string;
    /** Step-style mode: kill retries + bail siblings on first failure. */
    bailOnFailure?: boolean;
}

export interface WorkerRunDeps {
    readonly opts: WorkerRunOpts;
    /** Singleton transport. MochaRunner.start() kills its own prior child
     *  before forking, so multiple WorkerRun instances over the lifetime
     *  of the server don't fight for the same MochaRunner slot. */
    readonly runner: MochaRunner;
    /** Singleton session manager. WorkerLink calls markRunning/markPaused/
     *  markDone on it; this WorkerRun mirrors its state via
     *  onSessionChanged(). */
    readonly session: SessionManager;
    /** "host:port" the worker should attach to via DEBUG_GUI_ATTACH_CDP.
     *  Captured at start() time and baked into the fork's env — Continue
     *  re-launches a new WorkerRun with whatever Chrome handle is alive. */
    readonly cdpAddress: string;
}

export class WorkerRun {
    private state: WorkerRunState = "starting";
    private readonly link: WorkerLink;
    private child: ChildProcess | null = null;

    constructor(private readonly deps: WorkerRunDeps) {
        this.link = new WorkerLink(deps.session);
    }

    getState(): WorkerRunState {
        return this.state;
    }

    getOpts(): WorkerRunOpts {
        return this.deps.opts;
    }

    /**
     * Fork the mocha worker, attach the IPC link, and mark the
     * session as `running`. Throws if the runner refuses to fork.
     */
    async start(): Promise<void> {
        if (this.state !== "starting") {
            throw new Error(`WorkerRun.start invalid in state=${this.state}`);
        }
        const forkSpec = buildMochaFork({
            spec: this.deps.opts.spec,
            grep: this.deps.opts.grep,
            bailOnFailure: this.deps.opts.bailOnFailure,
        });
        forkSpec.env.DEBUG_GUI_ATTACH_CDP = this.deps.cdpAddress;
        // markRunning before attach so any IPC frame arriving during boot
        // finds currentSpec already set on the session snapshot — WorkerLink
        // uses it when reflecting status:running.
        this.deps.session.markRunning(this.deps.opts.specRel);
        this.child = await this.deps.runner.start(forkSpec);
        this.link.attach(this.child);
        this.state = "running";
    }

    /**
     * Forward a resume frame to the worker's afterEach. Returns false if
     * the child isn't connected (already gone, or never started).
     */
    resume(): boolean {
        if (this.state !== "paused") return false;
        const ok = this.link.sendResume();
        if (ok) this.state = "running";
        return ok;
    }

    /**
     * Send `{type:'stop'}` to the worker (afterEach throws → afterAll
     * runs → clean exit). Falls back to killTree after the runner's
     * built-in grace window. Idempotent.
     */
    async stopGracefully(): Promise<void> {
        if (this.state === "done" || this.state === "stopping") return;
        this.state = "stopping";
        try {
            await this.deps.runner.sendStopAndKill();
        } finally {
            this.link.detach();
            this.state = "done";
        }
    }

    /**
     * Mirror the session manager's wire state into our local FSM.
     * Caller (GuiSession in Phase 4, index.ts for now) wires a
     * session.events.on("change") subscription that forwards here.
     */
    onSessionChanged(snap: SessionSnapshot): void {
        if (this.state === "done" || this.state === "stopping") return;
        if (isPaused(snap.state)) {
            this.state = "paused";
        } else if (snap.state === STATE.RUNNING && this.state === "paused") {
            // Worker emitted a fresh status:running while we were paused
            // (consumer hook's resume path). Flip back.
            this.state = "running";
        } else if (snap.state === STATE.DONE) {
            this.state = "done";
        }
    }
}
