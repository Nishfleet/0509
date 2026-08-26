#!/usr/bin/env node
// Live verification script for BET 2 — "The preview never dead-ends"
// (transformation roadmap §3.4, issue #973).
//
// Probes production /search?website=<domain> for the BET 2 25-domain set plus
// the §1.8 six-domain rerun. Records, per domain:
//
//   - http status, body bytes, time to first card byte in the body
//   - row count, tier counts (verified / likely / unmatched)
//   - results panel source/cache-status/empty-reason (so a `demo`-sourced run
//     against the local server is detected as SKIP, never silently green)
//   - whether the SSR rendering was a warming state (Search in progress /
//     Checking this competitor) — those rows then poll up to the
//     warming-budget cap to land the first card before timing out
//
// Aggregates the 25-domain set into:
//   - dead-end count: domains with `rowCount == 0 && !isWarming` after the
//     warming poll budget is exhausted
//   - verified-row share: `domainsWithVerified > 0 / total`
//   - p95 time-to-first-card across domains that ever produced a card
//
// The script is the proof artifact for issue #973, and it is also the run
// that the orchestrator can replay after each future release to keep BET 2
// honest (the existing canaries check provider readiness; this one checks
// the customer-facing first-value outcome).

import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "https://0509.io";
export const DEFAULT_USER_AGENT = "0509-bet2-live-verification/1.0";

// 25 well-known advertiser domains, mixed US/EU/IN, DTC + B2B.
// Replaces any hard-coded "domain A → brand" assumption so the script keeps
// measuring BET 2 outcomes as the brand mix shifts.
export const BET2_DOMAINS = Object.freeze([
  // DTC US
  "gymshark.com",
  "allbirds.com",
  "ridge.com",
  "oura.com",
  "bombas.com",
  // DTC EU
  "oatly.com",
  "hugo-boss.com",
  "decathlon.com",
  // DTC IN
  "mamaearth.com",
  "lenskart.com",
  "nykaa.com",
  "sugarcosmetics.com",
  "mcaffeine.com",
  // B2B US
  "hubspot.com",
  "notion.so",
  "figma.com",
  "slack.com",
  "mailchimp.com",
  // B2B EU
  "celonis.com",
  "personio.com",
  "allianz.com",
  // B2B IN
  "freshworks.com",
  "zoho.com",
  "tcs.com",
  "reliance.com",
]);

// §1.8 six-domain rerun (category-research.md, 2026-08-25). The three
// originally-dead-end brands (allbirds / notion / oura) MUST be non-empty
// after the three-tier model shipped in #950.
export const SECTION_1_8_RERUN = Object.freeze([
  "gymshark.com",
  "hubspot.com",
  "mamaearth.com",
  "ridge.com",
  "allbirds.com",
  "notion.so",
  "oura.com",
]);

// BET 2 (#951) streams progress via client-side warming polls every 2 s.
// This script cannot copy that cadence: anonymous /search is 20 requests
// per 10 minutes per IP, and 2 s polls would burn the budget on one cold
// domain. The loader already serves partial cache rows on the first SSR
// hit once #951 has written them, so a populated warming page is a first
// card. Empty warming pages retry at the same 35 s floor as new domains,
// twice, then count as a dead-end.
export const SEARCH_WARMING_POLL_INTERVAL_MS = 35_000;
export const SEARCH_WARMING_POLL_LIMIT = 2;
export const SEARCH_WARMING_TOTAL_BUDGET_MS =
  SEARCH_WARMING_POLL_INTERVAL_MS * SEARCH_WARMING_POLL_LIMIT;

// Anonymous /search is 20 requests per 10 minutes per IP (see
// enforcePublicSearchRateLimit). Domain-start spacing is NOT enough: a
// warming poll is a second request, and 24 requests in 14 minutes 429s
// the tail of the 25-set. Every HTTP call goes through createPacedFetch
// so the window includes those polls. Inter-domain spacing defaults to 0.
export const SEARCH_RATE_LIMIT_MAX = 20;
export const SEARCH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const SEARCH_429_RETRY_LIMIT = 3;
export const SEARCH_429_DEFAULT_WAIT_MS = 60_000;
export const DEFAULT_REQUEST_SPACING_MS = 0;

const WARMING_HEADLINE_PATTERNS = Object.freeze([
  /Checking this competitor/i,
  /Search in progress/i,
  /Search preview is temporarily unavailable/i,
  /Keep checking this competitor/i,
]);

