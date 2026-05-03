import "@testing-library/jest-dom/vitest";

// refinitiv-ui's IconLoader / SpriteLoader fetch halo SVG sprites from a
// CDN at element attach time. Under jsdom there's no network; the fetch
// rejects, errorThrower.once() converts the rejection into a thrown
// Error, and the resulting unhandled rejection trips up vitest. Tests
// don't depend on icon rendering, so seed the singleton ErrorThrower's
// shown-set with the message the loader emits — once() then short-circuits.
import { ErrorThrower } from "@refinitiv-ui/core";
type SeenErrors = { shownErrors: Set<string> };
(ErrorThrower as unknown as SeenErrors).shownErrors.add(
    "Error: SpriteLoader: couldn't load SVG sprite source",
);
(ErrorThrower as unknown as SeenErrors).shownErrors.add(
    "Error: IconLoader: couldn't load SVG icon source",
);

// ef-dialog (and any element that calls this.t(...)) routes through
// @refinitiv-ui/i18n -> Memoiser.format -> `new IntlMessageFormat(...)`.
// vitest's CJS interop on intl-messageformat hands the memoiser a
// namespace object instead of the default-export constructor, so every
// dialog render trips "IntlMessageFormat is not a constructor" as an
// uncaught exception. Tests don't assert on translation output; clear the
// memoiser's cache and short-circuit format() to a literal-key passthrough
// so the constructor is never called.
import { Memoiser } from "@refinitiv-ui/i18n/lib/memoiser.js";
Memoiser.format = (
    _scope: string,
    _locale: string,
    key: string,
): string => key;
