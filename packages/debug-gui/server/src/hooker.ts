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