const EMPTY_HEADLINE_PATTERNS = Object.freeze([
  /^No verified ads found for /i,
  /^No ads found for this competitor/i,
  /^No verified ads for [^—]*$/i,
]);

/**
 * @typedef {Object} ParsedHtml
 * @property {number} rowCount
 * @property {{ verified: number; likely: number; unmatched: number }} tierCounts
 * @property {string | null} headline
 * @property {boolean} isWarming
 * @property {string | null} emptyReason
 * @property {string | null} cacheStatus
 * @property {string | null} resultSource
 * @property {number} firstRowIndex
 * @property {number[]} likelyRowIndices
 * @property {number[]} unmatchedRowIndices
 */

/**
 * @typedef {Object} ProbeResult
 * @property {string} domain
 * @property {string} url
 * @property {"verified" | "dead_end" | "warming" | "rate_limited" | "error" | "demo_sourced"} outcome
 * @property {number | null} status
 * @property {number} polls
 * @property {number | null} firstCardAtMs
 * @property {number} elapsedMs
 * @property {number} [bodyBytes]
 * @property {string | null} [retryAfter]
 * @property {string} [requestErrorMs]
 * @property {{ verified: number; likely: number; unmatched: number }} tierCounts
 * @property {number} rowCount
 * @property {string | null} headline
 * @property {boolean} isWarming
 * @property {boolean} isDeadEnd
 * @property {string | null} resultSource
 * @property {string | null} cacheStatus
 * @property {string | null} emptyReason
 * @property {Record<string, string>} [responseHeaders]
 */

/**
 * @typedef {Object} Summary
 * @property {number} total
 * @property {number} deadEnds
 * @property {number} verifiedDomains
 * @property {number} verifiedShare
 * @property {number | null} p95FirstCard
 * @property {number} warmingDomains
 * @property {number} errorDomains
 * @property {number} rateLimitedDomains
 * @property {number} [demoSourcedDomains]
 * @property {number} totalRowCount
 */

/**
 * @typedef {Object} RunResult
 * @property {string} baseUrl
 * @property {ProbeResult[]} results
 * @property {Summary} summary
 */

/**
 * @param {string} html
 * @returns {ParsedHtml}
 */
export function parseSearchResponseHtml(html) {
  // Avoid matching the parent `<ol class="f9-wk-rows ...">` container by
  // requiring one of the legal CSS-attribute terminators (space, quote,
  // closing `>`) immediately after `f9-wk-row`. The parent container is
  // `f9-wk-rows` (with the trailing `s`), so this anchor is safe.
  const rowRegex = /class="f9-wk-row[ ">\s]/g;
  const sayRegex = /<span class="f9-wk-say">(Verified|Likely|Unmatched) — /g;
  const firstRowMatch = html.match(/class="f9-wk-row[ ">\s]/);
  const firstRowIndex = firstRowMatch ? firstRowMatch.index ?? -1 : -1;
  const rowCount = (html.match(rowRegex) ?? []).length;
  const likelyRowIndices = [];
  const unmatchedRowIndices = [];
  let verifiedCount = 0;
  let likelyCount = 0;
  let unmatchedCount = 0;
  for (const sayMatch of html.matchAll(sayRegex)) {
    const tier = sayMatch[1];
    const offset = sayMatch.index ?? 0;
    if (tier === "Likely") {
      likelyCount += 1;
      likelyRowIndices.push(offset);
    } else if (tier === "Unmatched") {
      unmatchedCount += 1;
      unmatchedRowIndices.push(offset);
    }
    // `Verified` rows render WITHOUT a tier prefix (formatResultTierLabel
    // returns null for verified rows), so the regex above does not match
    // them at all. Their count is rowCount - likelyCount - unmatchedCount.
  }
  verifiedCount = Math.max(0, rowCount - likelyCount - unmatchedCount);

  // The section heading is the strongest signal for warming vs empty vs
  // populated. Pull the first match inside the results panel (skip the
  // "Keep this competitor under watch" heading that lives below the panel).
  const headlineMatches = [
    ...html.matchAll(/<h2 class="f9-wk-sec-title">([^<]+)<\/h2>/g),
  ];
  const headline =
    headlineMatches.length > 0
      ? String(headlineMatches[0][1]).trim()
      : null;

  const isWarming =
    !!headline && WARMING_HEADLINE_PATTERNS.some((re) => re.test(headline));

  const emptyReasonMatch = html.match(
    /data-f9-result-empty-reason="([^"]*)"/,
  );
  const emptyReason = emptyReasonMatch ? emptyReasonMatch[1] : null;

  const cacheStatusMatch = html.match(
    /data-f9-result-cache-status="([^"]*)"/,
  );
  const cacheStatus = cacheStatusMatch ? cacheStatusMatch[1] : null;

  const sourceMatch = html.match(/data-f9-result-source="([^"]*)"/);
  const resultSource = sourceMatch ? sourceMatch[1] : null;

  return {
    rowCount,
    tierCounts: {
      verified: verifiedCount,
      likely: likelyCount,
      unmatched: unmatchedCount,
    },
    headline,
    isWarming,
    emptyReason,
    cacheStatus,
    resultSource,
    firstRowIndex,
    likelyRowIndices,
    unmatchedRowIndices,
  };
}

