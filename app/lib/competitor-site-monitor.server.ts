/**
 * Full-Site Watch: sitemap discovery, page classification, bounded crawl
 * fallback, per-class cadence, and honest coverage labels for competitor
 * websites.
 *
 * Everything here is gated behind the FULLSITE_WATCH_ENABLED feature flag by
 * its caller (monitoring.server.ts). When the flag is off, none of these
 * functions run, nothing is written, and no events are emitted.
 *
 * Design baseline: incident-20260811-eve/FULLSITE-WATCH-DESIGN.md (packet 2).
 * Reuses, never reimplements: the content core
 * (app/lib/competitor-site-content.ts) for canonicalization + classification,
 * the lease-fenced observation layer (app/lib/data/watchlist-site-pages.server.ts)
 * for all durable writes, and the SSRF-hardened public-URL helpers
 * (app/lib/public-url.server.ts) for every network hop.
 *
 * Truthfulness wedge: the run manifest's inventory_complete is the only
 * completeness authority. A sitemap that cannot be fetched or parsed is
 * recorded honestly as incomplete — completeness is never claimed.
 */

import {
  canonicalizeCompetitorSiteUrl,
  classifyCompetitorSitePage,
  type CompetitorSitePageKind,
} from "~/lib/competitor-site-content";
import {
  beginWebsiteSiteScan,
  finalizeWebsiteSiteScan,
  upsertWebsitePageObservation,
  upsertWebsiteSiteScanPage,
  type WebsiteScanLease,
} from "~/lib/data/watchlist-site-pages.server";
import type { AppEnv } from "~/lib/env.server";
import {
  fetchWithTimeout,
  releaseFetchTimeout,
} from "~/lib/fetch-timeout.server";
import {
  isPublicHttpUrl,
  normalizePublicHttpUrl,
  resolvePublicHttpUrl,
} from "~/lib/public-url.server";
import { stripAllTags, stripScriptAndStyle } from "~/lib/sanitize-text.server";
import type {
  WebsitePageDiscoverySource,
  WebsitePageKind,
} from "~/lib/types";

// ==== Constants ====

/**
 * Default rotating-batch page budget. Packet 5 (plan metering) owns the
 * per-tier replacement of this default with plan-entitlement budgets; until
 * then the design's free-tier cap is the standing bound.
 */
export const DEFAULT_PAGE_BUDGET = 50;

/** Hard cap on sitemap documents fetched per discovery run (nested sitemaps). */
export const SITEMAP_DOCUMENT_LIMIT = 8;

/** Hard cap on total discovered pages before the budget clamp applies. */
export const SITEMAP_URL_LIMIT = 2_000;

/** Hard cap on crawl BFS depth from the seed page. */
export const CRAWL_MAX_DEPTH = 3;

/** Hard cap on HTTP redirect hops; each hop is SSRF re-validated. */
export const MAX_REDIRECT_HOPS = 5;

/** Bytes cap for fetched sitemap documents. */
export const SITEMAP_MAX_BYTES = 2 * 1024 * 1024;

/** Bytes cap for crawled HTML documents (links only; no content is kept). */
export const CRAWL_PAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Fetch timeout for discovery/crawl fetches. */
export const DISCOVERY_FETCH_TIMEOUT_MS = 15_000;

/** Normalizer version label recorded on every fetched observation. */
export const FULLSITE_OBSERVATION_NORMALIZER_VERSION = "fullsite-watch-v1";

/** Stable failure codes stored on the run manifest. */
export const SITE_SCAN_FAILURE_CODES = {
  SITEMAP_UNREACHABLE: "sitemap_unreachable",
  SITEMAP_UNPARSEABLE: "sitemap_unparseable",
  NO_PUBLIC_ROOT: "no_public_root",
} as const;

// ==== Cadence policy (scheduler constant, not persisted state) ====

export type WebsitePageCadence = "every_3h" | "every_6h" | "daily" | "weekly";

/**
 * Per-class capture cadence (design §2). The run manifest records what was
 * actually fetched; cadence is a scheduler policy constant and is deliberately
 * NOT a schema column.
 */
export const PAGE_KIND_CADENCE: Record<WebsitePageKind, WebsitePageCadence> = {
  pricing: "every_3h",
  home: "every_6h",
  changelog: "every_6h",
  landing: "every_6h",
  product: "daily",
  blog: "daily",
  docs: "daily",
  about: "weekly",
  contact: "weekly",
  other: "weekly",
};

