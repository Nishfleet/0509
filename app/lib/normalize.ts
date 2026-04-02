import type { NormalizedSavedQuery, SearchFilters, SearchMode } from "~/lib/types";

const COMPARISON_WHITESPACE = /\s+/g;

export function normalizeHeadline(value: string) {
  const raw = value.trim();
  const normalized = raw.replace(COMPARISON_WHITESPACE, " ").toLowerCase();
  return {
    raw,
    normalized,
    hash: hashString(normalized),
  };
}

export function normalizeSearchFilters(filters: Partial<SearchFilters>): SearchFilters {
  return {
    query: (filters.query ?? "").trim(),
    country: (filters.country ?? "India").trim() || "India",
    platform: (filters.platform ?? "all").trim() || "all",
    creativeType: filters.creativeType ?? "all",
    status: filters.status ?? "all",
    firstSeenFrom: (filters.firstSeenFrom ?? "").trim(),
    lastSeenFrom: (filters.lastSeenFrom ?? "").trim(),
  };
}

export function normalizeSavedQuery(
  mode: SearchMode,
  filters: Partial<SearchFilters>,
): NormalizedSavedQuery {
  return {
    mode,
    filters: normalizeSearchFilters(filters),
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

export function parseSearchParams(searchParams: URLSearchParams) {
  const mode = (searchParams.get("mode") === "keyword" ? "keyword" : "advertiser") as SearchMode;
  const filters = normalizeSearchFilters({
    query: searchParams.get("query") ?? "",
    country: searchParams.get("country") ?? "India",
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
