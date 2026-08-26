#!/usr/bin/env node
// Live verification canary for BET 3 — public Offer Timeline (/timeline/:domain).
// Issue #974. Encodes the §3.4 termination check:
//   For a competitor watched ≥14 days, the timeline renders ≥3 dated offer
//   states with working screenshot links; landing_page_snapshot row count >0
//   and growing daily; a share link to the timeline renders correctly logged
//   out.
// The probe is unauthenticated (logged-out), uses the public brand-page rate
// limit, and HEAD-checks every screenshot / page-text receipt it finds.

import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "https://0509.io";
export const DEFAULT_USER_AGENT = "0509-bet3-live-verification/1.0";

// The five BET 3 flagship demo brands. Kept in sync with
// app/lib/demo-brand-pages.ts, but copied here so the script runs in plain
// Node without a TS build step.
export const DEMO_BRAND_PAGE_DOMAINS = Object.freeze([
  "nike.com",
  "nykaa.com",
  "allbirds.com",
  "lenskart.com",
  "mamaearth.com",
]);

// /timeline/:domain is served under the public-brand-page rate limit scope
// (enforcePublicBrandPageRateLimit): 120 requests per 10-minute window.
export const BRAND_PAGE_RATE_LIMIT_MAX = 120;
export const BRAND_PAGE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const PROOF_SCREENSHOT_PATH_PREFIX = "/artifacts/proof/";
export const PROOF_PAGE_TEXT_PATH_PREFIX = "/artifacts/page-text/";
export const WATCHED_MIN_DAYS = 14;
export const WATCHED_MIN_STATES = 3;

const PROOF_SCREENSHOT_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/**
 * @typedef {Object} ParsedTimelineEntry
 * @property {string} capturedAt
 * @property {string} dateLabel
 * @property {string} headline
 * @property {string[]} receiptLinks
 * @property {string | null} evidenceNote
 */

/**
 * @typedef {Object} ParsedTimelineHtml
 * @property {number} entryCount
 * @property {ParsedTimelineEntry[]} entries
 * @property {string | null} shareUrl
 */

/**
 * @typedef {Object} ReceiptCheck
 * @property {string} url
 * @property {number | null} status
 * @property {string | null} contentType
 * @property {boolean} ok
 * @property {number} elapsedMs
 * @property {string | null} error
 */

/**
 * @typedef {(
 *   | "verified"
 *   | "dead_end"
 *   | "not_found"
 *   | "rate_limited"
 *   | "error"
 * )} ProbeOutcome
 */

/**
 * @typedef {Object} ProbeResult
 * @property {string} domain
 * @property {string} url
 * @property {string} finalUrl
 * @property {ProbeOutcome} outcome
 * @property {number | null} status
 * @property {number} elapsedMs
 * @property {number} entryCount
 * @property {ParsedTimelineEntry[]} entries
 * @property {string | null} shareUrl
 * @property {boolean} sharePresent
 * @property {ReceiptCheck[]} receiptChecks
 * @property {number} workingReceiptCount
 * @property {number} brokenReceiptCount
 * @property {string | null} requestError
 */

/**
 * @typedef {Object} Summary
 * @property {number} total
 * @property {number} verified
 * @property {number} deadEnds
 * @property {number} notFound
 * @property {number} rateLimited
 * @property {number} errors
 * @property {number} sharePresent
 * @property {number} workingReceipts
 * @property {number} brokenReceipts
 * @property {number} totalEntries
 */

/**
 * @typedef {Object} RunResult
 * @property {string} baseUrl
 * @property {ProbeResult[]} results
 * @property {Summary} summary
 */

/**
 * @param {number} ms
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} raw
 * @returns {string}
 */
function stripHtmlTags(raw) {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} classAttr
 * @param {string} token
 * @returns {boolean}
 */
function classIncludes(classAttr, token) {
  return classAttr.split(/\s+/).some((c) => c === token);
}

/**
 * Parse the SSR HTML of a /timeline/:domain response.
 * No DOM dependency: everything is regex/string matching.
 * @param {string} html
 * @returns {ParsedTimelineHtml}
 */