/** One full rotation of the cadence ladder, oldest bucket first. */
export const CADENCE_ORDER: readonly WebsitePageCadence[] = [
  "every_3h",
  "every_6h",
  "daily",
  "weekly",
];

const CADENCE_START_INDEX: Record<WebsitePageCadence, number> = {
  every_3h: 0,
  every_6h: 1,
  daily: 2,
  weekly: 3,
};

/**
 * Deterministically select which pages a run fetches: the hot/warm classes
 * (pricing, home, changelog, landing) always participate, and the cooler
 * classes rotate by cadence bucket. `runCounter` is the run's ordinal (0 for
 * the first run); `maxPages` is the tier budget the caller passes in. Stable
 * order is preserved so retries converge on the same batch.
 */
export function selectWebsitePagesForRun(
  pages: readonly {
    canonicalUrl: string;
    pageKind: WebsitePageKind;
    stableOrder: number;
  }[],
  runCounter: number,
  maxPages: number = DEFAULT_PAGE_BUDGET,
) {
  const budget = Math.min(DEFAULT_PAGE_BUDGET, Math.max(1, Math.floor(maxPages)));
  const sorted = [...pages].sort(
    (a, b) => a.stableOrder - b.stableOrder || (a.canonicalUrl < b.canonicalUrl ? -1 : 1),
  );
  const always = sorted.filter((page) =>
    ["pricing", "home", "changelog", "landing"].includes(page.pageKind),
  );
  const rotating = sorted.filter(
    (page) => !["pricing", "home", "changelog", "landing"].includes(page.pageKind),
  );
  const selected: typeof sorted = [...always];
  const seen = new Set(selected.map((page) => page.canonicalUrl));
  for (const cadence of CADENCE_ORDER) {
    const eligible = rotating.filter(
      (page) => PAGE_KIND_CADENCE[page.pageKind] === cadence,
    );
    const offset = Math.max(0, CADENCE_START_INDEX[cadence]);
    const step = Math.max(1, Math.ceil(eligible.length / 4));
    const bucket = eligible.filter(
      (_, index) => (index + runCounter) % 4 === offset % 4,
    );
    for (const page of bucket) {
      if (selected.length >= budget) break;
      if (seen.has(page.canonicalUrl)) continue;
      seen.add(page.canonicalUrl);
      selected.push(page);
    }
  }
  // Backfill the remainder in stable order so early runs still fill the
  // budget deterministically.
  for (const page of rotating) {
    if (selected.length >= budget) break;
    if (seen.has(page.canonicalUrl)) continue;
    seen.add(page.canonicalUrl);
    selected.push(page);
  }
  return selected.slice(0, budget);
}

// ==== Classification ====

/** Legal path segments map to `other` in the schema vocabulary (packet step 2). */
const LEGAL_PATH_SEGMENTS = new Set([
  "legal",
  "privacy",
  "privacy-policy",
  "terms",
  "terms-of-service",
  "terms-of-use",
  "tos",
  "imprint",
  "impressum",
  "cookies",
  "cookie-policy",
  "gdpr",
  "compliance",
  "security",
  "disclaimer",
]);

/** Offer-ish path segments map to `landing` (packet step 2). */
const LANDING_PATH_SEGMENTS = new Set([
  "landing",
  "landing-page",
  "lp",
  "offer",
  "offers",
  "promo",
  "promotion",
  "campaign",
  "campaigns",
  "splash",
  "waitlist",
  "early-access",
]);

/**
 * Classify a page URL into the schema's page_kind vocabulary, honoring the
 * packet's mapping: `/updates` → changelog, legal paths → `other`, offer-ish
 * paths → `landing`. Reuses the content core's deterministic classification
 * for everything else.
 */
export function classifyWebsitePageKind(url: string): WebsitePageKind {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return "other";
  }
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length > 0 && LEGAL_PATH_SEGMENTS.has(segments[0]!)) {
    return "other";
  }
  if (segments.some((segment) => segment === "updates")) {
    return "changelog";
  }
  if (segments.some((segment) => LANDING_PATH_SEGMENTS.has(segment))) {
    return "landing";
  }
  return classifyCompetitorSitePage(url) as WebsitePageKind;
}

// ==== Sitemap parsing ====

