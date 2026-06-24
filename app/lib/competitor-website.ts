import {
  fingerprintSavedQuery,
  hashString,
  stableStringify,
} from "~/lib/normalize";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import type { NormalizedSavedQuery, SearchFilters } from "~/lib/types";

export interface CompetitorWebsiteState {
  raw: string;
  normalizedUrl: string | null;
  host: string | null;
  displayName: string | null;
  searchTerm: string | null;
  error: string | null;
}

export function normalizeCompetitorWebsiteInput(value: string): CompetitorWebsiteState {
  const raw = value.trim();
  if (!raw) {
    return emptyCompetitorWebsite();
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return invalidCompetitorWebsite(raw, "Use a normal website address, like brand.com.");
    }
    if (url.username || url.password) {
      return invalidCompetitorWebsite(raw, "Enter the website domain only, like brand.com.");
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!isPublicDomainLikeHost(host)) {
      return invalidCompetitorWebsite(raw, "That website looks incomplete. Add the full domain, like brand.com.");
    }

    url.hash = "";
    url.search = "";
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    const parsedDomain = parseSearchInputFromWebsiteField(raw);
    const searchTerm =
      parsedDomain.intent === "domain"
        ? parsedDomain.registrableDomain ?? host
        : inferSearchTermFromHost(host) || host;
    const brandLabel =
      parsedDomain.intent === "domain"
        ? inferSearchTermFromHost(host) || parsedDomain.registrableDomain?.split(".")[0] || host
        : searchTerm;

    return {
      raw,
      normalizedUrl: `${url.protocol}//${host}${path}`,
      host,
      displayName: brandLabel ? titleCase(brandLabel) : host,
      searchTerm: searchTerm || host,
      error: null,
    };
  } catch {
    return invalidCompetitorWebsite(raw, "Enter a valid website address, like brand.com.");
  }
}

export function emptyCompetitorWebsite(): CompetitorWebsiteState {
  return {
    raw: "",
    normalizedUrl: null,
    host: null,
    displayName: null,
    searchTerm: null,
    error: null,
  };
}

export function invalidCompetitorWebsite(raw: string, error: string): CompetitorWebsiteState {
  return {
    ...emptyCompetitorWebsite(),
    raw,
    error,
  };
}

export function competitorTrackingLabel(
  competitorWebsite: CompetitorWebsiteState,
  query?: string | null,
) {
  return (
    competitorWebsite.displayName ??
    query ??
    competitorWebsite.searchTerm ??
    competitorWebsite.host ??
    "Competitor"
  );
}

export function hasInvalidCompetitorWebsite(competitorWebsite: CompetitorWebsiteState) {
  return Boolean(competitorWebsite.raw && competitorWebsite.error);
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

function isPublicDomainLikeHost(host: string) {
  if (!host || host.includes("..") || host.endsWith(".")) {
    return false;
  }

  const parts = host.split(".");
  if (parts.length < 2) {
    return false;
  }

  const topLevelDomain = parts[parts.length - 1] ?? "";
  return parts.every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)) &&
    (/^[a-z]{2,}$/i.test(topLevelDomain) || /^xn--[a-z0-9-]{2,59}$/i.test(topLevelDomain));
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