/**
 * @param {{
 *   parsed: ReturnType<typeof parseSearchResponseHtml>,
 * }} input
 * @returns {boolean}
 */
export function isDeadEnd({ parsed }) {
  if (parsed.isWarming && parsed.rowCount === 0) return false;
  return parsed.rowCount === 0;
}

/**
 * Parse a Retry-After header to milliseconds. Falls back to `fallbackMs`
 * when the header is missing or unparseable. Caps at the 10-minute search
 * window so a bogus header cannot stall the canary for hours.
 * @param {string | null} header
 * @param {number} [fallbackMs]
 */
export function parseRetryAfterMs(header, fallbackMs = SEARCH_429_DEFAULT_WAIT_MS) {
  const capMs = SEARCH_RATE_LIMIT_WINDOW_MS;
  if (!header) return Math.min(fallbackMs, capMs);
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, capMs);
  }
  const when = Date.parse(trimmed);
  if (Number.isFinite(when)) {
    return Math.min(Math.max(0, when - Date.now()), capMs);
  }
  return Math.min(fallbackMs, capMs);
}

/**
 * Wrap `fetchImpl` so concurrent callers never issue more than
 * `maxRequests` inside any `windowMs` sliding window.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   maxRequests?: number,
 *   windowMs?: number,
 * }} [input]
 * @returns {typeof fetch}
 */
/**
 * Sliding-window limiter for the anonymous /search budget. `acquire()`
 * waits until a slot is free; callers time first-card AFTER this returns
 * so queueing is not counted as product latency.
 * @param {{
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   maxRequests?: number,
 *   windowMs?: number,
 * }} [input]
 */
export function createRateLimiter({
  sleepImpl = defaultSleep,
  nowImpl = () => Date.now(),
  maxRequests = SEARCH_RATE_LIMIT_MAX,
  windowMs = SEARCH_RATE_LIMIT_WINDOW_MS,
} = {}) {
  /** @type {number[]} */
  const stamps = [];
  return {
    async acquire() {
      for (;;) {
        const now = nowImpl();
        while (stamps.length > 0 && now - stamps[0] >= windowMs) {
          stamps.shift();
        }
        if (stamps.length < maxRequests) {
          stamps.push(now);
          return;
        }
        const waitMs = Math.max(25, windowMs - (now - stamps[0]) + 25);
        await sleepImpl(waitMs);
      }
    },
  };
}

/**
 * Wrap `fetchImpl` so concurrent callers never issue more than
 * `maxRequests` inside any `windowMs` sliding window.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   maxRequests?: number,
 *   windowMs?: number,
 * }} [input]
 * @returns {typeof fetch}
 */
export function createPacedFetch({
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  nowImpl = () => Date.now(),
  maxRequests = SEARCH_RATE_LIMIT_MAX,
  windowMs = SEARCH_RATE_LIMIT_WINDOW_MS,
} = {}) {
  const limiter = createRateLimiter({
    sleepImpl,
    nowImpl,
    maxRequests,
    windowMs,
  });
  return async function pacedFetch(input, init) {
    await limiter.acquire();
    return fetchImpl(input, init);
  };
}

/**
 * Compute the p95 of `samples` in milliseconds. Returns null when no samples.
 * @param {number[]} samples
 */
export function percentile95(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  const clamped = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[clamped];
}

