export const STATE = {
    IDLE: "idle",
    PRE_RUNNING: "pre-running",
    RUNNING: "running",
    PAUSED: "paused",
    DONE: "done",
} as const;

export type SessionState = (typeof STATE)[keyof typeof STATE];

export const isLive = (s: SessionState): boolean =>
    s === STATE.PRE_RUNNING || s === STATE.RUNNING || s === STATE.PAUSED;

export const isTerminal = (s: SessionState): boolean =>
    s === STATE.IDLE || s === STATE.DONE;

export const isPaused = (s: SessionState): s is typeof STATE.PAUSED =>
    s === STATE.PAUSED;
