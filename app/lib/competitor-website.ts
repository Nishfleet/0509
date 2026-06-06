import {
  fingerprintSavedQuery,
  hashString,
  stableStringify,
} from "~/lib/normalize";
import type { NormalizedSavedQuery, SearchFilters } from "~/lib/types";

export interface CompetitorWebsiteState {
  raw: string;
  normalizedUrl: string | null;
  host: string | null;
  displayName: string | null;
  searchTerm: string | null;
}

export function normalizeCompetitorWebsiteInput(value: string): CompetitorWebsiteState {
  const raw = value.trim();
  if (!raw) {
    return emptyCompetitorWebsite();
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) {
      return { ...emptyCompetitorWebsite(), raw };
    }

    url.hash = "";
    url.search = "";
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    const searchTerm = inferSearchTermFromHost(host);

    return {
      raw,
      normalizedUrl: `${url.protocol}//${host}${path}`,
      host,
      displayName: searchTerm ? titleCase(searchTerm) : host,
      searchTerm: searchTerm || host,
    };
  } catch {
    return { ...emptyCompetitorWebsite(), raw };
  }
}

export function emptyCompetitorWebsite(): CompetitorWebsiteState {
  return {
    raw: "",
    normalizedUrl: null,
    host: null,
    displayName: null,
    searchTerm: null,
  };
}

export function applyWebsiteSearchFallback<T extends { mode: "advertiser" | "keyword"; filters: SearchFilters }>(
  parsed: T,
  competitorWebsite: CompetitorWebsiteState,
) {
  if (parsed.filters.query || !competitorWebsite.searchTerm) {
    return {
      ...parsed,
      fingerprint: fingerprintSavedQuery(parsed),
    };
  }

  const filters = {
    ...parsed.filters,
    query: competitorWebsite.searchTerm,
  };
  return {
    ...parsed,
    mode: "advertiser" as const,
    filters,
    fingerprint: fingerprintSavedQuery({ mode: "advertiser", filters }),
  };
}

export function watchlistFingerprint(
  query: NormalizedSavedQuery,
  competitorWebsite: CompetitorWebsiteState,
) {
  if (!competitorWebsite.normalizedUrl) {
    return fingerprintSavedQuery(query);
  }

  return hashString(
    stableStringify({
      kind: "competitor_website",
      website: competitorWebsite.normalizedUrl,
      query,
    }),
  );
}

export function isHttpCompetitorWebsite(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function inferSearchTermFromHost(host: string) {
  const root = host.split(".").find((part) => part && part !== "www") ?? host;
  return root
    .replace(/[-_]+/g, " ")
    .replace(/\b(official|store|shop|india|in)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
