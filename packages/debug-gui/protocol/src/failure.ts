export interface FailureInfo {
    test: string;
    file: string;
    error: string;
    stack: string;
    suite?: string;
    // Wall-clock ms when the runner reported the pause. Set by the worker's
    // hook on failure; the web reducer also stamps this on receipt as a
    // fallback so the synthetic FAIL row's TIME column is anchored even
    // if the worker omits it.
    pausedAt?: number;
    // Optional runtime extras forwarded opaquely from the mocha hook
    // (currently emitted but not strictly required by the UI). Declared
    // here so consumers can read them without redeclaring the shape.
    attempt?: number;
    maxAttempts?: number;
    duration?: number;
}