/**
 * @param {ProbeResult[]} results
 * @returns {Summary}
 */
export function summarizeResults(results) {
  const total = results.length;
  const deadEnds = results.filter((r) => r.isDeadEnd).length;
  const verifiedDomains = results.filter((r) => r.tierCounts.verified > 0).length;
  const verifiedShare = total === 0 ? 0 : verifiedDomains / total;
  const firstCardSamples = /** @type {number[]} */ (
    results
      .filter((r) => r.firstCardAtMs !== null && r.status === 200)
      .map((r) => r.firstCardAtMs)
  );
  const p95FirstCard = percentile95(firstCardSamples);
  const warmingDomains = results.filter((r) => r.outcome === "warming").length;
  const errorDomains = results.filter((r) => r.outcome === "error").length;
  const rateLimitedDomains = results.filter(
    (r) => r.outcome === "rate_limited",
  ).length;
  const demoSourcedDomains = results.filter(
    (r) => r.outcome === "demo_sourced",
  ).length;
  const totalRowCount = results.reduce(
    (sum, r) => sum + r.tierCounts.verified + r.tierCounts.likely + r.tierCounts.unmatched,
    0,
  );
  return {
    total,
    deadEnds,
    verifiedDomains,
    verifiedShare,
    p95FirstCard,
    warmingDomains,
    errorDomains,
    rateLimitedDomains,
    demoSourcedDomains,
    totalRowCount,
  };
}

/**
 * @param {{ baseUrl: string, domain: string }} input
 */
function buildSearchUrl({ baseUrl, domain }) {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("website", domain);
  return url;
}

/**
 * Stream the response body and find the first byte position where a row
 * appears, OR the full body for full parsing. Yields the byte position of
 * the first row so the caller can compute time-to-first-card.
 *
 * @param {Response} response
 * @param {() => number} [nowImpl]
 * @returns {Promise<{ html: string, firstRowAt: number | null, firstRowSeenAt: number | null }>}
 */
async function readBodyAndFindFirstRow(response, nowImpl = () => Date.now()) {
  if (!response.body) {
    const html = await response.text();
    const parsed = parseSearchResponseHtml(html);
    const hasRow = parsed.firstRowIndex >= 0;
    return {
      html,
      firstRowAt: hasRow ? parsed.firstRowIndex : null,
      firstRowSeenAt: hasRow ? nowImpl() : null,
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let html = "";
  let firstRowAt = null;
  let firstRowSeenAt = null;
  // 32 KB chunks keep memory bounded for the largest responses (~135 KB
  // for nykaa.com) while letting us catch the first card early.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunkStr = decoder.decode(value, { stream: true });
    const chunkStart = html.length;
    html += chunkStr;
    if (firstRowSeenAt === null) {
      // Only scan the newly appended chunk for the first row marker; the
      // terminator class (space / quote / `>`) avoids the
      // `class="f9-wk-rows"` parent list container.
      const found = chunkStr.search(/class="f9-wk-row[ ">\s]/);
      if (found !== -1) {
        firstRowAt = chunkStart + found;
        firstRowSeenAt = nowImpl();
      }
    }
  }
  // Flush the decoder for any trailing bytes (rare for utf-8 but spec-clean).
  html += decoder.decode();
  if (firstRowSeenAt === null) {
    const scan = html.search(/class="f9-wk-row[ ">\s]/);
    if (scan !== -1) {
      firstRowAt = scan;
      firstRowSeenAt = nowImpl();
    }
  }
  return { html, firstRowAt, firstRowSeenAt };
}

/**
 * @param {{
 *   domain: string,
 *   baseUrl: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   userAgent?: string,
 *   requestTimeoutMs?: number,
 *   warmingBudgetMs?: number,
 *   warmingPollIntervalMs?: number,
 *   max429Retries?: number,
 *   beforeRequest?: () => Promise<void> | void,
 * }} input
 * @returns {Promise<ProbeResult>}
 */