export function parseTimelineHtml(html) {
  const shareMatch = html.match(
    /<input\b[^>]*?id\s*=\s*"offer-timeline-share-url"[^>]*>/i,
  );
  let shareUrl = null;
  if (shareMatch) {
    const valueMatch = shareMatch[0].match(/\bvalue="([^"]*)"/i);
    if (valueMatch) {
      shareUrl = valueMatch[1];
    }
  }

  /** @type {ParsedTimelineEntry[]} */
  const entries = [];
  const entryRegex = /<li\b([^>]*?)\bclass="([^"]*)"([^>]*?)>([\s\S]*?)<\/li>/gi;
  for (const liMatch of html.matchAll(entryRegex)) {
    const classAttr = liMatch[2] ?? "";
    if (!classIncludes(classAttr, "f9-timeline-entry")) {
      continue;
    }
    const block = liMatch[4] ?? "";

    let capturedAt = "";
    let dateLabel = "";
    const timeMatch = block.match(/<time\b([^>]*?)>([\s\S]*?)<\/time>/i);
    if (timeMatch) {
      const timeAttrs = timeMatch[1] ?? "";
      const datetimeMatch = timeAttrs.match(/\b(?:datetime|dateTime)="([^"]*)"/i);
      capturedAt = datetimeMatch?.[1] ?? "";
      dateLabel = stripHtmlTags(timeMatch[2] ?? "");
    }

    let headline = "";
    for (const pMatch of block.matchAll(/<p\b([^>]*?)>([\s\S]*?)<\/p>/gi)) {
      const pClass = pMatch[1]?.match(/\bclass="([^"]*)"/i)?.[1] ?? "";
      if (classIncludes(pClass, "f9-timeline-headline")) {
        headline = stripHtmlTags(pMatch[2] ?? "");
        break;
      }
    }

    /** @type {string[]} */
    const receiptLinks = [];
    /** @type {string | null} */
    let evidenceNote = null;
    for (const pMatch of block.matchAll(/<p\b([^>]*?)>([\s\S]*?)<\/p>/gi)) {
      const pClass = pMatch[1]?.match(/\bclass="([^"]*)"/i)?.[1] ?? "";
      if (!classIncludes(pClass, "f9-timeline-receipts")) {
        continue;
      }
      const pBody = pMatch[2] ?? "";
      if (classIncludes(pClass, "f9-timeline-receipts-note")) {
        evidenceNote = stripHtmlTags(pBody);
        continue;
      }
      for (const aMatch of pBody.matchAll(/<a\b[^>]*?href="([^"]*)"[^>]*?>/gi)) {
        const href = aMatch[1] ?? "";
        if (
          href.startsWith(PROOF_SCREENSHOT_PATH_PREFIX) ||
          href.startsWith(PROOF_PAGE_TEXT_PATH_PREFIX)
        ) {
          receiptLinks.push(href);
        }
      }
      // If no <a> links were found, the text itself is an evidence note.
      if (receiptLinks.length === 0) {
        const text = stripHtmlTags(pBody);
        if (text) evidenceNote = text;
      }
    }

    entries.push({
      capturedAt,
      dateLabel,
      headline,
      receiptLinks,
      evidenceNote,
    });
  }

  return {
    entryCount: entries.length,
    entries,
    shareUrl,
  };
}

/**
 * Build the public Offer Timeline URL for a domain.
 * @param {{ baseUrl: string, domain: string }} input
 * @returns {string}
 */
function buildTimelineUrl({ baseUrl, domain }) {
  return new URL(`/timeline/${domain}`, baseUrl).toString();
}

/**
 * Resolve an app-relative artifact path to an absolute URL.
 * @param {string} baseUrl
 * @param {string} href
 * @returns {string}
 */
function resolveArtifactUrl(baseUrl, href) {
  return new URL(href, baseUrl).toString();
}

/**
 * Determine whether a receipt link is a screenshot artifact.
 * @param {string} href
 */
function isScreenshotReceipt(href) {
  return href.startsWith(PROOF_SCREENSHOT_PATH_PREFIX);
}

/**
 * Determine whether a receipt link is a page-text artifact.
 * @param {string} href
 */
function isPageTextReceipt(href) {
  return href.startsWith(PROOF_PAGE_TEXT_PATH_PREFIX);
}

/**
 * Validate a receipt response's content-type against the expected family.
 * @param {number} status
 * @param {string | null} contentType
 * @param {string} href
 * @returns {boolean}
 */