function stripXmlNamespaces(xml: string): string {
  return xml.replace(/<(urlset|sitemapindex)(\s[^>]*)?>/gi, "<$1>");
}

function extractXmlText(xml: string, tag: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const inner = match[1] ?? "";
    const text = stripAllTags(
      stripScriptAndStyle(inner)
        .replace(/<\?xml[^>]*\?>/gi, "")
        .replace(/<![^>]*>/g, ""),
    ).trim();
    if (text !== "") out.push(text);
  }
  return out;
}

/** Extract page URLs from a sitemap document body. */
export function parseSitemapUrls(xml: string): string[] {
  if (typeof xml !== "string" || xml.trim() === "") return [];
  const stripped = stripXmlNamespaces(xml);
  const urls = extractXmlText(stripped, "loc");
  const out: string[] = [];
  for (const raw of urls) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    if (trimmed.length > 2048) continue;
    out.push(trimmed);
  }
  return out;
}

/** Extract nested sitemap document URLs from a sitemap index body. */
export function parseSitemapIndexUrls(xml: string): string[] {
  if (typeof xml !== "string" || xml.trim() === "") return [];
  const stripped = stripXmlNamespaces(xml);
  const hasIndex = /<sitemapindex\b/i.test(stripped);
  if (!hasIndex) return [];
  const urls = extractXmlText(stripped, "loc");
  const out: string[] = [];
  for (const raw of urls) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    if (trimmed.length > 2048) continue;
    out.push(trimmed);
  }
  return out;
}

// ==== Robots.txt ====

function buildRobotsTxtPath(rootUrl: string): string {
  const url = new URL(rootUrl);
  url.pathname = "/robots.txt";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Extract sitemap URLs declared in robots.txt. Only `Sitemap:` directives on
 * their own line are honored; the rest of robots.txt is not interpreted.
 */
export function parseRobotsSitemapUrls(robotsTxt: string): string[] {
  if (typeof robotsTxt !== "string" || robotsTxt.trim() === "") return [];
  const out: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const match = /^\s*Sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (match === null) continue;
    const value = match[1]!.trim();
    if (value === "" || value.length > 2048) continue;
    out.push(value);
  }
  return out;
}

// ==== SSRF-safe fetching ====

export interface SafeFetchResult {
  ok: boolean;
  status: number | null;
  body: string | null;
  finalUrl: string;
  /** Set when the fetch was refused for SSRF/private-range reasons. */
  refusedReason: string | null;
}

/**
 * Fetch one document with SSRF protection on every hop: the request URL must
 * pass the public-URL check, DNS is resolved and every resolved address must
 * be public (resolve-then-connect), redirects are re-validated on each hop,
 * and the hop count is capped. Returns `{ ok: false, refusedReason }` when
 * the URL or any hop is private/localhost/metadata.
 */
export async function safeFetchDocument(
  rawUrl: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? SITEMAP_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DISCOVERY_FETCH_TIMEOUT_MS;
  const initial = normalizePublicHttpUrl(rawUrl);
  if (!initial) {
    return { ok: false, status: null, body: null, finalUrl: rawUrl, refusedReason: "non_public_url" };
  }

  const initialResolved = await resolvePublicHttpUrl(initial.toString());
  if (!initialResolved) {
    return { ok: false, status: null, body: null, finalUrl: initial.toString(), refusedReason: "private_resolution" };
  }

  let current = initialResolved;
  let body = "";
  let status: number | null = null;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        current.toString(),
        {
          redirect: "manual",
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; FiveToNine-FullSiteWatch/1.0; +https://fivetonine.app/bot)",
            accept: "application/xml,text/xml,text/html,text/plain,*/*",
          },
        },
        { timeoutMs },
      );
    } catch {
      return { ok: false, status: null, body: null, finalUrl: current.toString(), refusedReason: "fetch_error" };
    }

    status = response.status;

    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      releaseFetchTimeout(response);
      if (!location) {
        return { ok: false, status, body: null, finalUrl: current.toString(), refusedReason: "redirect_without_location" };
      }
      const next = normalizePublicHttpUrl(new URL(location, current).toString());
      if (!next) {
        return { ok: false, status, body: null, finalUrl: current.toString(), refusedReason: "redirect_non_public" };
      }
      const nextResolved = await resolvePublicHttpUrl(next.toString());
      if (!nextResolved) {
        return { ok: false, status, body: null, finalUrl: next.toString(), refusedReason: "redirect_private_resolution" };
      }
      current = nextResolved;
      continue;
    }

    if (!response.ok) {
      releaseFetchTimeout(response);
      return { ok: false, status, body: null, finalUrl: current.toString(), refusedReason: null };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      releaseFetchTimeout(response);
      return { ok: false, status, body: null, finalUrl: current.toString(), refusedReason: "unreadable_body" };
    }
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          body += new TextDecoder().decode(value);
          if (body.length > maxBytes) {
            return { ok: false, status, body: null, finalUrl: current.toString(), refusedReason: "body_too_large" };
          }
        }
      }
    } finally {
      reader.releaseLock();
      releaseFetchTimeout(response);
    }

    return { ok: true, status, body, finalUrl: current.toString(), refusedReason: null };
  }

  return { ok: false, status: null, body: null, finalUrl: current.toString(), refusedReason: "too_many_redirects" };
}

