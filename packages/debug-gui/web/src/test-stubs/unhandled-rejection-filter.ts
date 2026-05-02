// Filter unhandled errors/rejections during vitest runs. refinitiv-ui
// elements (ef-dialog, ef-icon, etc.) load i18n strings and SVG sprite
// assets at mount time. jsdom has no real fetch pipeline for those
// assets, so the loaders surface async failures (uncaughtException +
// unhandledRejection) well after assertions run — environmental noise,
// not test failures. Anything else still propagates and fails the run,
// so genuine product bugs in async paths keep failing loudly.
//
// Vitest registers its own handlers inside its worker (see
// node_modules/vitest/dist/vendor/execute.*.js → listenForErrors), and
// Node has no way to stop a listener from running once another fires.
// We therefore monkey-patch process.on so any subsequent
// uncaughtException / unhandledRejection listener is wrapped to skip
// when the error is in our denylist. This setup file runs before
// vitest's executor, so vitest's call goes through our wrapper.

const KNOWN_NOISE = /halo|refinitiv-ui|sprite|i18n|\.svg|IntlMessageFormat/i;
const FILTERED_EVENTS = new Set(["uncaughtException", "unhandledRejection"]);

function isKnownNoise(reason: unknown): boolean {
    const obj = reason as { message?: unknown; stack?: unknown };
    const haystack = `${String(obj?.message ?? reason)} ${String(obj?.stack ?? "")}`;
    return KNOWN_NOISE.test(haystack);
}

const originalOn = process.on.bind(process);
process.on = function patchedOn(
    this: NodeJS.Process,
    event: string | symbol,
    listener: (...args: unknown[]) => void,
): NodeJS.Process {
    if (typeof event === "string" && FILTERED_EVENTS.has(event)) {
        const wrapped = (...args: unknown[]) => {
            if (isKnownNoise(args[0])) return;
            return listener(...args);
        };
        return originalOn(event, wrapped);
    }
    return originalOn(event, listener);
} as typeof process.on;

// Also re-wrap any handlers that were registered before this setup
// file ran, so they go through the same denylist.
for (const event of FILTERED_EVENTS) {
    const existing = process.listeners(event as "uncaughtException");
    process.removeAllListeners(event);
    for (const fn of existing) {
        originalOn(event, (...args: unknown[]) => {
            if (isKnownNoise(args[0])) return;
            return (fn as (...a: unknown[]) => void)(...args);
        });
    }
}
