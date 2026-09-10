import type { AppEnv } from "~/lib/env.server";
import type { JsonRecord } from "~/lib/data/helpers.server";

/**
 * LinkedIn Ad Library fetch + parse (#2193).
 *
 * LinkedIn's Ad Library is public but returns 403 to datacenter IPs, so this
 * goes through Decodo's universal target with the standard proxy pool and NO
 * JavaScript rendering (the server-rendered HTML already carries the ad cards).
 *
 * Verified request shape (issue #2193):
 *   POST https://scraper-api.decodo.com/v2/scrape
 *   Authorization: Basic <DECODO_SCRAPER_AUTH>
 *   body: {"target":"universal","url":"https://www.linkedin.com/ad-library/search?accountOwner=<name>&geo=United States","proxy_pool":"standard"}
 *
 * Decodo v2/scrape response:
 *   { "results": [ { "content": "<html>", "status_code": 200, "url": "...", "task_id": "..." } ] }
 * A `status_code` of 613 is Decodo's internal failure code; any non-200 is a
 * failure. The adapter calls the Decodo budget helper BEFORE this request.
 *
 * Page 1 only (start=0): the newest page suffices for change detection. Page
 * size is 25 (the start param); a full page returned 24 cards in verification —
 * do NOT assert a fixed card count. One Decodo request per page, ONE attempt
 * per page, 60s timeout. Detail pages are NOT fetched (N+1 budget); only the
 * detail url is recorded.
 */

const DECODO_SCRAPE_URL = "https://scraper-api.decodo.com/v2/scrape";
const LINKEDIN_AD_LIBRARY_BASE = "https://www.linkedin.com/ad-library/search";
const REQUEST_TIMEOUT_MS = 60_000;
/** Decodo's internal failure status code (issue #2193). */
const DECODO_FAILURE_STATUS = 613;

export interface LinkedInAdCard {
  /** The numeric ad id from the detail link. */
  id: string;
  /** Advertiser display name on the card. */
  advertiser: string;
  /** Promoted text, truncated to ~200 chars. */
  text: string;
  /** Creative image url if present, else null. */
  creativeImageUrl: string | null;
  /** Public detail page url. */
  detailUrl: string;
}

export interface LinkedInAdLibraryResult {
  /** The account owner searched for. */
  accountOwner: string;
  /** Total ads returned after the exact-name filter. */
  totalAds: number;
  /** True when ads were dropped because their advertiser name did not match. */
  ambiguous: boolean;
  /** Normalized ad cards (exact-name matches only). */
  ads: LinkedInAdCard[];
}

export interface LinkedInAdLibraryUnavailable {
  unavailable: true;
  reason: string;
}

export type LinkedInAdLibraryFetchResult = LinkedInAdLibraryResult | LinkedInAdLibraryUnavailable;

export interface FetchAdsByAccountOwnerOptions {
  /** Max ads to return (page size is 25; the newest page suffices). */
  maxAds?: number;
}

/**
 * Fetch page 1 of the LinkedIn Ad Library for an account owner via Decodo and
 * parse the ad cards. Returns a normalized list, or `{ unavailable: true }` on
 * Decodo failure (status 613 / non-200 / zero cards with no "Promoted" text).
 * Does NOT fetch detail pages.
 */