// ==== Robots rules (crawl Disallow honoring) ====

export interface RobotsRules {
  disallowedPathPrefixes: string[];
}

/** Parse robots.txt into a minimal rule set: Disallow path prefixes for the
 * user-agent `*` (and any agent, per the spec's group semantics). */
export function parseRobotsRules(robotsTxt: string): RobotsRules {
  const disallowedPathPrefixes: string[] = [];
  if (typeof robotsTxt !== "string") return { disallowedPathPrefixes };
  let currentAgent: string | null = null;
  let groupHasAnyAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      currentAgent = value.toLowerCase();
      if (currentAgent === "*") groupHasAnyAgent = true;
      continue;
    }
    if (field === "disallow" && (currentAgent === "*" || groupHasAnyAgent)) {
      if (value !== "") {
        disallowedPathPrefixes.push(value.startsWith("/") ? value : `/${value}`);
      }
    }
  }
  return { disallowedPathPrefixes };
}

export function isPathDisallowedByRobots(
  rules: RobotsRules,
  url: string,
): boolean {
  if (rules.disallowedPathPrefixes.length === 0) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return true;
  }
  return rules.disallowedPathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

// ==== Discovery ====

export interface DiscoveredPage {
  canonicalUrl: string;
  discoverySource: WebsitePageDiscoverySource;
  pageKind: WebsitePageKind;
}

export interface SitemapDiscoveryResult {
  pages: DiscoveredPage[];
  /** Sitemap documents fetched/parsed (for the manifest's sitemap_document_count). */
  sitemapDocumentCount: number;
  /** True only when every sitemap source was fetched and parsed successfully. */
  inventoryComplete: boolean;
  /** Honest failure code when the sitemap could not be fetched/parsed. */
  failureCode: string | null;
}

export interface DiscoverSitemapPagesInput {
  rootUrl: string;
  /** Fetcher override for tests. Returns an already-SSRF-checked document. */
  fetchDocument?: (url: string) => Promise<SafeFetchResult>;
}

/**
 * Sitemap discovery in priority order: robots-declared sitemap →
 * conventional /sitemap.xml → sitemap-content URLs (nested sitemaps, bounded
 * depth). External URLs are skipped. A sitemap that cannot be fetched or
 * parsed yields `inventoryComplete: false` with an honest failure code.
 */
