// Parses raw mocha titles like
//   "C1111111 - Example Company Overview - Business Summary [Regression][Smoke][Cl_Smoke]"
// into structured parts so the tree can render a compact single-line row
// (caseId chip + clean title + tag count) while keeping the raw string
// available for the hover tooltip and for `--grep` matching upstream.

export interface ParsedTitle {
    caseId: string | null;
    displayTitle: string;
    tags: string[];
    raw: string;
}

const CASE_ID_RE = /^(C\d{3,})\s*[-–—]?\s*/i;
const TAG_RE = /\s*\[([^\]\n]+)\]/g;

export function parseTestTitle(raw: string): ParsedTitle {
    const safe = raw ?? "";

    // Sentinel titles emitted by the server-side parser when an it()/describe()
    // is built dynamically — leave them untouched so the row still renders the
    // sentinel verbatim and stays click-disabled.
    if (safe === "<dynamic>" || safe === "<missing>") {
        return { caseId: null, displayTitle: safe, tags: [], raw: safe };
    }

    let working = safe;
    let caseId: string | null = null;

    const idMatch = working.match(CASE_ID_RE);
    if (idMatch) {
        caseId = idMatch[1].toUpperCase();
        working = working.slice(idMatch[0].length);
    }

    const tags: string[] = [];
    working = working.replace(TAG_RE, (_, tag: string) => {
        tags.push(tag.trim());
        return "";
    });

    const displayTitle = working.trim();

    // If stripping caseId + tags left nothing, fall back to the raw string so
    // the row never collapses to an empty label. In that case we also drop
    // the parsed tags/caseId — the row is showing the raw form anyway.
    if (!displayTitle) {
        return { caseId: null, displayTitle: safe, tags: [], raw: safe };
    }

    return { caseId, displayTitle, tags, raw: safe };
}

// Returns true if any of caseId / displayTitle / raw / tags includes the
// (already-lowercased) needle. Used by the tree's search filter so a query
// like "smoke" still matches rows whose [Smoke] tag is hidden from view.
export function matchesQuery(parsed: ParsedTitle, needleLower: string): boolean {
    if (!needleLower) return true;
    if (parsed.raw.toLowerCase().includes(needleLower)) return true;
    if (parsed.displayTitle.toLowerCase().includes(needleLower)) return true;
    if (parsed.caseId && parsed.caseId.toLowerCase().includes(needleLower)) return true;
    for (const t of parsed.tags) {
        if (t.toLowerCase().includes(needleLower)) return true;
    }
    return false;
}
