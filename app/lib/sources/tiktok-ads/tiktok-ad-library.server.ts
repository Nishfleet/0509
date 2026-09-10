import type { AppEnv } from "~/lib/env.server";
import { reserveDecodoBudget } from "~/lib/decodo-budget.server";
import type { JsonRecord } from "~/lib/data/helpers.server";

/**
 * TikTok Commercial Content Library (library.tiktok.com, EU DSA transparency)
 * scraper via Decodo universal render (#2194).
 *
 * TikTok has no public API. The rendered web page works through Decodo
 * universal with JS rendering. We scrape it weekly per competitor, capped at
 * 800 JS requests/month by the Decodo budget counter. ONE attempt, 90s
 * timeout, standard proxy pool only — no premium pool, no retries, no
 * detail-page fetches.
 */

export interface TiktokAd {
  adId: string;
  advertiser: string;
  firstShown: string; // MM/DD/YYYY
  lastShown: string; // MM/DD/YYYY
  uniqueUsers: string; // raw text ("12345" or "-")
  thumbnail: string | null;
}

export interface TiktokLibraryParse {
  /** Total ads count from the "Total ads: <n>" header, or null when absent. */
  totalAds: number | null;
  ads: TiktokAd[];
}

export type TiktokRenderResult =
  | { html: string }
  | { unavailable: true; reason: "quota" | "decodo_error"; status?: number };

export type TiktokResolveResult =
  | { legalName: string; candidates: string[] }
  | { unavailable: true; reason: string };

export type TiktokFetchAdsResult =
  | { ads: TiktokAd[]; totalAds: number }
  | { unavailable: true; reason: string };

const DECODO_SCRAPE_URL = "https://scraper-api.decodo.com/v2/scrape";
const TIKTOK_LIBRARY_BASE = "https://library.tiktok.com/ads";
const RENDER_TIMEOUT_MS = 90_000;

/**
 * Normalize a name for the "contains" match: lowercase, trim, collapse
 * whitespace, strip punctuation.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the rendered HTML string from a Decodo universal `headless:"html"`
 * response. Decodo returns `{ ... "content": { "html": "<rendered html>" } }`,
 * but the exact shape is not guaranteed — parse defensively: look for an `html`
 * string under `content` or at top level, fall back to stringifying.
 */
function extractHtml(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object") {
    const content = (body as JsonRecord).content;
    if (content && typeof content === "object") {
      const html = (content as JsonRecord).html;
      if (typeof html === "string") {
        return html;
      }
    }
    const topHtml = (body as JsonRecord).html;
    if (typeof topHtml === "string") {
      return topHtml;
    }
  }
  return String(body ?? "");
}

function buildLibraryUrl(params: {
  advName: string;
  queryType: 1 | 2;
  now: Date;
}): string {
  const end = params.now.getTime();
  const u = new URL(TIKTOK_LIBRARY_BASE);
  u.searchParams.set("region", "all");
  u.searchParams.set("start_time", "1735689600000");
  u.searchParams.set("end_time", String(end));
  u.searchParams.set("adv_name", params.advName);
  u.searchParams.set("query_type", String(params.queryType));
  u.searchParams.set("sort_type", "last_shown_date,desc");
  return u.toString();
}

/**
 * Render one TikTok Commercial Content Library page via Decodo universal.
 * Reserves a JS-budget slot BEFORE the request; on deny returns
 * `{ unavailable: true, reason: "quota" }` WITHOUT making the request. ONE
 * attempt, 90s timeout. Non-200 → `decodo_error`; HTTP 613 → `quota`.
 */