export async function discoverSitemapPages(
  input: DiscoverSitemapPagesInput,
): Promise<SitemapDiscoveryResult> {
  const root = normalizePublicHttpUrl(input.rootUrl);
  if (!root) {
    return {
      pages: [],
      sitemapDocumentCount: 0,
      inventoryComplete: false,
      failureCode: SITE_SCAN_FAILURE_CODES.NO_PUBLIC_ROOT,
    };
  }
  const rootOrigin = root.origin;
  const fetchDocument =
    input.fetchDocument ??
    ((url: string) => safeFetchDocument(url));

  const visitedSitemapUrls = new Set<string>();
  const seenPages = new Map<string, DiscoveredPage>();
  const addPage = (
    canonicalUrl: string,
    discoverySource: WebsitePageDiscoverySource,
  ) => {
    const canonical = canonicalizeCompetitorSiteUrl(canonicalUrl, rootOrigin);
    if (canonical === null) return;
    if (seenPages.has(canonical)) return;
    seenPages.set(canonical, {
      canonicalUrl: canonical,
      discoverySource,
      pageKind: classifyWebsitePageKind(canonical),
    });
  };

  // Phase 1: robots-declared sitemap, then conventional /sitemap.xml.
  const robotsUrl = buildRobotsTxtPath(root.toString());
  let sitemapQueue: string[] = [];
  let conventionalAttempted = false;
  let robotsFetch: SafeFetchResult | null = null;
  let failed = false;
  let failureCode: string | null = null;
  let sitemapDocumentCount = 0;

  const robotsResult = await fetchDocument(robotsUrl);
  if (robotsResult.ok && robotsResult.body !== null) {
    robotsFetch = robotsResult;
    sitemapQueue = parseRobotsSitemapUrls(robotsResult.body);
    // robots.txt itself is not a sitemap document; only the declared sitemaps count.
  }

  const conventional = new URL(root.toString());
  conventional.pathname = "/sitemap.xml";
  conventional.search = "";
  conventional.hash = "";
  const conventionalResult = await fetchDocument(conventional.toString());
  conventionalAttempted = true;
  const conventionalBody =
    conventionalResult.ok && conventionalResult.body !== null
      ? conventionalResult.body
      : null;

  const isSitemapIndexBody = (body: string | null) =>
    body !== null && /<sitemapindex\b/i.test(body);

  // Phase 1.5: if robots declared nothing, the conventional sitemap is the
  // top-level document. If robots declared sitemaps, they are the queue.
  if (sitemapQueue.length === 0) {
    if (conventionalBody !== null && conventionalBody.trim() !== "") {
      sitemapQueue.push(conventional.toString());
      if (isSitemapIndexBody(conventionalBody)) {
        const nested = parseSitemapIndexUrls(conventionalBody);
        sitemapQueue.push(...nested);
      } else {
        for (const url of parseSitemapUrls(conventionalBody)) addPage(url, "conventional_sitemap");
        sitemapDocumentCount += 1;
      }
    } else {
      // Neither a robots-declared sitemap nor a conventional one is
      // reachable: the inventory is honestly incomplete.
      failed = true;
      failureCode = SITE_SCAN_FAILURE_CODES.SITEMAP_UNREACHABLE;
    }
  } else if (conventionalBody !== null && conventionalBody.trim() !== "") {
    // Robots declared sitemaps: the conventional sitemap is still fetched and
    // its pages recorded (source conventional_sitemap) — it may cover more
    // than the robots-declared set.
    if (isSitemapIndexBody(conventionalBody)) {
      const nested = parseSitemapIndexUrls(conventionalBody);
      sitemapQueue.push(...nested);
    } else {
      for (const url of parseSitemapUrls(conventionalBody)) addPage(url, "conventional_sitemap");
      sitemapDocumentCount += 1;
    }
  }

  // Phase 2: drain the sitemap queue (bounded depth + document cap). Each
  // document is either a sitemap index (nested docs) or a urlset (pages).
  let queueIndex = 0;
  while (queueIndex < sitemapQueue.length && sitemapDocumentCount < SITEMAP_DOCUMENT_LIMIT) {
    const sitemapUrl = sitemapQueue[queueIndex]!;
    queueIndex += 1;
    const normalized = normalizePublicHttpUrl(sitemapUrl);
    if (!normalized) continue; // external/private sitemap declarations are skipped
    const canonicalSitemapUrl = normalized.toString();
    if (visitedSitemapUrls.has(canonicalSitemapUrl)) continue;
    visitedSitemapUrls.add(canonicalSitemapUrl);

    const result = await fetchDocument(canonicalSitemapUrl);
    if (!result.ok || result.body === null) {
      // Honest failure: a declared sitemap that cannot be fetched means the
      // inventory is not complete.
      failed = true;
      failureCode =
        result.refusedReason !== null
          ? result.refusedReason
          : SITE_SCAN_FAILURE_CODES.SITEMAP_UNREACHABLE;
      continue;
    }
    sitemapDocumentCount += 1;
    if (sitemapDocumentCount > SITEMAP_DOCUMENT_LIMIT) {
      failed = true;
      failureCode = "sitemap_document_limit";
      break;
    }
    if (isSitemapIndexBody(result.body)) {
      const nested = parseSitemapIndexUrls(result.body);
      for (const nestedUrl of nested) {
        const nestedNormalized = normalizePublicHttpUrl(nestedUrl);
        if (nestedNormalized && !visitedSitemapUrls.has(nestedNormalized.toString())) {
          sitemapQueue.push(nestedNormalized.toString());
        }
      }
      continue;
    }
    const parsedUrls = parseSitemapUrls(result.body);
    if (parsedUrls.length === 0) {
      // An unparseable (or empty) sitemap document is an honest incomplete.
      failed = true;
      failureCode = SITE_SCAN_FAILURE_CODES.SITEMAP_UNPARSEABLE;
      continue;
    }
    for (const url of parsedUrls) {
      addPage(url, "sitemap_content");
    }
    if (seenPages.size >= SITEMAP_URL_LIMIT) {
      failed = true;
      failureCode = "sitemap_url_limit";
      break;
    }
  }

  const inventoryComplete = !failed && sitemapDocumentCount > 0;
  return {
    pages: [...seenPages.values()],
    sitemapDocumentCount,
    inventoryComplete,
    failureCode,
  };
}