export async function probeDomain({
  domain,
  baseUrl,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  nowImpl = () => Date.now(),
  userAgent = DEFAULT_USER_AGENT,
  requestTimeoutMs = 30_000,
  warmingBudgetMs = SEARCH_WARMING_TOTAL_BUDGET_MS,
  warmingPollIntervalMs = SEARCH_WARMING_POLL_INTERVAL_MS,
  max429Retries = SEARCH_429_RETRY_LIMIT,
  beforeRequest,
}) {
  const url = buildSearchUrl({ baseUrl, domain });
  let polls = 0;
  let firstCardAtMs = null;
  let lastParsed = null;
  let lastStatus = null;
  let lastResponseHeaders = null;
  let rateLimitHits = 0;
  // Set on the first non-429 attempt so pacer queue time and 429 backoff
  // are not counted as time-to-first-card. Warming polls keep this value
  // so the 35s wait IS counted (that wait is what the visitor sees).
  let requestStart = null;

  while (true) {
    let response;
    try {
      await beforeRequest?.();
      if (requestStart === null) requestStart = nowImpl();
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "user-agent": userAgent,
          "cache-control": "no-cache",
          pragma: "no-cache",
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      return {
        domain,
        url: url.toString(),
        outcome: "error",
        status: null,
        polls,
        firstCardAtMs: null,
        elapsedMs: nowImpl() - (requestStart ?? nowImpl()),
        requestErrorMs:
          error instanceof Error ? error.message : String(error),
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        rowCount: 0,
        headline: null,
        isWarming: false,
        isDeadEnd: true,
        resultSource: null,
        cacheStatus: null,
        emptyReason: null,
      };
    }
    lastStatus = response.status;
    lastResponseHeaders = Object.fromEntries(response.headers.entries());
    if (response.status === 429) {
      rateLimitHits += 1;
      const retryAfterHeader = response.headers.get("retry-after");
      await response.text();
      if (rateLimitHits > max429Retries) {
        return {
          domain,
          url: url.toString(),
          outcome: "rate_limited",
          status: 429,
          polls,
          firstCardAtMs: null,
          elapsedMs: nowImpl() - (requestStart ?? nowImpl()),
          retryAfter: retryAfterHeader,
          tierCounts: { verified: 0, likely: 0, unmatched: 0 },
          rowCount: 0,
          headline: null,
          isWarming: false,
          isDeadEnd: true,
          resultSource: null,
          cacheStatus: null,
          emptyReason: null,
        };
      }
      requestStart = null;
      await sleepImpl(parseRetryAfterMs(retryAfterHeader));
      continue;
    }
    if (response.status >= 400) {
      const body = await response.text();
      return {
        domain,
        url: url.toString(),
        outcome: "error",
        status: response.status,
        polls,
        firstCardAtMs: null,
        elapsedMs: nowImpl() - (requestStart ?? nowImpl()),
        bodyBytes: body.length,
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        rowCount: 0,
        headline: null,
        isWarming: false,
        isDeadEnd: true,
        resultSource: null,
        cacheStatus: null,
        emptyReason: null,
      };
    }
    const { html, firstRowSeenAt } = await readBodyAndFindFirstRow(
      response,
      nowImpl,
    );
    const parsed = parseSearchResponseHtml(html);
    lastParsed = parsed;
    if (firstRowSeenAt !== null && firstCardAtMs === null) {
      // Wall-clock from the original request, not HTML byte offset. Adding
      // `firstRowAt` (a character index) used to report gymshark at ~15 s
      // on a 1.8 s cache hit.
      firstCardAtMs = Math.max(0, firstRowSeenAt - (requestStart ?? firstRowSeenAt));
    }
    // A warming page that already has rows is the #951 first card. Stop.
    // Keep polling only while the page is empty and still warming.
    const isFinalPass = !parsed.isWarming || parsed.rowCount > 0;
    if (isFinalPass) {
      const elapsedMs = nowImpl() - (requestStart ?? nowImpl());
      const isDeadEnd = parsed.rowCount === 0;
      return {
        domain,
        url: url.toString(),
        outcome:
          parsed.resultSource === "demo"
            ? "demo_sourced"
            : isDeadEnd
              ? "dead_end"
              : "verified",
        status: response.status,
        polls: polls + 1,
        firstCardAtMs,
        elapsedMs,
        bodyBytes: html.length,
        tierCounts: parsed.tierCounts,
        rowCount: parsed.rowCount,
        headline: parsed.headline,
        isWarming: false,
        isDeadEnd,
        resultSource: parsed.resultSource,
        cacheStatus: parsed.cacheStatus,
        emptyReason: parsed.emptyReason,
        responseHeaders: lastResponseHeaders,
      };
    }
    polls += 1;
    if (nowImpl() - (requestStart ?? nowImpl()) >= warmingBudgetMs) {
      const elapsedMs = nowImpl() - (requestStart ?? nowImpl());
      return {
        domain,
        url: url.toString(),
        outcome: "warming",
        status: response.status,
        polls,
        firstCardAtMs,
        elapsedMs,
        bodyBytes: html.length,
        tierCounts: parsed.tierCounts,
        rowCount: parsed.rowCount,
        headline: parsed.headline,
        isWarming: true,
        isDeadEnd: parsed.rowCount === 0,
        resultSource: parsed.resultSource,
        cacheStatus: parsed.cacheStatus,
        emptyReason: parsed.emptyReason,
        responseHeaders: lastResponseHeaders,
      };
    }
    await sleepImpl(warmingPollIntervalMs);
  }
}

