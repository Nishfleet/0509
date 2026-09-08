import type { NormalizedSavedQuery, SearchFilters, SearchMode } from "~/lib/types";

const COMPARISON_WHITESPACE = /\s+/g;

// Script-driven churn tokens shared by the headline hash AND the CTA/offer
// comparison (#762): countdown timers ("Deal ends in 00:59:59"), rolling
// calendar dates ("Offer valid until aug 12"), live audience counters
// ("12 people viewing now"), and live inventory/urgency counters ("only 3
// left", "120 sold"). These are stripped ONLY from the comparison hash, so a
// churning page stays silent while real headline rewrites (the "copy
// structure" signal) still fire. The raw and normalized strings keep the full
// text for display and evidence.
//
// Two consequences to keep in mind before editing this list:
//
//  1. These patterns feed the stored `normalizedHeadlineHash` for every
//     watched page. ANY edit here — even a typo fix in a regex — silently
//     invalidates every stored hash and fires a one-time headline-change
//     alert on every watched page. Treat additions as a deliberate
//     churn-class decision, not a cleanup.
//
//  2. The keyword patterns are deliberately lowercase-only (no `/i` flags)
//     so callers MUST lowercase before calling `stripChurnTokens` —
//     `normalizeHeadline` does it via the headline pipeline, and the
//     watch-event evaluator does it via `churnStableFieldValue`. See the
//     `stripChurnTokens` doc comment for the caller contract.
const CHURN_PATTERNS: RegExp[] = [
  // Countdown / clock timers: "Deal ends in 00:59:59", "Offer valid till 12:30".
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  // Rolling calendar dates: "12/08/2026", "2026-08-12", "aug 12, 2026".
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/g,
  // Live audience counters: "12 people viewing now", "1.2k watching".
  /\b\d[\d,.]*k?\s+(?:people|users|shoppers|customers|visitors|families)\s+(?:are\s+)?(?:viewing|watching|browsing|looking\s+at|online|in\s+line)\b/g,
  // Live inventory / urgency counters: "only 3 left", "5 seats remaining",
  // "120 sold".
  /\b(?:only\s+)?\d[\d,]*\s+(?:left|remaining|seats|spots|places|items|units|tickets|sold|bought|claimed|enrolled|joined|registered)\b/g,
];

export function normalizeHeadline(value: string) {
  const raw = value.trim();
  const normalized = raw.replace(COMPARISON_WHITESPACE, " ").toLowerCase();
  return {
    raw,
    normalized,
    hash: hashString(stripChurnTokens(normalized)),
  };
}

/**
 * Churn-stable comparison value for any landing-page field. Countdown
 * timers, rolling calendar dates, live audience counters, and live
 * inventory/urgency counters are stripped from the COMPARISON value only —
 * the caller keeps the raw text for display and evidence. Without this, a
 * "Claim offer · 00:59:59" CTA or a "Only 3 left · ₹499" price line fires a
 * customer-visible CTA/offer event on every scan even though the page's own
 * copy never changed. When churn tokens are the only difference, the two
 * comparison values normalize to the same string and no event is emitted.
 *
 * Caller contract: the patterns are deliberately lowercase-only (no `/i`
 * flags), so callers MUST lowercase before invoking — see the warning on
 * `CHURN_PATTERNS`. Returns "" for empty/null/undefined input.
 */
export function stripChurnTokens(value: string | null | undefined) {
  if (!value) return "";
  let stripped = value;
  for (const pattern of CHURN_PATTERNS) {
    stripped = stripped.replace(pattern, " ");
  }
  return stripped.replace(COMPARISON_WHITESPACE, " ").trim();
}

// Country falls back to "all", not any single market — Five to Nine is
// global-first; visitor-geo defaults are applied by the routes, not here.
export function normalizeSearchFilters(
  filters: Partial<SearchFilters>,
  defaults: { country?: string } = {},
): SearchFilters {
  const fallbackCountry = defaults.country ?? "all";
  const normalized: SearchFilters = {
    query: (filters.query ?? "").trim(),
    country: (filters.country ?? fallbackCountry).trim() || fallbackCountry,
    platform: (filters.platform ?? "all").trim() || "all",
    creativeType: filters.creativeType ?? "all",
    status: filters.status ?? "all",
    firstSeenFrom: (filters.firstSeenFrom ?? "").trim(),
    lastSeenFrom: (filters.lastSeenFrom ?? "").trim(),
  };
  // Only carry a verified numeric page id. Omit the key entirely otherwise so
  // keyword-query cache fingerprints are byte-identical to their pre-pageId form.
  const pageId = normalizeNumericPageId(filters.pageId);
  if (pageId) {
    normalized.pageId = pageId;
  }
  return normalized;
}

/** A Meta Page id is an all-digit token; reject anything else (never a term). */
export function normalizeNumericPageId(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? "").trim();
  return /^\d{5,}$/.test(trimmed) ? trimmed : null;
}

export function normalizeSavedQuery(
  mode: SearchMode,
  filters: Partial<SearchFilters>,
  defaults: { country?: string } = {},
): NormalizedSavedQuery {
  return {
    mode,
    filters: normalizeSearchFilters(filters, defaults),
  };
}

export function fingerprintSavedQuery(query: NormalizedSavedQuery) {
  return hashString(stableStringify(query));
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function parseSearchParams(
  searchParams: URLSearchParams,
  defaults: { country?: string } = {},
) {
  const mode = (searchParams.get("mode") === "keyword" ? "keyword" : "advertiser") as SearchMode;
  const filters = normalizeSearchFilters({
    // `q` is the conventional shared-link alias for the search term (the
    // canonical product param is `query`). Shared/deep links such as
    // /search?q=nykaa must run the same query with the same cache fingerprint
    // as /search?query=nykaa; an explicit `query` always wins so canonical
    // product links never change meaning.
    query: searchParams.get("query") ?? searchParams.get("q") ?? "",
    country: searchParams.get("country") ?? defaults.country ?? "all",
    platform: searchParams.get("platform") ?? "all",
    creativeType: (searchParams.get("creativeType") ?? "all") as SearchFilters["creativeType"],
    status: (searchParams.get("status") ?? "all") as SearchFilters["status"],
    firstSeenFrom: searchParams.get("firstSeenFrom") ?? "",
    lastSeenFrom: searchParams.get("lastSeenFrom") ?? "",
  });

  return {
    mode,
    filters,
    fingerprint: fingerprintSavedQuery({ mode, filters }),
  };
}

export function buildSearchParams(query: NormalizedSavedQuery) {
  const params = new URLSearchParams();
  params.set("mode", query.mode);
  params.set("query", query.filters.query);
  params.set("country", query.filters.country);
  params.set("platform", query.filters.platform);
  params.set("creativeType", query.filters.creativeType);
  params.set("status", query.filters.status);
  if (query.filters.firstSeenFrom) {
    params.set("firstSeenFrom", query.filters.firstSeenFrom);
  }
  if (query.filters.lastSeenFrom) {
    params.set("lastSeenFrom", query.filters.lastSeenFrom);
  }
  return params;
}

export function hashString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