export async function fetchAdsByAccountOwner(
  env: AppEnv,
  accountOwner: string,
  options: FetchAdsByAccountOwnerOptions = {},
): Promise<LinkedInAdLibraryFetchResult> {
  const maxAds = options.maxAds ?? 25;
  const auth = env.DECODO_SCRAPER_AUTH;
  if (!auth) {
    return { unavailable: true, reason: "no_credentials" };
  }

  const searchUrl = buildSearchUrl(accountOwner);
  const body = JSON.stringify({
    target: "universal",
    url: searchUrl,
    proxy_pool: "standard",
  });

  let response: Response;
  try {
    response = await fetch(DECODO_SCRAPE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body,
      // Cloudflare Workers fetch honors AbortSignal for timeouts.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network/timeout — one attempt, no retry.
    return { unavailable: true, reason: "fetch_error" };
  }

  // Decodo API-level HTTP error (401/403/429/500/524) is a failure.
  if (!response.ok) {
    return { unavailable: true, reason: `decodo_http_${response.status}` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { unavailable: true, reason: "decodo_bad_json" };
  }

  const result = extractFirstResult(json);
  if (!result) {
    return { unavailable: true, reason: "decodo_no_result" };
  }

  const statusCode = typeof result.status_code === "number" ? result.status_code : 0;
  if (statusCode === DECODO_FAILURE_STATUS || statusCode !== 200) {
    return { unavailable: true, reason: `decodo_status_${statusCode}` };
  }

  const html = typeof result.content === "string" ? result.content : "";
  if (!html) {
    return { unavailable: true, reason: "decodo_empty_content" };
  }

  const cards = parseAdCards(html);
  // Zero cards with no "Promoted" text is a parse break, not "no ads".
  if (cards.length === 0 && !/promoted/i.test(html)) {
    return { unavailable: true, reason: "parse_break" };
  }

  // Exact case-insensitive advertiser name filter; record ambiguity.
  const wanted = accountOwner.trim().toLowerCase();
  let ambiguous = false;
  const exact: LinkedInAdCard[] = [];
  for (const card of cards) {
    if (card.advertiser.trim().toLowerCase() === wanted) {
      exact.push(card);
    } else {
      ambiguous = true;
    }
  }

  const ads = exact.slice(0, maxAds);
  return {
    accountOwner,
    totalAds: ads.length,
    ambiguous,
    ads,
  };
}

/**
 * Build the LinkedIn Ad Library search url for an account owner, page 1
 * (start=0). `geo=United States` matches the issue's verified request.
 */
function buildSearchUrl(accountOwner: string): string {
  const params = new URLSearchParams({
    accountOwner: accountOwner.trim(),
    geo: "United States",
  });
  return `${LINKEDIN_AD_LIBRARY_BASE}?${params.toString()}`;
}

/**
 * Pull the first result object out of a Decodo v2/scrape response.
 * Shape: `{ results: [ { content, status_code, ... } ] }`.
 */
function extractFirstResult(json: unknown): { content?: unknown; status_code?: unknown } | null {
  if (typeof json !== "object" || json === null) return null;
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  if (typeof first !== "object" || first === null) return null;
  return first as { content?: unknown; status_code?: unknown };
}

/**
 * Parse LinkedIn Ad Library ad cards from the search-page HTML. Each card is
 * anchored by an `ad-library/detail/<id>` link; the advertiser name, promoted
 * text and creative image are extracted from the surrounding card markup.
 *
 * The parser is deliberately tolerant of markup drift: it splits the HTML into
 * card blocks on the detail-link anchor, then regexes each block for the
 * fields. It does not assume a fixed card count.
 */
export function parseAdCards(html: string): LinkedInAdCard[] {
  const cards: LinkedInAdCard[] = [];
  // Match each detail link and capture the id; the card block is the text
  // between this link and the next one (or end of html).
  const linkPattern = /\/ad-library\/detail\/(\d+)/g;
  const positions: Array<{ id: string; start: number; linkEnd: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    positions.push({ id: match[1], start: match.index, linkEnd: match.index + match[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const { id, start } = positions[i];
    const blockEnd = i + 1 < positions.length ? positions[i + 1].start : html.length;
    // The card content (advertiser, promoted text, creative) follows the
    // detail link in the markup, so the block starts AT the link and runs to
    // the next card's link. Starting before the link would bleed the previous
    // card's fields into this one.
    const block = html.slice(start, blockEnd);

    const advertiser = extractAdvertiser(block);
    const text = extractPromotedText(block);
    const creativeImageUrl = extractCreativeImage(block);
    const detailUrl = `https://www.linkedin.com/ad-library/detail/${id}`;

    cards.push({
      id,
      advertiser,
      text,
      creativeImageUrl,
      detailUrl,
    });
  }

  return cards;
}

/** Extract the advertiser display name from a card block. */
function extractAdvertiser(block: string): string {
  // Prefer an explicit advertiser element; fall back to "Paid for by <entity>".
  const el = block.match(/<div[^>]*class="[^"]*advertiser[^"]*"[^>]*>([^<]+)<\/div>/i);
  if (el) return el[1].trim();
  const paid = block.match(/paid for by\s+([^<\n]+)/i);
  if (paid) return paid[1].trim();
  return "";
}

/** Extract the promoted ad text (first ~200 chars) from a card block. */
function extractPromotedText(block: string): string {
  const el = block.match(/<p[^>]*class="[^"]*ad-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  const raw = el ? el[1] : "";
  const text = stripTags(raw).replace(/\s+/g, " ").trim();
  return text.slice(0, 200);
}

/** Extract the creative image url from a card block, if present. */
function extractCreativeImage(block: string): string | null {
  const img = block.match(/<img[^>]*src="([^"]+)"[^>]*>/i);
  return img ? img[1] : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * The normalized snapshot payload the adapter stores. Exported so the adapter
 * and its tests share one shape.
 */
export interface LinkedInAdsSnapshotPayload extends JsonRecord {
  accountOwner: string;
  totalAds: number;
  ambiguous: boolean;
  ads: LinkedInAdCard[];
}
