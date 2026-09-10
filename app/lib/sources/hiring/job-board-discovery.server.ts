import type { SourceFetchContext } from "~/lib/sources/types";
import { registrableDomainFromHostname } from "~/lib/search-query";

/**
 * Job-board slug discovery (#2199).
 *
 * Per competitor, once, discover a public Greenhouse / Ashby / Lever board
 * slug by fetching the competitor's homepage (and, if linked, ONE careers-ish
 * page) and scanning the HTML for a known board URL. When the HTML carries no
 * board link, fall back to probing the registrable-domain label against each
 * provider's public API and keep the first that returns HTTP 200.
 *
 * Operational rules (mirrored from the tiktok-ads pattern):
 *  - plain fetch, ONE attempt per page, 20s AbortController, no in-app retry.
 *  - A homepage that fails/times out returns `{ unavailable: true, reason }`.
 *  - HTML-discovered slugs are `verified: true`. Domain-guessed slugs are
 *    `verified: false` — an "unconfirmed board" that must never alert until a
 *    manual override confirms it.
 *
 * The pure, fetch-free parts (`findBoardInHtml`, `findCareersLink`) and the
 * injected-fetch `guessBoardFromDomain` are unit-testable from fixtures.
 * `discoverJobBoard` is the top-level entry point.
 */

export type JobBoardProvider = "greenhouse" | "ashby" | "lever";

export type FetchFn = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface JobBoard {
  provider: JobBoardProvider;
  slug: string;
}

export const JOB_BOARD_PROVIDERS: readonly JobBoardProvider[] = [
  "greenhouse",
  "ashby",
  "lever",
];

export const GREENHOUSE_BOARDS_URL = "https://boards.greenhouse.io";
export const GREENHOUSE_API_URL = "https://boards-api.greenhouse.io";
export const ASHBY_API_URL = "https://api.ashbyhq.com";
export const LEVER_API_URL = "https://api.lever.co";

/** One page / one probe fetch budget. 20s, one attempt, no retry. */
export const FETCH_TIMEOUT_MS = 20_000;

const defaultFetch: FetchFn = (url, init) => globalThis.fetch(url, init);

/** Greenhouse board-slug path segments that are platform chrome, not a company. */
const RESERVED_BOARD_SLUGS = new Set([
  "",
  "boards",
  "job-boards",
  "embed",
  "job_board",
  "job-board",
  "jobs",
  "connect",
  "post",
  "manage",
  "help",
  "api",
  "app",
  "www",
]);

/** Greenhouse subdomain prefixes that are platform chrome, not a company slug. */
const RESERVED_GREENHOUSE_SUBDOMAINS = new Set([
  "boards",
  "job",
  "job-boards",
  "boards-api",
  "api",
  "app",
  "www",
  "embed",
  "help",
  "support",
  "blog",
  "careers",
  "jobs",
  "connect",
  "recruit",
  "hire",
]);

export interface DiscoverOptions {
  /** Competitor hostname/domain, e.g. "acme.com". */
  domain: string;
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetchFn?: FetchFn;
}

export interface DiscoveredBoard extends JobBoard {
  verified: boolean;
}

/**
 * Result of `discoverJobBoard`:
 *  - a `DiscoveredBoard` when a board link was found in HTML (verified true) or
 *    a domain guess returned HTTP 200 (verified false);
 *  - `{ unavailable: true, reason }` when the homepage could not be fetched
 *    (network down / timeout) — never retried here; or
 *  - `{ board: null }` when the site fetched fine but no board was found.
 */
export type DiscoveryResult =
  | DiscoveredBoard
  | { unavailable: true; reason: string }
  | { board: null };

/**
 * Scan raw HTML (DOM-free, case-insensitive regex) for a Greenhouse / Ashby /
 * Lever board URL. Returns the first match in provider priority order
 * (greenhouse boards, greenhouse job-boards, lever, ashby, then a standalone
 * `<slug>.greenhouse.io` host). Pure and fixture-testable.
 */
export function findBoardInHtml(html: string): JobBoard | null {
  const boards = firstHtmlSlug(html, /\bboards\.greenhouse\.io\/([a-z0-9_-]+)/gi);
  if (boards) return { provider: "greenhouse", slug: boards };

  const jobBoards = firstHtmlSlug(
    html,
    /\bjob-boards\.greenhouse\.io\/([a-z0-9_-]+)/gi,
  );
  if (jobBoards) return { provider: "greenhouse", slug: jobBoards };

  const lever = firstHtmlSlug(html, /\bjobs\.lever\.co\/([a-z0-9_-]+)/gi);
  if (lever) return { provider: "lever", slug: lever };

  const ashby = firstHtmlSlug(html, /\bjobs\.ashbyhq\.com\/([a-z0-9_-]+)/gi);
  if (ashby) return { provider: "ashby", slug: ashby };

  const subdomain = firstGreenhouseSubdomain(html);
  if (subdomain) return { provider: "greenhouse", slug: subdomain };

  return null;
}

