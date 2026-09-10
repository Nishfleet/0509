/**
 * Google Ads Transparency Center — SearchCreatives RPC client (#2189).
 *
 * Calls the public, no-auth, datacenter-IP-reachable RPC at
 * adstransparency.google.com that powers the Ads Transparency Center. Every
 * ad an advertiser is running is returned (40 per page), not the handful a
 * single search query surfaces. Verified live from the VPS: HTTP 200 in
 * ~0.3s, no cookies, no browser. Reference for the payload format:
 * github.com/faniAhmed/GoogleAdsTransparencyScraper (GoogleAds/main.py) and
 * the HonestAds Cloudflare Worker proxy (github.com/amocsub/HonestAds).
 *
 * Contract (issue #2189 do:1):
 * - pages through SearchCreatives (40 per page, stop at maxCreatives or no token)
 * - 1 request per second max between pages
 * - 20s timeout per request
 * - ONE attempt per page (no retry loop)
 * - returns normalized creatives, or { unavailable: true, reason } on
 *   non-200 / parse failure / HTML response
 * - any format enum not mapped -> 'unknown'; never block on an unmapped value
 * - when maxCreatives is hit, the caller records truncated: true (200 is never
 *   the full count for big advertisers)
 * - stores previewUrl only (extracted from the img html); never stores the
 *   img html itself
 */

const ENDPOINT =
  "https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  Origin: "https://adstransparency.google.com",
  Referer: "https://adstransparency.google.com/",
};

const PAGE_SIZE = 40;
const REQUEST_TIMEOUT_MS = 20_000;
const INTER_PAGE_DELAY_MS = 1_000;

export type GoogleAdsCreativeFormat = "text" | "image" | "video" | "unknown";

export interface GoogleAdsCreative {
  advertiserId: string;
  advertiserName: string;
  creativeId: string;
  format: GoogleAdsCreativeFormat;
  domain: string;
  firstShownAt: string | null;
  lastShownAt: string | null;
  previewUrl: string | null;
}

export interface GoogleAdsFetchResult {
  creatives: GoogleAdsCreative[];
  truncated: boolean;
}

export interface GoogleAdsUnavailable {
  unavailable: true;
  reason: string;
}

export interface FetchCreativesOptions {
  /** Stop paging once this many creatives are collected. Default 200. */
  maxCreatives?: number;
  /**
   * Injectable fetch (tests). Defaults to the global fetch. The Worker's
   * global fetch is used in production.
   */
  fetchImpl?: typeof fetch;
  /** Injectable clock for the inter-page delay (tests). */
  now?: () => number;
}

/**
 * Format enum mapping, derived from fixtures captured across three domains
 * (nike.com, notion.so, a zero-ad domain) and confirmed against the
 * GoogleAdsTransparencyScraper reference, which maps the LookupCreative
 * format field the same way: 1 = Text, 2 = Image, 3 = Video. The
 * SearchCreatives creative carries the same enum at key `4`. Any value
 * outside {1,2,3} -> 'unknown'; the caller never blocks on an unmapped value.
 */
function mapFormat(value: unknown): GoogleAdsCreativeFormat {
  if (value === 1) return "text";
  if (value === 2) return "image";
  if (value === 3) return "video";
  return "unknown";
}

/**
 * Extract the preview image URL from the creative's preview HTML. The img
 * html lives at preview sub-key `3.2` (issue field guide) / observed at
 * `3.3.2` in captured fixtures; both paths are checked. Only the URL is
 * kept — the img html itself is never stored.
 */
function extractPreviewUrl(preview: unknown): string | null {
  if (!preview || typeof preview !== "object") return null;
  const p = preview as Record<string, unknown>;
  const candidates: unknown[] = [];
  // Observed path: preview.3.2 holds "<img src=...>".
  if (p["3"] && typeof p["3"] === "object") {
    candidates.push((p["3"] as Record<string, unknown>)["2"]);
  }
  // Issue field-guide path: preview.2 holds the img html.
  candidates.push(p["2"]);
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const match = raw.match(/<img[^>]*\bsrc=["']([^"']+)["']/i);
    if (match) return match[1];
  }
  return null;
}

function epochToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function normalizeCreative(raw: Record<string, unknown>): GoogleAdsCreative | null {
  const advertiserId = raw["1"];
  const creativeId = raw["2"];
  if (typeof advertiserId !== "string" || typeof creativeId !== "string") {
    return null;
  }
  const firstShown = raw["6"] as Record<string, unknown> | undefined;
  const lastShown = raw["7"] as Record<string, unknown> | undefined;
  return {
    advertiserId,
    advertiserName: typeof raw["12"] === "string" ? raw["12"] : "",
    creativeId,
    format: mapFormat(raw["4"]),
    domain: typeof raw["14"] === "string" ? raw["14"] : "",
    firstShownAt: epochToIso(firstShown?.["1"]),
    lastShownAt: epochToIso(lastShown?.["1"]),
    previewUrl: extractPreviewUrl(raw["3"]),
  };
}

function sleep(ms: number, now: () => number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

interface ParsedPage {
  creatives: Record<string, unknown>[];
  nextPageToken: string | null;
}

async function fetchPage(
  domain: string,
  pageToken: string | null,
  fetchImpl: typeof fetch,
): Promise<ParsedPage | GoogleAdsUnavailable> {
  const req: Record<string, unknown> = {
    "2": PAGE_SIZE,
    "3": { "12": { "1": domain, "2": true } },
    "7": { "1": 1 },
  };
  if (pageToken) {
    req["4"] = pageToken;
  }
  const body = new URLSearchParams();
  body.set("f.req", JSON.stringify(req));

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: HEADERS,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { unavailable: true, reason: "fetch_error" };
  }

  if (!response.ok) {
    return { unavailable: true, reason: `http_${response.status}` };
  }

  const text = await response.text();
  // An HTML response (captcha / block page) is not the JSON RPC payload.
  if (text.trimStart().startsWith("<")) {
    return { unavailable: true, reason: "html_response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { unavailable: true, reason: "parse_failure" };
  }

  const obj = parsed as Record<string, unknown>;
  const creatives = Array.isArray(obj["1"]) ? (obj["1"] as Record<string, unknown>[]) : [];
  const nextPageToken = typeof obj["2"] === "string" ? (obj["2"] as string) : null;
  return { creatives, nextPageToken };
}

/**
 * Fetch up to `maxCreatives` (default 200) Google Ads creatives for a
 * registrable domain by paging the SearchCreatives RPC. One attempt per
 * page (no retry), 20s timeout per request, at most one request per second.
 * Returns the normalized creative list and whether it was truncated at the
 * cap, or `{ unavailable: true, reason }` on the first non-200 / parse
 * failure / HTML response.
 */
export async function fetchCreativesByDomain(
  domain: string,
  options: FetchCreativesOptions = {},
): Promise<GoogleAdsFetchResult | GoogleAdsUnavailable> {
  const maxCreatives = options.maxCreatives ?? 200;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  const collected: GoogleAdsCreative[] = [];
  let pageToken: string | null = null;
  let isFirstPage = true;

  while (collected.length < maxCreatives) {
    if (!isFirstPage) {
      await sleep(INTER_PAGE_DELAY_MS, now);
    }
    isFirstPage = false;

    const page = await fetchPage(domain, pageToken, fetchImpl);
    if ("unavailable" in page) {
      return page;
    }

    for (const raw of page.creatives) {
      if (collected.length >= maxCreatives) break;
      const creative = normalizeCreative(raw);
      if (creative) collected.push(creative);
    }

    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  const truncated = collected.length >= maxCreatives && pageToken !== null;
  return { creatives: collected, truncated };
}