export async function renderTiktokLibrary(
  env: AppEnv,
  options: { queryType: 1 | 2; advName: string; now?: Date },
): Promise<TiktokRenderResult> {
  const reservation = await reserveDecodoBudget(env, "js");
  if (!reservation.ok) {
    return { unavailable: true, reason: "quota" };
  }

  const now = options.now ?? new Date();
  const url = buildLibraryUrl({
    advName: options.advName,
    queryType: options.queryType,
    now,
  });

  const auth = env.DECODO_SCRAPER_AUTH;
  const body = JSON.stringify({
    target: "universal",
    url,
    headless: "html",
    proxy_pool: "standard",
    geo: "Germany",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(DECODO_SCRAPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Basic ${auth}` } : {}),
      },
      body,
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return { unavailable: true, reason: "decodo_error" };
  }
  clearTimeout(timer);

  if (response.status === 613) {
    return { unavailable: true, reason: "quota" };
  }
  if (!response.ok) {
    return { unavailable: true, reason: "decodo_error", status: response.status };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { unavailable: true, reason: "decodo_error" };
  }

  // Decodo may surface a 613 inside a 200 body as a status field.
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as JsonRecord).status === 613
  ) {
    return { unavailable: true, reason: "quota" };
  }

  const html = extractHtml(parsed);
  return { html };
}

/**
 * Parse the rendered TikTok Commercial Content Library HTML. Pure and
 * unit-testable from fixtures. Extracts `totalAds` from the "Total ads: <n>"
 * header and the card list. Each card: `{ adId, advertiser, firstShown,
 * lastShown, uniqueUsers, thumbnail }`. adId from the `ad_id=<digits>` in the
 * detail link. Dates as MM/DD/YYYY strings.
 */
export function parseTiktokLibraryHtml(html: string): TiktokLibraryParse {
  const totalAds = extractTotalAds(html);
  const ads = extractCards(html);
  return { totalAds, ads };
}

function extractTotalAds(html: string): number | null {
  const match = html.match(/Total\s+ads:\s*(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract cards. A card is a block containing an `ad_id=<digits>` detail link
 * plus the per-card text (`First shown:`, `Last shown:`, `Unique users seen:`).
 * We split on the detail-link anchor and parse each card's surrounding text.
 */
function extractCards(html: string): TiktokAd[] {
  const ads: TiktokAd[] = [];
  const linkRe = /ad_id=(\d+)/g;
  const positions: Array<{ adId: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    positions.push({ adId: m[1], index: m.index });
  }
  if (positions.length === 0) return ads;

  for (let i = 0; i < positions.length; i++) {
    const { adId, index } = positions[i];
    const next = i + 1 < positions.length ? positions[i + 1].index : html.length;
    const block = html.slice(index, next);
    ads.push(parseCard(adId, block));
  }
  return ads;
}

function parseCard(adId: string, block: string): TiktokAd {
  const advertiser = extractAdvertiser(block);
  const firstShown = extractDate(block, "First shown");
  const lastShown = extractDate(block, "Last shown");
  const uniqueUsers = extractUniqueUsers(block);
  const thumbnail = extractThumbnail(block);
  return {
    adId,
    advertiser,
    firstShown,
    lastShown,
    uniqueUsers,
    thumbnail,
  };
}

function extractAdvertiser(block: string): string {
  // The card block starts at the `ad_id=<digits>` match, which is mid-anchor:
  //   ...<a href="/ads/detail/?ad_id=100000000001">Ad NEW BALANCE ... LIMITED</a>...
  // so the `<a` opener is before the block. Extract the anchor text between
  // the first `>` after the ad_id and the closing `</a>`.
  const anchorTextMatch = block.match(/ad_id=\d+[^>]*>([^<]*)<\/a>/i);
  if (anchorTextMatch) {
    const text = anchorTextMatch[1].replace(/\s+/g, " ").trim();
    return text.replace(/^Ad\s+/i, "").trim();
  }
  // Fall back to a full anchor match (when the block contains the whole anchor).
  const fullAnchorMatch = block.match(/<a[^>]*>([^<]*)<\/a>/i);
  if (fullAnchorMatch) {
    const text = fullAnchorMatch[1].replace(/\s+/g, " ").trim();
    return text.replace(/^Ad\s+/i, "").trim();
  }
  // Fall back to the first "Ad <name>" text in the block.
  const adTextMatch = block.match(/Ad\s+(.+?)(?:\s+First shown)/is);
  if (adTextMatch) {
    return adTextMatch[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

function extractDate(block: string, label: string): string {
  const re = new RegExp(`${label}\\s*:\\s*(\\d{2}/\\d{2}/\\d{4})`, "i");
  const m = block.match(re);
  return m ? m[1] : "";
}

function extractUniqueUsers(block: string): string {
  const m = block.match(/Unique\s+users\s+seen:\s*([^\s<]+)/i);
  return m ? m[1] : "-";
}

function extractThumbnail(block: string): string | null {
  const m = block.match(/<img[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/**
 * Resolve the exact legal advertiser name for a competitor via ONE
 * query_type=1 (keyword) render. Collect distinct advertiser names from cards
 * whose normalized form contains the competitor's normalized name. Pick the
 * candidate with the most cards on the resolve render (tie: first in card
 * order). If no card's advertiser contains the competitor name →
 * `{ unavailable: true, reason: "no_match" }`.
 */
export async function resolveAdvertiser(
  env: AppEnv,
  competitorName: string,
): Promise<TiktokResolveResult> {
  const render = await renderTiktokLibrary(env, {
    queryType: 1,
    advName: competitorName,
  });
  if ("unavailable" in render) {
    return render;
  }
  const parsed = parseTiktokLibraryHtml(render.html);
  if (parsed.ads.length === 0) {
    return { unavailable: true, reason: "no_match" };
  }

  const target = normalizeName(competitorName);
  if (!target) {
    return { unavailable: true, reason: "no_match" };
  }

  // Count cards per candidate advertiser whose normalized name contains the
  // competitor's normalized name. Preserve first-seen order for tie-breaking.
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const ad of parsed.ads) {
    const norm = normalizeName(ad.advertiser);
    if (!norm) continue;
    if (!norm.includes(target)) continue;
    const existing = counts.get(ad.advertiser);
    if (existing === undefined) {
      counts.set(ad.advertiser, 1);
      order.push(ad.advertiser);
    } else {
      counts.set(ad.advertiser, existing + 1);
    }
  }

  if (order.length === 0) {
    return { unavailable: true, reason: "no_match" };
  }

  let best = order[0];
  let bestCount = counts.get(best) ?? 0;
  for (const name of order) {
    const c = counts.get(name) ?? 0;
    if (c > bestCount) {
      best = name;
      bestCount = c;
    }
  }

  return { legalName: best, candidates: order };
}

/**
 * Fetch ads for an exact legal advertiser name via ONE query_type=2 render.
 * Parses the 12 cards (newest by last shown first). Unavailable when: Decodo
 * 613, non-200, OR zero cards with no "Total ads" header (parse break, NOT
 * "no ads"). If "Total ads: 0" header present with zero cards → real zero:
 * returns `{ ads: [], totalAds: 0 }` (NOT unavailable). ONE attempt, 90s.
 */
export async function fetchAds(
  env: AppEnv,
  legalName: string,
): Promise<TiktokFetchAdsResult> {
  const render = await renderTiktokLibrary(env, {
    queryType: 2,
    advName: legalName,
  });
  if ("unavailable" in render) {
    return render;
  }
  const parsed = parseTiktokLibraryHtml(render.html);

  if (parsed.ads.length === 0) {
    if (parsed.totalAds === null) {
      // Zero cards AND no "Total ads" header → parse break (unavailable).
      return { unavailable: true, reason: "parse_break" };
    }
    // "Total ads: 0" (or any finite n) header present with zero cards → real zero.
    return { ads: [], totalAds: parsed.totalAds };
  }

  return { ads: parsed.ads, totalAds: parsed.totalAds ?? parsed.ads.length };
}
