export interface PendingResolver<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

// Drain a resolver map by rejecting each pending promise with
// "session aborted" and clearing the map. Called from cancel and
// agent_abort to ensure pending edit/pick/ask tool calls don't
// leak across sessions.
export function drainResolvers<T>(map: Map<string, PendingResolver<T>>): void {
    for (const r of map.values()) {
        try {
            r.reject(new Error("session aborted"));
        } catch {
            /* ignore */
        }
    }
    map.clear();
}