// ==== Crawl fallback ====

export interface CrawlPagesInput {
  rootUrl: string;
  seedPage: DiscoveredPage;
  /** Pages already known from the sitemap; crawl skips them. */
  knownPages: ReadonlySet<string>;
  /** Hard cap; never exceeded (budget minus sitemap-discovered count). */
  crawlBudget: number;
  robotsRules: RobotsRules;
  fetchDocument?: (url: string) => Promise<SafeFetchResult>;
  /** HTML link extraction override for tests. */
  extractLinks?: (html: string, baseUrl: string) => string[];
}

const HREF_PATTERN = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** Allowlisted URL schemes. Any absolute URL whose scheme is not in this set
 * is rejected before it can reach a rendered surface (href, img src, digest
 * email). Relative URLs have no scheme and resolve against the crawl base. */
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Allowlist check for URL schemes. Relative URLs (no scheme) resolve against
 * the placeholder origin and come back http; absolute URLs keep their own
 * scheme. Anything outside the allowlist (data:, vbscript:, javascript:,
 * file:, ...) returns false so the caller drops it. */
function hasSafeUrlScheme(href: string): boolean {
  try {
    const parsed = new URL(href, "http://placeholder.invalid/");
    return SAFE_URL_SCHEMES.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/** Extract candidate hrefs from raw HTML (absolute resolution happens in the
 * crawler; only allowlisted schemes survive extraction). */
export function extractInternalLinkHrefs(html: string): string[] {
  if (typeof html !== "string" || html === "") return [];
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = HREF_PATTERN.exec(html)) !== null) {
    const href = match[1]?.trim() ?? "";
    if (href === "" || href.startsWith("#") || !hasSafeUrlScheme(href)) {
      continue;
    }
    if (href.length > 2048) continue;
    out.push(href);
  }
  return out;
}

/**
 * Bounded same-host crawl fallback from the seed page. Honors robots
 * Disallow prefixes, never leaves the root origin, never follows non-http(s)
 * schemes, is depth-bounded, and never exceeds `crawlBudget`. Crawl-discovered
 * pages are recorded with discovery source `sitemap_content` (the schema's
 * vocabulary — see report).
 */