/**
 * Find the first careers-ish link on the page: an anchor whose text matches
 * /careers|jobs|join/i or whose RESOLVED pathname is /careers or /jobs
 * (optionally with a trailing path). The href is resolved against `baseUrl`
 * BEFORE the path check, so an absolute `<a href="https://acme.com/careers">`
 * matches even when its text does not. Returns null when no anchor qualifies.
 * Pure and fixture-testable.
 */
export function findCareersLink(html: string, baseUrl: string): string | null {
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>(.*?)<\/a>/gis;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2];
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    const textHit = /careers|jobs|join/i.test(text);
    let resolved: URL;
    try {
      resolved = new URL(href, new URL(baseUrl));
    } catch {
      // One unparsable href (e.g. a malformed host) must not abort the scan:
      // skip this anchor and keep looking for a later careers link.
      continue;
    }
    const pathHit =
      /^\/careers(?:\/|$)/i.test(resolved.pathname) ||
      /^\/jobs(?:\/|$)/i.test(resolved.pathname);
    if (!textHit && !pathHit) continue;
    return resolved.href;
  }
  return null;
}

/**
 * Try Greenhouse, then Ashby, then Lever for a board whose company slug equals
 * the registrable-domain label. Keep the FIRST provider that returns HTTP 200.
 * A thrown/timed-out probe just means that provider is not it (continue). When
 * none return 200, null. Fetch is injected for testability.
 */
export async function guessBoardFromDomain(
  domainLabel: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<JobBoard | null> {
  const label = domainLabel.toLowerCase();
  const probes: Array<{ provider: JobBoardProvider; url: string }> = [
    {
      provider: "greenhouse",
      url: `${GREENHOUSE_API_URL}/v1/boards/${label}/jobs`,
    },
    {
      provider: "ashby",
      url: `${ASHBY_API_URL}/posting-api/job-board/${label}`,
    },
    {
      provider: "lever",
      url: `${LEVER_API_URL}/v0/postings/${label}?mode=json`,
    },
  ];
  for (const p of probes) {
    const ok = await probeOk(p.url, fetchFn);
    if (!ok) continue;
    return { provider: p.provider, slug: label };
  }
  return null;
}

/**
 * Top-level discovery: fetch the homepage, scan it, optionally fetch one linked
 * careers page and scan it, then fall back to a domain-label guess. The pure
 * parts (`findBoardInHtml`, `findCareersLink`, `guessBoardFromDomain`) are the
 * testable surface; this only orchestrates I/O.
 */
export async function discoverJobBoard(
  env: unknown,
  competitor: SourceFetchContext,
  opts: DiscoverOptions,
): Promise<DiscoveryResult> {
  void env;
  void competitor;
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const { host, baseUrl } = parseDomain(opts.domain);

  const home = await fetchHtml(baseUrl, fetchFn);
  if (!home.ok) {
    return { unavailable: true, reason: home.reason };
  }
  const homeBoard = findBoardInHtml(home.html);
  if (homeBoard) return { ...homeBoard, verified: true };

  const careersUrl = findCareersLink(home.html, baseUrl);
  if (careersUrl && careersUrl !== baseUrl) {
    const page = await fetchHtml(careersUrl, fetchFn);
    if (page.ok) {
      const pageBoard = findBoardInHtml(page.html);
      if (pageBoard) return { ...pageBoard, verified: true };
    }
  }

  const label = guessLabelFromHost(host);
  if (label) {
    const guessed = await guessBoardFromDomain(label, fetchFn);
    if (guessed) {
      return { provider: guessed.provider, slug: guessed.slug, verified: false };
    }
  }

  return { board: null };
}

/* ----------------------------- pure helpers ----------------------------- */

function firstHtmlSlug(html: string, re: RegExp): string | null {
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    if (RESERVED_BOARD_SLUGS.has(slug.toLowerCase())) continue;
    // Lowercase so an HTML-discovered slug matches the domain-guess path and
    // the provider tokens regardless of the case used in the page markup.
    return slug.toLowerCase();
  }
  return null;
}

function firstGreenhouseSubdomain(html: string): string | null {
  const re = /\b([a-z0-9_-]+)\.greenhouse\.io\b/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    if (RESERVED_GREENHOUSE_SUBDOMAINS.has(slug)) continue;
    return slug;
  }
  return null;
}

function parseDomain(domain: string): { host: string; baseUrl: string } {
  let host = domain.trim();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    }
  }
  host = host
    .split("/")[0]
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return { host, baseUrl: `https://${host}` };
}

/** registrable-domain label, e.g. "acme" from acme.com. */
function guessLabelFromHost(host: string): string | null {
  const registrable = registrableDomainFromHostname(host);
  const base = registrable ?? host;
  const first = base.split(".")[0];
  return first && first !== "www" ? first : null;
}

async function fetchHtml(
  url: string,
  fetchFn: FetchFn,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, { signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return { ok: false, reason: "site_unreachable" };
  }
  clearTimeout(timer);
  if (!res.ok) {
    return { ok: false, reason: "site_unreachable" };
  }
  const html = await res.text().catch(() => "");
  return { ok: true, html };
}

async function probeOk(url: string, fetchFn: FetchFn): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}