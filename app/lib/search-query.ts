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

/**
 * Same brand, different country site: allbirds.com vs allbirds.co.uk,
 * mamaearth.com vs mamaearth.in.
 *
 * Restricted so it cannot reopen the okara.ai geography-keyword hole:
 * the searched domain must be a generic commercial TLD (.com/.net/.org),
 * the landing host must share the brand label and use a geographic ccTLD,
 * and open ccTLDs used as generic brands (.io, .ai, .co, …) never count.
 */
export function hostnamesMatchBrandRegionalProperty(
  candidateHost: string | null | undefined,
  intent: Pick<ParsedSearchQuery, "registrableDomain">,
) {
  if (!candidateHost || !intent.registrableDomain) {
    return false;
  }

  const candidateNormalized = normalizeHostname(candidateHost);
  const candidateParsed = parseHostname(candidateNormalized, { allowPrivateDomains: false });
  const intentParsed = parseHostname(intent.registrableDomain, { allowPrivateDomains: false });
  const candidateLabel = candidateParsed.domainWithoutSuffix?.toLowerCase() ?? "";
  const intentLabel = intentParsed.domainWithoutSuffix?.toLowerCase() ?? "";
  const candidateSuffix = (candidateParsed.publicSuffix ?? "").toLowerCase();
  const intentSuffix = (intentParsed.publicSuffix ?? "").toLowerCase();

  if (!candidateLabel || candidateLabel !== intentLabel || candidateLabel.length < 3) {
    return false;
  }
  if (candidateSuffix === intentSuffix) {
    return false;
  }
  if (!candidateParsed.isIcann || !intentParsed.isIcann) {
    return false;
  }
  if (candidateParsed.domain && MULTITENANT_REGISTRABLE_SUFFIXES.has(candidateParsed.domain)) {
    return false;
  }
  if (!isGenericCommercialPublicSuffix(intentSuffix)) {
    return false;
  }
  return isGeographicPublicSuffix(candidateSuffix);
}

/**
 * Hyphen vs concatenated brand domains: hugo-boss.com vs hugoboss.com.
 * Folded labels must match, the registrable hosts must differ, and both
 * sides must be ICANN. Does not treat the searched host as its own twin.
 */
export function hostnamesMatchBrandCollapsedLabel(
  candidateHost: string | null | undefined,
  intent: Pick<ParsedSearchQuery, "registrableDomain">,
) {
  if (!candidateHost || !intent.registrableDomain) {
    return false;
  }

  const candidateNormalized = normalizeHostname(candidateHost);
  const candidateParsed = parseHostname(candidateNormalized, { allowPrivateDomains: false });
  const intentParsed = parseHostname(intent.registrableDomain, { allowPrivateDomains: false });
  const candidateLabel = foldDomainLabel(candidateParsed.domainWithoutSuffix ?? "");
  const intentLabel = foldDomainLabel(intentParsed.domainWithoutSuffix ?? "");
  const candidateRegistrable = registrableDomainFromHostname(candidateNormalized);
  const intentRegistrable = intent.registrableDomain;

  if (!candidateLabel || candidateLabel !== intentLabel || candidateLabel.length < 4) {
    return false;
  }
  if (!candidateRegistrable || candidateRegistrable === intentRegistrable) {
    return false;
  }
  if (!candidateParsed.isIcann || !intentParsed.isIcann) {
    return false;
  }
  if (candidateParsed.domain && MULTITENANT_REGISTRABLE_SUFFIXES.has(candidateParsed.domain)) {
    return false;
  }
  return true;
}

/**
 * Brand TLD on an open ccTLD (.so/.io/.ai) whose ads land on the same label
 * at .com/.net/.org: notion.so → notion.com.
 *
 * One direction only. Searching analytics.com must not verify analytics.io.
 */
export function hostnamesMatchOpenCctldToGenericCommercial(
  candidateHost: string | null | undefined,
  intent: Pick<ParsedSearchQuery, "registrableDomain">,
) {
  if (!candidateHost || !intent.registrableDomain) {
    return false;
  }

  const candidateNormalized = normalizeHostname(candidateHost);
  const candidateParsed = parseHostname(candidateNormalized, { allowPrivateDomains: false });
  const intentParsed = parseHostname(intent.registrableDomain, { allowPrivateDomains: false });
  const candidateLabel = (candidateParsed.domainWithoutSuffix ?? "").toLowerCase();
  const intentLabel = (intentParsed.domainWithoutSuffix ?? "").toLowerCase();
  const candidateSuffix = (candidateParsed.publicSuffix ?? "").toLowerCase();
  const intentSuffix = (intentParsed.publicSuffix ?? "").toLowerCase();

  if (!candidateLabel || candidateLabel !== intentLabel || candidateLabel.length < 3) {
    return false;
  }
  if (!OPEN_CCTLD_USED_AS_GENERIC.has(intentSuffix)) {
    return false;
  }
  if (!isGenericCommercialPublicSuffix(candidateSuffix)) {
    return false;
  }
  if (!candidateParsed.isIcann || !intentParsed.isIcann) {
    return false;
  }
  if (candidateParsed.domain && MULTITENANT_REGISTRABLE_SUFFIXES.has(candidateParsed.domain)) {
    return false;
  }
  return true;
}

/**
 * Product-domain extension on the same generic commercial TLD: oura.com ads
 * that land on ouraring.com. Search label length >= 4, remainder >= 3.
 * Callers that need advertiser confirmation (search matching) must still
 * check the advertiser is the brand; this helper is hostname-only.
 */