function receiptContentTypeOk(status, contentType, href) {
  if (status !== 200) return false;
  const mediaType = (contentType ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase() ?? "";
  if (isScreenshotReceipt(href)) {
    return PROOF_SCREENSHOT_MEDIA_TYPES.has(mediaType) || mediaType.startsWith("image/");
  }
  if (isPageTextReceipt(href)) {
    return mediaType === "text/plain";
  }
  return false;
}

/**
 * Sliding-window rate limiter for the public /timeline/:domain and artifact
 * routes. `acquire()` waits until a slot is free.
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
  maxRequests = BRAND_PAGE_RATE_LIMIT_MAX,
  windowMs = BRAND_PAGE_RATE_LIMIT_WINDOW_MS,
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
 * Probe a single /timeline/:domain and validate any receipt links.
 * @param {{
 *   domain: string,
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   userAgent?: string,
 *   requestTimeoutMs?: number,
 *   beforeRequest?: () => Promise<void> | void,
 * }} input
 * @returns {Promise<ProbeResult>}
 */
export async function probeDomain({
  domain,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  nowImpl = () => Date.now(),
  userAgent = DEFAULT_USER_AGENT,
  requestTimeoutMs = 30_000,
  beforeRequest,
}) {
  const url = buildTimelineUrl({ baseUrl, domain });
  const start = nowImpl();

  /** @type {Response | undefined} */
  let response;
  try {
    await beforeRequest?.();
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    return {
      domain,
      url,
      finalUrl: url,
      outcome: "error",
      status: null,
      elapsedMs: nowImpl() - start,
      entryCount: 0,
      entries: [],
      shareUrl: null,
      sharePresent: false,
      receiptChecks: [],
      workingReceiptCount: 0,
      brokenReceiptCount: 0,
      requestError: error instanceof Error ? error.message : String(error),
    };
  }

  const status = response.status;
  const finalUrl = response.url || url;
  const html = await response.text();
  const parsed = parseTimelineHtml(html);

  if (status === 429) {
    return {
      domain,
      url,
      finalUrl,
      outcome: "rate_limited",
      status,
      elapsedMs: nowImpl() - start,
      entryCount: 0,
      entries: [],
      shareUrl: null,
      sharePresent: false,
      receiptChecks: [],
      workingReceiptCount: 0,
      brokenReceiptCount: 0,
      requestError: null,
    };
  }

  if (status === 404) {
    return {
      domain,
      url,
      finalUrl,
      outcome: "not_found",
      status,
      elapsedMs: nowImpl() - start,
      entryCount: 0,
      entries: [],
      shareUrl: parsed.shareUrl,
      sharePresent: parsed.shareUrl !== null,
      receiptChecks: [],
      workingReceiptCount: 0,
      brokenReceiptCount: 0,
      requestError: null,
    };
  }

  if (status >= 400) {
    return {
      domain,
      url,
      finalUrl,
      outcome: "error",
      status,
      elapsedMs: nowImpl() - start,
      entryCount: 0,
      entries: [],
      shareUrl: parsed.shareUrl,
      sharePresent: parsed.shareUrl !== null,
      receiptChecks: [],
      workingReceiptCount: 0,
      brokenReceiptCount: 0,
      requestError: null,
    };
  }

  /** @type {ReceiptCheck[]} */
  const receiptChecks = [];
  for (const href of parsed.entries.flatMap((e) => e.receiptLinks)) {
    const absoluteUrl = resolveArtifactUrl(baseUrl, href);
    const receiptStart = nowImpl();
    try {
      await beforeRequest?.();
      let receiptResponse = await fetchImpl(absoluteUrl, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "user-agent": userAgent,
          accept: "*/*",
          "cache-control": "no-cache",
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (receiptResponse.status === 405 || receiptResponse.status === 501) {
        await beforeRequest?.();
        receiptResponse = await fetchImpl(absoluteUrl, {
          method: "GET",
          redirect: "follow",
          headers: {
            "user-agent": userAgent,
            accept: "*/*",
            "cache-control": "no-cache",
          },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      }
      const receiptStatus = receiptResponse.status;
      const contentType = receiptResponse.headers.get("content-type");
      const ok = receiptContentTypeOk(receiptStatus, contentType, href);
      receiptChecks.push({
        url: absoluteUrl,
        status: receiptStatus,
        contentType,
        ok,
        elapsedMs: nowImpl() - receiptStart,
        error: null,
      });
    } catch (error) {
      receiptChecks.push({
        url: absoluteUrl,
        status: null,
        contentType: null,
        ok: false,
        elapsedMs: nowImpl() - receiptStart,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const workingReceiptCount = receiptChecks.filter((c) => c.ok).length;
  const brokenReceiptCount = receiptChecks.length - workingReceiptCount;
  const entryCount = parsed.entryCount;
  const outcome = entryCount > 0 ? "verified" : "dead_end";

  return {
    domain,
    url,
    finalUrl,
    outcome,
    status,
    elapsedMs: nowImpl() - start,
    entryCount,
    entries: parsed.entries,
    shareUrl: parsed.shareUrl,
    sharePresent: parsed.shareUrl !== null,
    receiptChecks,
    workingReceiptCount,
    brokenReceiptCount,
    requestError: null,
  };
}

/**
 * @param {ProbeResult[]} results
 * @returns {Summary}
 */
export function summarizeResults(results) {
  return {
    total: results.length,
    verified: results.filter((r) => r.outcome === "verified").length,
    deadEnds: results.filter((r) => r.outcome === "dead_end").length,
    notFound: results.filter((r) => r.outcome === "not_found").length,
    rateLimited: results.filter((r) => r.outcome === "rate_limited").length,
    errors: results.filter((r) => r.outcome === "error").length,
    sharePresent: results.filter((r) => r.sharePresent).length,
    workingReceipts: results.reduce((sum, r) => sum + r.workingReceiptCount, 0),
    brokenReceipts: results.reduce((sum, r) => sum + r.brokenReceiptCount, 0),
    totalEntries: results.reduce((sum, r) => sum + r.entryCount, 0),
  };
}

/**
 * @param {{
 *   domains: readonly string[],
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   userAgent?: string,
 *   requestTimeoutMs?: number,
 *   requestSpacingMs?: number,
 *   paceRequests?: boolean,
 *   beforeRequest?: () => Promise<void> | void,
 *   onResult?: (probe: ProbeResult, index: number, total: number) => void,
 * }} input
 * @returns {Promise<RunResult>}
 */
export async function runLiveVerification({
  domains,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  nowImpl = () => Date.now(),
  userAgent = DEFAULT_USER_AGENT,
  requestTimeoutMs = 30_000,
  requestSpacingMs = 0,
  paceRequests = true,
  beforeRequest,
  onResult,
}) {
  const limiter = paceRequests
    ? createRateLimiter({ sleepImpl, nowImpl })
    : null;
  const resolvedBeforeRequest = beforeRequest
    ?? (limiter ? () => limiter.acquire() : undefined);

  /** @type {ProbeResult[]} */
  const results = [];
  for (const domain of domains) {
    const probeStart = nowImpl();
    const result = await probeDomain({
      domain,
      baseUrl,
      fetchImpl,
      sleepImpl,
      nowImpl,
      userAgent,
      requestTimeoutMs,
      beforeRequest: resolvedBeforeRequest,
    });
    results.push(result);
    onResult?.(result, results.length, domains.length);
    if (requestSpacingMs > 0) {
      const elapsed = nowImpl() - probeStart;
      const wait = Math.max(0, requestSpacingMs - elapsed);
      if (wait > 0) await sleepImpl(wait);
    }
  }

  return { baseUrl, results, summary: summarizeResults(results) };
}

/**
 * Build the canonical /timeline/:domain URL for comparison with the share input.
 * @param {string} baseUrl
 * @param {string} domain
 * @returns {string}
 */
export function buildCanonicalTimelineUrl(baseUrl, domain) {
  return new URL(`/timeline/${domain}`, baseUrl).toString();
}

/**
 * @param {number} laterMs
 * @param {number} earlierMs
 * @returns {number}
 */
export function daysBetween(laterMs, earlierMs) {
  return (laterMs - earlierMs) / (24 * 60 * 60 * 1000);
}

/**
 * @param {ParsedTimelineEntry[]} entries
 * @returns {number | null}
 */
export function oldestCaptureMs(entries) {
  const times = entries
    .map((entry) => Date.parse(entry.capturedAt))
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.min(...times) : null;
}

/**
 * Count dated states that have at least one working screenshot receipt.
 * Page-text links and "no screenshot" notes do not count — the termination
 * check asks for working screenshot links.
 * @param {ProbeResult} result
 * @param {string} baseUrl
 * @returns {number}
 */
export function countStatesWithWorkingScreenshots(result, baseUrl) {
  const okUrls = new Set(
    result.receiptChecks.filter((check) => check.ok).map((check) => check.url),
  );
  let count = 0;
  for (const entry of result.entries) {
    const shots = entry.receiptLinks.filter((href) =>
      href.startsWith(PROOF_SCREENSHOT_PATH_PREFIX),
    );
    if (shots.length === 0) continue;
    const resolved = shots.map((href) => resolveArtifactUrl(baseUrl, href));
    if (resolved.every((url) => okUrls.has(url))) count += 1;
  }
  return count;
}

/**
 * A qualifying watched competitor: HTTP 200, ≥3 dated states, oldest capture
 * at least 14 days ago, and ≥3 of those states have working screenshot links.
 * @param {ProbeResult} result
 * @param {{ baseUrl: string, nowMs: number }} options
 * @returns {boolean}
 */
export function isQualifyingWatchedCompetitor(result, { baseUrl, nowMs }) {
  if (result.status !== 200) return false;
  if (result.entryCount < WATCHED_MIN_STATES) return false;
  const oldest = oldestCaptureMs(result.entries);
  if (oldest == null) return false;
  if (daysBetween(nowMs, oldest) < WATCHED_MIN_DAYS) return false;
  return countStatesWithWorkingScreenshots(result, baseUrl) >= WATCHED_MIN_STATES;
}

/**
 * @typedef {Object} TerminationCheck
 * @property {string} name
 * @property {boolean} ok
 * @property {boolean} [skip]
 * @property {number | null} [observed]
 * @property {number | null} [threshold]
 * @property {string} detail
 */

/**
 * Evaluate the BET 3 termination checks against the probe results.
 * A SKIP is not a pass. `pass` is true only when every check is ok and none skipped.
 * @param {ProbeResult[]} results
 * @param {string} [baseUrl]
 * @param {{
 *   nowMs?: number,
 *   snapshotCount?: number | null,
 *   priorSnapshotCount?: number | null,
 * }} [options]
 * @returns {{ pass: boolean, checks: TerminationCheck[] }}
 */
export function evaluateTermination(
  results,
  baseUrl = DEFAULT_BASE_URL,
  options = {},
) {
  const nowMs = options.nowMs ?? Date.now();
  const snapshotCount = options.snapshotCount;
  const priorSnapshotCount = options.priorSnapshotCount;

  const non200Domains = results
    .filter((r) => r.status !== 200)
    .map((r) => r.domain);
  const timelineReachableCheck = {
    name: "timeline_route_reachable",
    ok: non200Domains.length === 0,
    skip: false,
    observed: non200Domains.length,
    threshold: 0,
    detail:
      non200Domains.length === 0
        ? "all probed domains returned HTTP 200"
        : `non-200 responses: ${non200Domains.join(", ")}`,
  };

  const demoResults = DEMO_BRAND_PAGE_DOMAINS.map((d) => ({
    domain: d,
    result: results.find((r) => r.domain === d),
  }));
  const demoMissing = demoResults
    .filter((dr) => !dr.result || dr.result.entryCount < 1)
    .map((dr) => dr.domain);
  const demoBackfillCheck = {
    name: "demo_backfill_present",
    ok: demoMissing.length === 0,
    skip: false,
    observed: DEMO_BRAND_PAGE_DOMAINS.length - demoMissing.length,
    threshold: DEMO_BRAND_PAGE_DOMAINS.length,
    detail:
      demoMissing.length === 0
        ? `all ${DEMO_BRAND_PAGE_DOMAINS.length} demo brand domains have >=1 offer state`
        : `missing backfill for: ${demoMissing.join(", ")}`,
  };

  const qualifyingWatched = results.filter((r) =>
    isQualifyingWatchedCompetitor(r, { baseUrl, nowMs }),
  );
  const bestWatched =
    qualifyingWatched.length > 0
      ? qualifyingWatched.reduce((best, r) =>
          r.entryCount > best.entryCount ? r : best,
        )
      : null;
  const watchedCompetitorCheck = {
    name: "watched_competitor_three_screenshot_states",
    ok: qualifyingWatched.length > 0,
    skip: false,
    observed: qualifyingWatched.length,
    threshold: 1,
    detail: bestWatched
      ? `qualifying watched competitor: ${bestWatched.domain} (${bestWatched.entryCount} states, ${countStatesWithWorkingScreenshots(bestWatched, baseUrl)} working screenshots, oldest ${Math.floor(daysBetween(nowMs, oldestCaptureMs(bestWatched.entries) ?? nowMs))}d ago)`
      : "no probed domain has been watched >=14 days with >=3 dated states and working screenshot links",
  };

  const shareQualifying = results.filter((r) => {
    if (r.status !== 200) return false;
    if (!r.sharePresent || !r.shareUrl) return false;
    const canonical = buildCanonicalTimelineUrl(baseUrl, r.domain);
    return r.shareUrl === canonical;
  });
  const shareCheck = {
    name: "share_link_present_and_logged_out",
    ok: shareQualifying.length > 0,
    skip: false,
    observed: shareQualifying.length,
    threshold: 1,
    detail:
      shareQualifying.length > 0
        ? `share URL present and logged out on: ${shareQualifying.map((r) => r.domain).join(", ")}`
        : "no probed domain rendered a matching canonical share URL",
  };

  const brokenReceipts = [];
  for (const r of results) {
    for (const c of r.receiptChecks) {
      if (c.status === 404 || (c.status !== null && c.status >= 500)) {
        brokenReceipts.push(`${r.domain} → ${c.url} (${c.status})`);
      }
    }
  }
  const noReceipt404sCheck = {
    name: "no_receipt_404s",
    ok: brokenReceipts.length === 0,
    skip: false,
    observed: brokenReceipts.length,
    threshold: 0,
    detail:
      brokenReceipts.length === 0
        ? "no receipt links returned 404 or 5xx"
        : `broken receipt links: ${brokenReceipts.join("; ")}`,
  };

  /** @type {TerminationCheck} */
  let snapshotPositiveCheck;
  if (snapshotCount == null) {
    snapshotPositiveCheck = {
      name: "snapshot_row_count_positive",
      ok: false,
      skip: true,
      observed: null,
      threshold: 1,
      detail: "SKIP: landing_page_snapshot count not available (no D1 probe)",
    };
  } else {
    snapshotPositiveCheck = {
      name: "snapshot_row_count_positive",
      ok: snapshotCount > 0,
      skip: false,
      observed: snapshotCount,
      threshold: 1,
      detail:
        snapshotCount > 0
          ? `landing_page_snapshot rows: ${snapshotCount}`
          : "landing_page_snapshot row count is 0",
    };
  }

  /** @type {TerminationCheck} */
  let snapshotGrowingCheck;
  if (snapshotCount == null || priorSnapshotCount == null) {
    snapshotGrowingCheck = {
      name: "snapshot_row_count_growing_daily",
      ok: false,
      skip: true,
      observed: snapshotCount ?? null,
      threshold: priorSnapshotCount == null ? null : priorSnapshotCount + 1,
      detail:
        "SKIP: growing-daily needs two observations; this run has no prior count",
    };
  } else {
    snapshotGrowingCheck = {
      name: "snapshot_row_count_growing_daily",
      ok: snapshotCount > priorSnapshotCount,
      skip: false,
      observed: snapshotCount,
      threshold: priorSnapshotCount + 1,
      detail:
        snapshotCount > priorSnapshotCount
          ? `row count grew ${priorSnapshotCount} → ${snapshotCount}`
          : `row count did not grow (${priorSnapshotCount} → ${snapshotCount})`,
    };
  }

  const checks = [
    timelineReachableCheck,
    demoBackfillCheck,
    watchedCompetitorCheck,
    shareCheck,
    noReceipt404sCheck,
    snapshotPositiveCheck,
    snapshotGrowingCheck,
  ];
  const skipped = checks.filter((check) => check.skip).length;
  const pass = skipped === 0 && checks.every((check) => check.ok);
  return { pass, checks };
}

/**
 * @param {ProbeResult} probe
 * @param {number} index
 * @param {number} total
 * @returns {string}
 */
export function formatProbeLine(probe, index, total) {
  const tag =
    probe.outcome === "verified"
      ? "OK "
      : probe.outcome === "dead_end"
        ? "DE "
        : probe.outcome === "not_found"
          ? "404"
          : probe.outcome === "rate_limited"
            ? "429"
            : "ERR";
  const totalReceipts = probe.workingReceiptCount + probe.brokenReceiptCount;
  const share = probe.sharePresent ? "yes" : "no";
  return `${tag} [${String(index).padStart(2)}/${total}] ${probe.domain.padEnd(20)} status=${String(probe.status ?? "---").padStart(3)} rows=${String(probe.entryCount).padStart(3)} receipts=${String(probe.workingReceiptCount).padStart(2)}/${String(totalReceipts).padStart(2)} share=${share} elapsed=${probe.elapsedMs.toFixed(0).padStart(5)}ms`;
}

/**
 * @param {{ run: RunResult }} input
 * @returns {string}
 */
export function formatSummary({ run }) {
  const { summary } = run;
  const lines = [];
  lines.push(`BET 3 live verification @ ${run.baseUrl}`);
  lines.push(`Probed ${summary.total} domain(s)`);
  lines.push(
    `  verified: ${summary.verified} | dead-ends: ${summary.deadEnds} | not_found: ${summary.notFound} | rate-limited: ${summary.rateLimited} | errors: ${summary.errors}`,
  );
  lines.push(
    `  share present: ${summary.sharePresent} | receipt links: ${summary.workingReceipts} working / ${summary.brokenReceipts} broken`,
  );
  lines.push(`  total offer states observed: ${summary.totalEntries}`);
  return lines.join("\n");
}

/**
 * Only fire the live verification when executed directly; importing this
 * module (the unit test does) must not trigger network calls.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

/**
 * Unbuffered stdout so a piped canary is not silent until exit.
 * @param {string} line
 */
function emitLine(line) {
  writeSync(1, `${line}\n`);
}

/**
 * Parse an optional integer from env/CLI. Empty, missing, or NaN → null.
 * @param {string | undefined} raw
 * @returns {number | null}
 */
export function parseOptionalCount(raw) {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {string[]} argv
 * @returns {{ baseUrl?: string, domains?: string, spacingMs?: number, json?: boolean }}
 */
function parseCliArgs(argv) {
  /** @type {{ baseUrl?: string, domains?: string, spacingMs?: number, json?: boolean }} */
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      parsed.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--domains" && argv[i + 1]) {
      parsed.domains = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--spacing-ms" && argv[i + 1]) {
      parsed.spacingMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
  }
  return parsed;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl ?? DEFAULT_BASE_URL;
  const envDomains = process.env.BET3_TARGET_DOMAINS;
  const rawDomains = args.domains ?? envDomains;
  const domains = rawDomains
    ? rawDomains
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : DEMO_BRAND_PAGE_DOMAINS;
  const spacingMs = args.spacingMs ?? 0;

  emitLine(
    `BET 3 live verification starting @ ${baseUrl} (n=${domains.length}, spacing=${spacingMs}ms)`,
  );

  const limiter = createRateLimiter({
    maxRequests: BRAND_PAGE_RATE_LIMIT_MAX,
    windowMs: BRAND_PAGE_RATE_LIMIT_WINDOW_MS,
  });

  const run = await runLiveVerification({
    domains,
    baseUrl,
    fetchImpl: fetch,
    sleepImpl: defaultSleep,
    nowImpl: () => Date.now(),
    userAgent: DEFAULT_USER_AGENT,
    requestSpacingMs: spacingMs,
    paceRequests: false,
    beforeRequest: () => limiter.acquire(),
    onResult: (probe, index, total) => {
      emitLine(formatProbeLine(probe, index, total));
    },
  });

  const snapshotCount = parseOptionalCount(process.env.BET3_SNAPSHOT_COUNT);
  const priorSnapshotCount = parseOptionalCount(
    process.env.BET3_PRIOR_SNAPSHOT_COUNT,
  );
  const verdict = evaluateTermination(run.results, run.baseUrl, {
    nowMs: Date.now(),
    snapshotCount,
    priorSnapshotCount,
  });

  emitLine("");
  emitLine(formatSummary({ run }));
  emitLine("");
  emitLine("Termination checks:");
  for (const check of verdict.checks) {
    const tag = check.skip ? "SKIP" : check.ok ? "PASS" : "FAIL";
    emitLine(`  ${tag} ${check.name}: ${check.detail}`);
  }

  if (args.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: run.baseUrl,
      results: run.results,
      summary: run.summary,
      termination: verdict,
    };
    emitLine("");
    emitLine("JSON_REPORT_BEGIN");
    emitLine(JSON.stringify(report, null, 2));
    emitLine("JSON_REPORT_END");
  }

  process.exit(verdict.pass ? 0 : 1);
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}
