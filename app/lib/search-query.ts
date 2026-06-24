import { getDomain, parse as parseHostname } from "tldts";

export type SearchQueryIntent = "domain" | "text";

const MULTITENANT_REGISTRABLE_SUFFIXES = new Set([
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "fly.dev",
  "web.app",
  "firebaseapp.com",
]);

export interface ParsedSearchQuery {
  intent: SearchQueryIntent;
  originalInput: string;
  normalizedText: string | null;
  normalizedUrl: string | null;
  hostname: string | null;
  registrableDomain: string | null;
  path: string | null;
  /** Comparable hostname with leading www. removed for matching. */
  comparableHostname: string | null;
}

const DOMAIN_LIKE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const DOMAIN_WITH_PATH =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:\/[^\s]*)?$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const PROSE_WITH_PERIOD = /\s/;

export function parseSearchInput(rawInput: string): ParsedSearchQuery {
  const originalInput = rawInput.trim();
  if (!originalInput) {
    return emptyParsedSearchQuery(originalInput);
  }

  if (PROSE_WITH_PERIOD.test(originalInput) && !looksLikeUrlInput(originalInput)) {
    return textQuery(originalInput);
  }

  const domainCandidate = normalizeDomainCandidate(originalInput);
  if (domainCandidate) {
    return domainQuery(originalInput, domainCandidate);
  }

  return textQuery(originalInput);
}

export function parseSearchInputFromWebsiteField(rawInput: string): ParsedSearchQuery {
  const parsed = parseSearchInput(rawInput);
  if (parsed.intent === "domain") {
    return parsed;
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return parsed;
  }

  const forced = normalizeDomainCandidate(trimmed);
  if (forced) {
    return domainQuery(trimmed, forced);
  }

  return parsed;
}

export function comparableHostname(hostname: string) {
  return stripWww(normalizeHostname(hostname));
}

export function registrableDomainFromHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return null;
  }

  const parsed = parseHostname(normalized, { allowPrivateDomains: false });
  if (parsed.domain && parsed.subdomain && MULTITENANT_REGISTRABLE_SUFFIXES.has(parsed.domain)) {
    return `${parsed.subdomain}.${parsed.domain}`;
  }

  return getDomain(normalized, { allowPrivateDomains: false }) ?? null;
}

export function hostnamesMatchDomainIntent(
  candidateHost: string | null | undefined,
  intent: Pick<ParsedSearchQuery, "hostname" | "comparableHostname" | "registrableDomain">,
) {
  if (!candidateHost) {
    return false;
  }

  const normalized = normalizeHostname(candidateHost);
  const comparable = comparableHostname(normalized);
  const registrable = registrableDomainFromHostname(normalized);

  if (intent.comparableHostname && comparable === intent.comparableHostname) {
    return true;
  }

  if (intent.hostname && normalized === normalizeHostname(intent.hostname)) {
    return true;
  }

  if (intent.registrableDomain && registrable === intent.registrableDomain) {
    return true;
  }

  return false;
}

function emptyParsedSearchQuery(originalInput: string): ParsedSearchQuery {
  return {
    intent: "text",
    originalInput,
    normalizedText: null,
    normalizedUrl: null,
    hostname: null,
    registrableDomain: null,
    path: null,
    comparableHostname: null,
  };
}

function textQuery(originalInput: string): ParsedSearchQuery {
  return {
    intent: "text",
    originalInput,
    normalizedText: normalizeTextQuery(originalInput),
    normalizedUrl: null,
    hostname: null,
    registrableDomain: null,
    path: null,
    comparableHostname: null,
  };
}

function domainQuery(
  originalInput: string,
  candidate: NormalizedDomainCandidate,
): ParsedSearchQuery {
  return {
    intent: "domain",
    originalInput,
    normalizedText: null,
    normalizedUrl: candidate.normalizedUrl,
    hostname: candidate.hostname,
    registrableDomain: candidate.registrableDomain,
    path: candidate.path,
    comparableHostname: candidate.comparableHostname,
  };
}

interface NormalizedDomainCandidate {
  normalizedUrl: string;
  hostname: string;
  registrableDomain: string;
  comparableHostname: string;
  path: string | null;
}

function normalizeDomainCandidate(rawInput: string): NormalizedDomainCandidate | null {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (url.username || url.password) {
    return null;
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || !isDomainLikeHost(hostname)) {
    return null;
  }

  const registrableDomain = registrableDomainFromHostname(hostname);
  if (!registrableDomain) {
    return null;
  }

  const parsed = parseHostname(hostname, { allowPrivateDomains: false });
  if (!parsed.isIcann && !parsed.isPrivate && !parsed.domain) {
    return null;
  }

  url.hash = "";
  url.search = "";
  const path = url.pathname === "/" ? null : url.pathname.replace(/\/+$/, "") || null;
  const comparableHostnameValue = comparableHostname(hostname);

  return {
    normalizedUrl: `${url.protocol}//${hostname}${path ?? ""}`,
    hostname,
    registrableDomain,
    comparableHostname: comparableHostnameValue,
    path,
  };
}

function looksLikeUrlInput(value: string) {
  if (HAS_SCHEME.test(value)) {
    return true;
  }

  return DOMAIN_WITH_PATH.test(value.trim()) || DOMAIN_LIKE.test(value.trim());
}

function isDomainLikeHost(hostname: string) {
  if (!hostname || hostname.includes("..") || hostname.endsWith(".")) {
    return false;
  }

  const parts = hostname.split(".");
  if (parts.length < 2) {
    return false;
  }

  return parts.every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function stripWww(hostname: string) {
  return hostname.replace(/^www\./, "");
}

function normalizeTextQuery(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}