export function hostnamesMatchBrandStemExtension(
  candidateHost: string | null | undefined,
  intent: Pick<ParsedSearchQuery, "registrableDomain">,
) {
  if (!candidateHost || !intent.registrableDomain) {
    return false;
  }

  const candidateNormalized = normalizeHostname(candidateHost);
  const candidateParsed = parseHostname(candidateNormalized, { allowPrivateDomains: false });
  const intentParsed = parseHostname(intent.registrableDomain, { allowPrivateDomains: false });
  const candidateLabel = foldDomainLabel(candidateParsed.domainWithoutSuffix ?? "");
  const intentLabel = foldDomainLabel(intentParsed.domainWithoutSuffix ?? "");
  const candidateSuffix = (candidateParsed.publicSuffix ?? "").toLowerCase();
  const intentSuffix = (intentParsed.publicSuffix ?? "").toLowerCase();

  if (intentLabel.length < 4 || candidateLabel.length < intentLabel.length + 3) {
    return false;
  }
  if (!candidateLabel.startsWith(intentLabel)) {
    return false;
  }
  const remainder = candidateLabel.slice(intentLabel.length);
  if (!/^[a-z]{3,}$/.test(remainder)) {
    return false;
  }
  if (!isGenericCommercialPublicSuffix(intentSuffix) || !isGenericCommercialPublicSuffix(candidateSuffix)) {
    return false;
  }
  if (candidateSuffix !== intentSuffix) {
    return false;
  }
  if (!candidateParsed.isIcann || !intentParsed.isIcann) {
    return false;
  }
  if (candidateParsed.domain && MULTITENANT_REGISTRABLE_SUFFIXES.has(candidateParsed.domain)) {
    return false;
  }
  return true;
}

/**
 * Hostname-only verified brand properties (regional, hyphen-collapsed, and
 * open-ccTLD → .com). Stem extensions stay separate because they need an
 * advertiser check in the matcher.
 */
export function hostnamesMatchBrandVerifiedProperty(
  candidateHost: string | null | undefined,
  intent: Pick<ParsedSearchQuery, "registrableDomain">,
) {
  return (
    hostnamesMatchBrandRegionalProperty(candidateHost, intent) ||
    hostnamesMatchBrandCollapsedLabel(candidateHost, intent) ||
    hostnamesMatchOpenCctldToGenericCommercial(candidateHost, intent)
  );
}

export function foldDomainLabel(label: string) {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const GENERIC_COMMERCIAL_PUBLIC_SUFFIXES = new Set(["com", "net", "org"]);

/**
 * ccTLDs sold as generic/brand TLDs. Treating them as country sites would
 * verify analytics.com ads that land on analytics.io — different companies.
 */
const OPEN_CCTLD_USED_AS_GENERIC = new Set([
  "io",
  "ai",
  "tv",
  "me",
  "cc",
  "co",
  "ws",
  "nu",
  "fm",
  "am",
  "ly",
  "gd",
  "to",
  "gg",
  "je",
  "sh",
  "so",
  "cm",
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "pw",
  "vc",
  "sc",
  "bz",
  "ms",
  "tc",
  "vg",
  "ac",
  "gl",
]);

const COMPOUND_GEOGRAPHIC_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "com.kw",
  "com.sa",
  "com.bh",
  "com.qa",
  "com.om",
  "com.ae",
  "co.za",
  "co.jp",
  "co.kr",
  "com.mx",
  "com.br",
  "com.ar",
  "com.co",
  "com.sg",
  "com.hk",
  "com.my",
  "com.ph",
  "com.tr",
  "com.ng",
  "co.in",
  "com.in",
  "co.id",
  "com.tw",
  "com.pk",
  "com.bd",
  "com.np",
  "com.lk",
  "com.vn",
  "com.eg",
]);

function isGenericCommercialPublicSuffix(publicSuffix: string) {
  return GENERIC_COMMERCIAL_PUBLIC_SUFFIXES.has(publicSuffix);
}

function isGeographicPublicSuffix(publicSuffix: string) {
  if (COMPOUND_GEOGRAPHIC_PUBLIC_SUFFIXES.has(publicSuffix)) {
    return true;
  }
  return publicSuffix.length === 2 && !OPEN_CCTLD_USED_AS_GENERIC.has(publicSuffix);
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

/**
 * Derive the most-likely intended domain from a bare keyword so a keyword
 * search can attempt a verified classification. A single bare label with no
 * dots, spaces, or slashes (e.g. "goat") maps to `<label>.com`. Anything that
 * already looks like a domain, a path, or a multi-word phrase is left alone —
 * the caller already has a domain or the intent is too ambiguous to guess.
 */
export function suggestVerifiedSearchDomain(keyword: string): string | null {
  const stem = keyword.trim().toLowerCase();
  if (!stem) {
    return null;
  }
  // Already a domain-like input — the caller should have used ?website=, so
  // do not fabricate a second guess.
  if (stem.includes(".") || stem.includes("/") || stem.includes(" ")) {
    return null;
  }
  // Strip common brand-noise suffixes so "goat app" → "goat" → "goat.com",
  // not "goatapp.com". Conservative: only trailing "app"/"hq"/"co" when the
  // remaining stem is at least 3 chars (avoids "co" → "" ).
  const cleaned = stem.replace(/(app|hq|co)$/, (suffix, _match, offset) =>
    offset >= 3 ? "" : suffix,
  );
  const label = cleaned || stem;
  if (label.length < 2) {
    return null;
  }
  return `${label}.com`;
}