/**
 * @param {number} ms
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   domains: readonly string[],
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   requestSpacingMs?: number,
 *   userAgent?: string,
 *   nowImpl?: () => number,
 *   warmingBudgetMs?: number,
 *   warmingPollIntervalMs?: number,
 *   onResult?: (probe: ProbeResult, index: number, total: number) => void,
 *   paceRequests?: boolean,
 *   beforeRequest?: () => Promise<void> | void,
 * }} input
 * @returns {Promise<RunResult>}
 */
export async function runLiveVerification({
  domains,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  requestSpacingMs = DEFAULT_REQUEST_SPACING_MS,
  userAgent = DEFAULT_USER_AGENT,
  nowImpl = () => Date.now(),
  warmingBudgetMs = SEARCH_WARMING_TOTAL_BUDGET_MS,
  warmingPollIntervalMs = SEARCH_WARMING_POLL_INTERVAL_MS,
  onResult,
  paceRequests = true,
  beforeRequest,
}) {
  const limiter = paceRequests
    ? createRateLimiter({ sleepImpl, nowImpl })
    : null;
  const resolvedBeforeRequest = beforeRequest
    ?? (limiter ? () => limiter.acquire() : undefined);
  const results = [];
  for (const domain of domains) {
    const probeStartedAt = nowImpl();
    const result = await probeDomain({
      domain,
      baseUrl,
      fetchImpl,
      sleepImpl,
      nowImpl,
      userAgent,
      warmingBudgetMs,
      warmingPollIntervalMs,
      beforeRequest: resolvedBeforeRequest,
    });
    results.push(result);
    onResult?.(result, results.length, domains.length);
    if (requestSpacingMs > 0) {
      const elapsed = nowImpl() - probeStartedAt;
      const wait = Math.max(0, requestSpacingMs - elapsed);
      if (wait > 0) await sleepImpl(wait);
    }
  }
  const summary = summarizeResults(results);
  return { baseUrl, results, summary };
}

/**
 * Verdict logic for the BET 2 termination check. Failures are reported
 * individually so the PR body / CI output names which criterion tripped.
 * @param {Summary} summary
 * @param {{ verifiedShareFloor?: number, p95FirstCardCeilingMs?: number }} [thresholds]
 * @returns {{ pass: boolean, checks: any[] }}
 */
export function evaluateTermination(summary, thresholds = {}) {
  const verifiedShareFloor = thresholds.verifiedShareFloor ?? 0.8;
  const p95FirstCardCeilingMs = thresholds.p95FirstCardCeilingMs ?? 5_000;
  const checks = [
    {
      name: "zero_dead_ends",
      ok: summary.deadEnds === 0,
      observed: summary.deadEnds,
      threshold: 0,
      detail: `dead-end empty states: ${summary.deadEnds}`,
    },
    {
      name: "verified_share_at_or_above_floor",
      ok: summary.verifiedShare >= verifiedShareFloor,
      observed: Number(summary.verifiedShare.toFixed(4)),
      threshold: verifiedShareFloor,
      detail: `verified-row share: ${summary.verifiedDomains}/${summary.total} (${(summary.verifiedShare * 100).toFixed(1)}%)`,
    },
    {
      name: "p95_first_card_at_or_below_ceiling",
      ok:
        summary.p95FirstCard === null
          ? false
          : summary.p95FirstCard <= p95FirstCardCeilingMs,
      observed:
        summary.p95FirstCard === null ? "no_samples" : summary.p95FirstCard,
      threshold: p95FirstCardCeilingMs,
      detail:
        summary.p95FirstCard === null
          ? "no first-card samples (every probe was warming or error)"
          : `p95 time-to-first-card: ${summary.p95FirstCard.toFixed(0)} ms`,
    },
    {
      name: "no_rate_limit_blocks",
      ok: summary.rateLimitedDomains === 0,
      observed: summary.rateLimitedDomains,
      threshold: 0,
      detail: `rate-limited probes: ${summary.rateLimitedDomains}`,
    },
    {
      name: "no_error_probes",
      ok: summary.errorDomains === 0,
      observed: summary.errorDomains,
      threshold: 0,
      detail: `errored probes: ${summary.errorDomains}`,
    },
    {
      name: "no_demo_sourced_probes",
      ok: (summary.demoSourcedDomains ?? 0) === 0,
      observed: summary.demoSourcedDomains ?? 0,
      threshold: 0,
      detail: `demo-sourced probes: ${summary.demoSourcedDomains ?? 0}`,
    },
  ];
  return {
    pass: checks.every((check) => check.ok),
    checks,
  };
}

