# Debug GUI — Replace `react-diff-viewer-continued` with `@pierre/diffs`

## Context

When the agent proposes a code edit, the GUI shows it via `DiffView.tsx`, currently rendered with `react-diff-viewer-continued`. The look is functional but plain and noticeably "AI-tooling default." For an LSEG-internal product that managers see, we want the diff surface to read as a deliberately-designed product feature, not a generic dependency.

[`@pierre/diffs`](https://diffs.com) (npm: `@pierre/diffs`, docs site: diffs.com) is Pierre's open-source diff library — Shiki-highlighted, GitHub-PR-style split or unified layout, theme-aware, virtualized. We swap to it.

## Scope (decided)

- **In**: replace the rendering inside `DiffView.tsx`. Public component props (`file`, `oldCode`, `newCode`, `onApprove`, `onReject`) and behavior stay identical so `App.tsx`, the WS protocol, the `editFile` tool, and the existing Vitest specs are untouched.
- **In**: split-view default for the diff panel.
- **Out**: per-hunk accept/reject. Pierre supports it via `DiffAcceptRejectHunkConfig`, but the server side (`editFile.ts` + WS `diff_decision` payload + agent prompt) only knows whole-file approve/reject today. Lifting that is a separate effort — not in this PR.
- **Out**: theming the rest of the app to Pierre's palette. We use `pierre-dark` only inside the diff surface; the surrounding `EfPanel` chrome stays halo-dark.

## Design decisions

### One dependency: `@pierre/diffs`

Pierre exports `parseDiffFromFile(oldFile, newFile, options?)` from the main entry. It takes two `FileContents` objects (`{ name, contents, language, cacheKey? }`) and returns a `FileDiffMetadata` ready for `<FileDiff>`. We pass that into the React component — no separate `diff` package import at the call site.

Earlier draft of this design used `<PatchDiff>` plus `diff.createTwoFilesPatch` to build a unified-diff string first. That was redundant: Pierre already wraps `diff` internally and exposes the shape we need. Rejected.

### API shape inside `DiffView.tsx`

```tsx
import { useMemo } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { SupportedLanguages } from "@pierre/diffs";

const lang = languageFor(file); // re-use existing languageFromPath logic

const fileDiff = useMemo(
  () =>
    parseDiffFromFile(
      { name: file, contents: oldCode, language: lang },
      { name: file, contents: newCode, language: lang },
    ),
  [file, oldCode, newCode, lang],
);

return (
  <EfPanel>
    <FileDiff
      fileDiff={fileDiff}
      options={{ theme: "pierre-dark", style: "split" }}
    />
    {/* Approve / Reject buttons unchanged */}
  </EfPanel>
);
```

`useMemo` is load-bearing: `parseDiffFromFile` walks both strings and runs the diff algorithm. A pending diff sticks around until the user clicks, so re-parsing on every parent re-render would be wasteful.

### Worker pool provider lives at `main.tsx`, once

Pierre off-loads Shiki tokenization to a Web Worker via `<WorkerPoolContextProvider>`. The provider creates the pool lazily and reuses workers across every diff in the React tree. We mount it once at the app root rather than wrapping each `DiffView`, so a second/third diff (chat history etc., later) doesn't spin up extra pools.

Worker URL: `new URL("@pierre/diffs/worker/worker-portable.js", import.meta.url)`. The portable worker loads grammars on demand (smaller initial download) and works inside a Vite-emitted worker chunk. Pierre's non-portable worker bundles all grammars upfront — heavier, no benefit for our handful of languages.

Provider config (`highlighterOptions`): preload `pierre-dark` theme + the languages our test files actually use (`javascript`, `typescript`, `tsx`, `jsx`, `json`). Anything else still works — Pierre lazy-loads — but the common path stays warm.

### Language detection

We already have `languageFromPath(file)` used by `CodePreview`. `@pierre/diffs` accepts a `SupportedLanguages` union (Shiki bundled langs + `text` + `ansi`). The two sets overlap on the languages we care about, but the type unions don't match exactly. We add a tiny mapping helper inside `DiffView.tsx`:

- `.ts` / `.tsx` → `typescript` / `tsx`
- `.js` / `.jsx` → `javascript` / `jsx`
- `.json` → `json`
- `.md` → `markdown`
- everything else → `text` (Pierre still renders, just unstyled)

Helper lives in the same file; not enough callers to extract.

### Approve / Reject UX preserved

The existing footer (Reject + Approve `EfButton`s) renders below `<FileDiff>` exactly as before. WS messages (`diff_decision`) and store reset (`pendingDiff: null`) are untouched. `DiffView.test.tsx` keeps passing — it asserts the click handlers fire, not the inner DOM.

### Vitest worker stub

jsdom can't execute Web Workers, so loading `worker-portable.js` would explode the test suite. We add a Vitest-only Vite alias mapping `@pierre/diffs/worker/worker-portable.js` → a minimal stub that exposes a no-op `Worker`-like shape. `<WorkerPoolContextProvider>` already tolerates an undefined pool (`useWorkerPool()` may return undefined, components fall back to non-worker rendering).

If the alias proves brittle, fallback is to set `disableWorkerPool` on `<FileDiff>` whenever `import.meta.env.MODE === "test"`. We try the alias first; if Pierre's CJS resolution fights it, switch.

### Bundle size

Pierre adds Shiki, which is large. Mitigations:
- Worker chunk is split out by Vite — main bundle isn't bloated.
- Portable worker lazy-loads grammars from CDN-shaped paths Pierre handles internally; we don't preload the full grammar set.
- We keep `react-diff-viewer-continued` in `package.json` only briefly — removed in this same PR after `DiffView.tsx` is migrated. No dual-shipping.

### Halo-dark vs `pierre-dark`

The surrounding `EfPanel` uses `var(--ef-border-color)` etc. (refinitiv-ui halo-dark). Pierre's `pierre-dark` theme is a separate shiki theme — colors will differ from halo-dark but both are dark, contrast-friendly, and the visual seam is contained inside the panel border. Acceptable.

If management feedback later demands a fully-matching palette, Pierre supports custom themes (`ThemeRegistrationResolved`). Out of scope here.

## Risks

- **Air-gapped LSEG networks**: portable worker may try to fetch grammar JSON from an embedded URL. Verify on first run inside a locked-down environment. Fallback: switch to non-portable worker (bundles grammars), or set `disableWorkerPool` and accept slower first paint.
- **Vite worker emission with monorepo + workspace deps**: Vite needs the worker URL pattern (`new URL(... , import.meta.url)`) to resolve through the workspace symlink. If it doesn't, we copy the worker file into `web/public/` at build time and reference by URL.
- **React 18 vs 19 peer**: web workspace is React 18.3.1; Pierre's peer accepts 18.3.1 || 19. ✓

## Out of scope (explicit)

- Per-hunk accept/reject (server protocol change, separate PR)
- Theming halo to match Pierre, or vice versa
- Multi-file diffs (`MultiFileDiff`) — agent emits one `editFile` at a time today
- Replacing `CodePreview` (uses `prism-react-renderer` for read-only view; not a diff)

## Success criteria

- A pending agent edit renders with Pierre's split-view UI, Shiki highlighting, dark theme, no console errors.
- Approve / Reject still flip the right WS messages and clear `pendingDiff`.
- `npm run test -w @debug-gui/web` and `npm run build -w @debug-gui/web` both pass.
- `react-diff-viewer-continued` no longer appears in `web/package.json`.