export async function crawlInternalPages(
  input: CrawlPagesInput,
): Promise<DiscoveredPage[]> {
  const root = normalizePublicHttpUrl(input.rootUrl);
  if (!root) return [];
  const rootOrigin = root.origin;
  const rootHostname = root.hostname.toLowerCase();
  const fetchDocument =
    input.fetchDocument ??
    ((url: string) => safeFetchDocument(url));
  const extractLinks = input.extractLinks ?? extractInternalLinkHrefs;

  const discovered: DiscoveredPage[] = [];
  const known = new Set(input.knownPages);
  const queued = new Set<string>();
  let budgetLeft = Math.max(0, Math.floor(input.crawlBudget));

  const tryAdd = (href: string, baseUrl: string): boolean => {
    if (budgetLeft <= 0) return false;
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return false;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return false;
    if (resolved.hostname.toLowerCase() !== rootHostname) return false;
    if (resolved.port !== root.port) return false;
    if (!isPublicHttpUrl(resolved.toString())) return false;
    const canonical = canonicalizeCompetitorSiteUrl(resolved.toString(), rootOrigin);
    if (canonical === null) return false;
    if (known.has(canonical) || queued.has(canonical)) return false;
    if (isPathDisallowedByRobots(input.robotsRules, canonical)) return false;
    queued.add(canonical);
    return true;
  };

  tryAdd(input.seedPage.canonicalUrl, input.seedPage.canonicalUrl);

  let depth = 0;
  let frontier: string[] = [...queued];
  while (frontier.length > 0 && depth < CRAWL_MAX_DEPTH && budgetLeft > 0) {
    const nextFrontier: string[] = [];
    for (const url of frontier) {
      if (budgetLeft <= 0) break;
      if (known.has(url)) continue;
      known.add(url);
      const result = await fetchDocument(url);
      if (!result.ok) continue;
      const html = result.body ?? "";
      discovered.push({
        canonicalUrl: url,
        discoverySource: "sitemap_content",
        pageKind: classifyWebsitePageKind(url),
      });
      budgetLeft -= 1;
      for (const href of extractLinks(html, url)) {
        if (tryAdd(href, url)) {
          nextFrontier.push(
            canonicalizeCompetitorSiteUrl(new URL(href, url).toString(), rootOrigin)!,
          );
        }
      }
    }
    frontier = nextFrontier;
    depth += 1;
  }
  return discovered;
}

// ==== Run orchestration (wired from monitoring.server.ts behind the flag) ====

export interface SiteScanInput {
  lease: WebsiteScanLease;
  rootUrl: string;
  pageBudget: number;
  /** Fetch override for tests; falls back to safeFetchDocument. */
  fetchDocument?: (url: string) => Promise<SafeFetchResult>;
  /** HTML link extraction override for tests. */
  extractLinks?: (html: string, baseUrl: string) => string[];
}

export interface SiteScanRunResult {
  manifestId: string;
  discoveredPageCount: number;
  sitemapDocumentCount: number;
  fetchedPageCount: number;
  inventoryComplete: boolean;
  failureCode: string | null;
}

/**
 * Full discovery + crawl + inventory write for one watchlist run, executed
 * under the run's processing-token lease. All writes go through the
 * lease-fenced observation layer, so retries converge on identical rows.
 * When the sitemap cannot be fetched/parsed, the manifest is finalized with
 * inventory_complete = false and the honest failure code — completeness is
 * never claimed.
 */