const SECTION_1_8_MUST_BE_NONEMPTY = Object.freeze([
  "allbirds.com",
  "notion.so",
  "oura.com",
]);

/**
 * The §1.8 rerun is a separate termination check: allbirds / notion / oura
 * must render at least one row. Passing the 25-domain aggregates without
 * this check would let those three stay empty.
 * @param {ProbeResult[]} results
 * @returns {{ pass: boolean, checks: any[] }}
 */
export function evaluateSection18Rerun(results) {
  const missing = SECTION_1_8_MUST_BE_NONEMPTY.filter((domain) => {
    const row = results.find((r) => r.domain === domain);
    return !row || row.rowCount === 0;
  });
  const check = {
    name: "section_1_8_allbirds_notion_oura_non_empty",
    ok: missing.length === 0,
    observed: SECTION_1_8_MUST_BE_NONEMPTY.length - missing.length,
    threshold: SECTION_1_8_MUST_BE_NONEMPTY.length,
    detail:
      missing.length === 0
        ? "allbirds/notion/oura non-empty: 3/3"
        : `allbirds/notion/oura empty: ${missing.join(", ")}`,
  };
  return { pass: check.ok, checks: [check] };
}

/**
 * Human-readable rendering of one probe result, plus a JSON dump for the
 * report file. Splitting the renderer from the probe keeps the run loop
 * testable in isolation.
 * @param {ProbeResult} probe
 * @param {number} index
 * @param {number} total
 */
export function formatProbeLine(probe, index, total) {
  const tag =
    probe.outcome === "verified"
      ? "OK "
      : probe.outcome === "dead_end"
        ? "DE "
        : probe.outcome === "warming"
          ? "WRM"
          : probe.outcome === "rate_limited"
            ? "429"
            : probe.outcome === "demo_sourced"
              ? "DEM"
              : "ERR";
  const tierParts = [
    `verified=${probe.tierCounts.verified}`,
    `likely=${probe.tierCounts.likely}`,
    `unmatched=${probe.tierCounts.unmatched}`,
  ];
  const firstCard =
    probe.firstCardAtMs === null ? "  -  " : `${probe.firstCardAtMs.toFixed(0).padStart(5)}ms`;
  return `${tag} [${String(index).padStart(2)}/${total}] ${probe.domain.padEnd(20)} status=${String(probe.status ?? "---")} rows=${String(probe.rowCount).padStart(3)} ${tierParts.join(" ").padEnd(40)} firstCard=${firstCard} cache=${probe.cacheStatus ?? "-"} src=${probe.resultSource ?? "-"}`;
}

/**
 * @param {{ run: RunResult, rerun: RunResult | null }} input
 */
export function formatSummary(input) {
  const { run, rerun } = input;
  const lines = [];
  lines.push(`BET 2 live verification @ ${run.baseUrl}`);
  lines.push("");
  lines.push(`25-domain set (n=${run.summary.total})`);
  lines.push(
    `  dead-ends: ${run.summary.deadEnds} | verified-share: ${(run.summary.verifiedShare * 100).toFixed(1)}% (${run.summary.verifiedDomains}/${run.summary.total})`,
  );
  lines.push(
    `  p95 first-card: ${run.summary.p95FirstCard === null ? "n/a" : `${run.summary.p95FirstCard.toFixed(0)} ms`} | warming: ${run.summary.warmingDomains} | errors: ${run.summary.errorDomains} | rate-limited: ${run.summary.rateLimitedDomains}`,
  );
  lines.push(
    `  total rows observed: ${run.summary.totalRowCount}`,
  );
  if (rerun) {
    lines.push("");
    lines.push(`§1.8 six-domain rerun (n=${rerun.summary.total})`);
    lines.push(
      `  dead-ends: ${rerun.summary.deadEnds} | verified-share: ${(rerun.summary.verifiedShare * 100).toFixed(1)}%`,
    );
    const three = ["allbirds.com", "notion.so", "oura.com"];
    const nonEmpty = three.filter((d) => {
      const r = rerun.results.find((row) => row.domain === d);
      return r && r.rowCount > 0;
    });
    lines.push(
      `  allbirds/notion/oura non-empty: ${nonEmpty.length}/3 (${nonEmpty.join(", ") || "none"})`,
    );
  }
  return lines.join("\n");
}

/**
 * Only fire the live verification when executed directly; importing this
 * module (the coupling test does) must not trigger network calls.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

/**
 * Unbuffered stdout so a piped 20-minute canary is not silent until exit.
 * Node block-buffers stdout when it is not a TTY (the systemd/tee case).
 * @param {string} line
 */
function emitLine(line) {
  writeSync(1, `${line}\n`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl ?? DEFAULT_BASE_URL;
  const spacingMs = args.spacingMs ?? DEFAULT_REQUEST_SPACING_MS;
  const includeRerun = args.includeRerun ?? true;
  emitLine(
    `BET 2 live verification starting @ ${baseUrl} (n=${BET2_DOMAINS.length}${includeRerun ? ` + ${SECTION_1_8_RERUN.length} rerun` : ""}, spacing=${spacingMs}ms)`,
  );
  // One limiter for the 25-set AND the §1.8 HTTP rerun. Acquire happens
  // BEFORE the first-card clock starts, so queue time is not product latency.
  const limiter = createRateLimiter();
  const run = await runLiveVerification({
    domains: BET2_DOMAINS,
    baseUrl,
    paceRequests: false,
    beforeRequest: () => limiter.acquire(),
    requestSpacingMs: spacingMs,
    onResult: (probe, index, total) => {
      emitLine(formatProbeLine(probe, index, total));
    },
  });
  const rerun = includeRerun
    ? await runLiveVerification({
        domains: SECTION_1_8_RERUN,
        baseUrl,
        paceRequests: false,
        beforeRequest: () => limiter.acquire(),
        requestSpacingMs: spacingMs,
        onResult: (probe, index, total) => {
          if (index === 1) {
            emitLine("");
            emitLine("§1.8 six-domain rerun:");
          }
          emitLine(formatProbeLine(probe, index, total));
        },
      })
    : null;
  const verdict = evaluateTermination(run.summary);
  const rerunVerdict = rerun
    ? evaluateSection18Rerun(rerun.results)
    : { pass: true, checks: [] };
  const pass = verdict.pass && rerunVerdict.pass;
  emitLine("");
  emitLine(formatSummary({ run, rerun }));
  emitLine("");
  emitLine("Termination checks:");
  for (const check of [...verdict.checks, ...rerunVerdict.checks]) {
    emitLine(
      `  ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`,
    );
  }
  if (args.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      bet2Set: { results: run.results, summary: run.summary },
      section1_8Rerun: rerun
        ? { results: rerun.results, summary: rerun.summary }
        : null,
      termination: {
        pass,
        checks: [...verdict.checks, ...rerunVerdict.checks],
      },
    };
    emitLine("");
    emitLine("JSON_REPORT_BEGIN");
    emitLine(JSON.stringify(report, null, 2));
    emitLine("JSON_REPORT_END");
  }
  process.exit(pass ? 0 : 1);
}

/**
 * @param {string[]} argv
 * @returns {{ baseUrl?: string, spacingMs?: number, includeRerun?: boolean, json?: boolean }}
 */
function parseCliArgs(argv) {
  /** @type {{ baseUrl?: string, spacingMs?: number, includeRerun?: boolean, json?: boolean }} */
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      parsed.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--spacing-ms" && argv[i + 1]) {
      parsed.spacingMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--skip-rerun") {
      parsed.includeRerun = false;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
  }
  return parsed;
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}