export async function runWebsiteSiteScan(
  env: AppEnv,
  input: SiteScanInput,
): Promise<SiteScanRunResult> {
  await beginWebsiteSiteScan(env, {
    ...input.lease,
    rootUrl: input.rootUrl,
    pageBudget: input.pageBudget,
  });

  const root = normalizePublicHttpUrl(input.rootUrl);
  const rootOrigin = root?.origin ?? null;
  const seedUrl = canonicalizeCompetitorSiteUrl(
    input.rootUrl,
    rootOrigin ?? undefined,
  );

  const sitemap = await discoverSitemapPages({
    rootUrl: input.rootUrl,
    fetchDocument: input.fetchDocument,
  });

  const discovered: DiscoveredPage[] = [];
  let stableOrder = 0;
  const knownPages = new Set<string>();
  const addToInventory = (page: DiscoveredPage) => {
    knownPages.add(page.canonicalUrl);
    discovered.push(page);
  };
  if (seedUrl !== null) {
    const seed: DiscoveredPage = {
      canonicalUrl: seedUrl,
      discoverySource: "watchlist_seed",
      pageKind: classifyWebsitePageKind(seedUrl),
    };
    if (!knownPages.has(seed.canonicalUrl)) addToInventory(seed);
  }
  for (const page of sitemap.pages) {
    if (knownPages.has(page.canonicalUrl)) continue;
    addToInventory(page);
  }

  // The crawl fallback is bounded by the budget minus what the sitemap
  // already covered, and needs a seed page; when discovery found nothing
  // (sitemap unreachable), the seed itself still seeds the crawl.
  const crawlBudget = Math.max(
    0,
    Math.min(input.pageBudget, DEFAULT_PAGE_BUDGET) - discovered.length,
  );
  if (crawlBudget > 0 && discovered.length > 0) {
    const crawlPages = await crawlInternalPages({
      rootUrl: input.rootUrl,
      seedPage: discovered[0]!,
      knownPages,
      crawlBudget,
      robotsRules: await loadRobotsRules(input.rootUrl, input.fetchDocument),
      fetchDocument: input.fetchDocument,
      extractLinks: input.extractLinks,
    });
    for (const page of crawlPages) {
      if (knownPages.has(page.canonicalUrl)) continue;
      addToInventory(page);
    }
  }

  // Budget clamp: hottest classes first (pricing/home/changelog/landing),
  // then stable order — the eviction order packet 5 documents.
  const ordered = [...discovered].sort((a, b) => {
    const aHot = ["pricing", "home", "changelog", "landing"].includes(a.pageKind) ? 0 : 1;
    const bHot = ["pricing", "home", "changelog", "landing"].includes(b.pageKind) ? 0 : 1;
    if (aHot !== bHot) return aHot - bHot;
    return a.canonicalUrl < b.canonicalUrl ? -1 : 1;
  });
  const budgeted = ordered.slice(0, Math.min(input.pageBudget, DEFAULT_PAGE_BUDGET));
  const overBudget = discovered.length > budgeted.length;

  for (const page of budgeted) {
    await upsertWebsiteSiteScanPage(env, {
      ...input.lease,
      canonicalUrl: page.canonicalUrl,
      discoverySource: page.discoverySource,
      pageKind: page.pageKind,
      stableOrder: stableOrder++,
    });
  }

  // Finalize: complete only when the sitemap was fully fetched/parsed AND the
  // inventory fits the budget. Over-budget inventories are honestly partial.
  const inventoryComplete =
    sitemap.inventoryComplete && !overBudget && seedUrl !== null;
  const failureCode =
    sitemap.failureCode ?? (overBudget ? "over_budget" : null);

  const manifest = await finalizeWebsiteSiteScan(env, {
    ...input.lease,
    status: inventoryComplete ? "complete" : failureCode !== null ? "failed" : "partial",
    sitemapDocumentCount: sitemap.sitemapDocumentCount,
    failureCode,
  });

  return {
    manifestId: manifest.id,
    discoveredPageCount: manifest.discoveredPageCount,
    sitemapDocumentCount: manifest.sitemapDocumentCount,
    fetchedPageCount: manifest.fetchedPageCount,
    inventoryComplete: manifest.inventoryComplete,
    failureCode: manifest.failureCode,
  };
}

async function loadRobotsRules(
  rootUrl: string,
  fetchDocument?: (url: string) => Promise<SafeFetchResult>,
): Promise<RobotsRules> {
  const root = normalizePublicHttpUrl(rootUrl);
  if (!root) return { disallowedPathPrefixes: [] };
  const robotsUrl = buildRobotsTxtPath(root.toString());
  const fetcher = fetchDocument ?? ((url: string) => safeFetchDocument(url));
  const result = await fetcher(robotsUrl);
  if (!result.ok || result.body === null) return { disallowedPathPrefixes: [] };
  return parseRobotsRules(result.body);
}

// ==== Honest coverage labels ====

export interface WebsiteCoverageLabelInput {
  scan: {
    inventoryComplete: boolean;
    pageBudget: number;
    fetchedPageCount: number;
  };
  pages: readonly { canonicalUrl: string; discoverySource: WebsitePageDiscoverySource }[];
}

/**
 * Build the honest coverage string. Never claims "whole site" unless the
 * manifest says the inventory is complete AND every known page was fetched
 * within the budget. Truthfulness wedge — hard requirement.
 */
export function buildWebsiteCoverageLabel(input: WebsiteCoverageLabelInput): string {
  const known = input.pages.length;
  const sitemapCount = input.pages.filter((page) =>
    ["robots_declared_sitemap", "conventional_sitemap", "sitemap_content"].includes(
      page.discoverySource,
    ),
  ).length;
  const crawlCount = input.pages.filter(
    (page) => page.discoverySource === "sitemap_content",
  ).length;
  const watched = Math.min(input.scan.fetchedPageCount, known);
  const lastFullCrawl = "last full crawl <date>";
  if (
    input.scan.inventoryComplete &&
    known > 0 &&
    watched >= known &&
    known <= input.scan.pageBudget
  ) {
    return `All ${known} known pages watched; sitemap discovered ${sitemapCount}; crawl reached ${crawlCount}; ${lastFullCrawl}`;
  }
  return `${watched} of ${known} known pages watched; sitemap discovered ${sitemapCount}; crawl reached ${crawlCount}; ${lastFullCrawl}`;
}
