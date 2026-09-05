#!/usr/bin/env node
// Daily regression guard for the §1.8 six-domain set (issue #1452).
//
// Fetches /search?q=<keyword>&country=all for each of the six domains and
// fails if any returns 0 verified/likely rows — a dead-end or blanket-unmatched
// regression on the keyword tier-label path. This is the post-merge production
// verification that the merged tier-label fix actually reaches the rendered
// row for the six-domain set (accept #1 and #3 of issue #1452).
//
// The script is measurement + verdict: it exits non-zero when any domain
// dead-ends, so a scheduled run (GitHub Actions cron) fails loud. It reuses
// `parseSearchResponseHtml` from bet2-live-verification.mjs so the tier-count
// parsing stays in one place.

import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseRetryAfterMs, parseSearchResponseHtml } from "./bet2-live-verification.mjs";

// The §1.8 six-domain set (issue #1452). Each brand must render at least one
// verified or likely row for a bare `q=<brand>` keyword search.
export const SIX_DOMAINS = Object.freeze([
  "allbirds",
  "notion",
  "oura",
  "gymshark",
  "hubspot",
  "mamaearth",
]);

export const DEFAULT_BASE_URL = "https://0509.io";
export const SEARCH_TIER_CANARY_USER_AGENT = "0509-search-tier-canary/1.0";

// Known separate-issue alias gaps: a brand whose ads land on a domain the
// identity resolver cannot yet connect to the bare brand keyword, so a bare
// `q=<brand>` search renders every row Unmatched even though the tier-label
// path is healthy. This is NOT a #1452 tier-label regression — it is the named
// alias gap's symptom — so a blanket-Unmatched result for one of these keys is
// reported as a WARNING, not a canary failure. A dead-end (0 rows) for a
// known-gap domain still fails the canary: the guard's core promise is "0
// dead-end empty states", and an alias gap never produces a dead-end.
// Remove the entry the moment the named issue lands and the domain flips to
// verified/likely; leaving a stale entry here would silently mask a real
// future regression on that domain.
export const KNOWN_ALIAS_GAPS = Object.freeze(new Map([["oura", "Nishfleet/0509#1427"]]));

// A cold domain can return a warming page (0 rows) on the first hit. The six
// brands are well-known with cached results, so a single retry after a short
// wait clears the transient warming state without burning the anonymous
// /search budget (20 req / 10 min / IP).
export const WARMING_RETRY_LIMIT = 1;
export const WARMING_RETRY_DELAY_MS = 5_000;

// Anonymous /search is 20 requests per 10 minutes per IP. The canary makes 6
// requests (one per domain), but a scheduled run can collide with other search
// canaries on the same runner IP, so a 429 is retried with the same backoff
// the BET 2 verifier uses rather than treated as a dead-end.
export const SEARCH_429_RETRY_LIMIT = 3;
export const SEARCH_429_DEFAULT_WAIT_MS = 60_000;

/**
 * @typedef {Object} KeywordTierProbe
 * @property {string} keyword
 * @property {number | null} status
 * @property {number} rowCount
 * @property {{ verified: number; likely: number; unmatched: number }} tierCounts
 * @property {string | null} headline
 * @property {boolean} isWarming
 * @property {boolean} [rateLimited]
 * @property {string} [requestError]
 */

/**
 * @param {{
 *   keyword: string,
 *   baseUrl: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   retryLimit?: number,
 *   retryDelayMs?: number,
 *   max429Retries?: number,
 * }} input
 * @returns {Promise<KeywordTierProbe>}
 */
export async function probeKeywordTier({
  keyword,
  baseUrl,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  retryLimit = WARMING_RETRY_LIMIT,
  retryDelayMs = WARMING_RETRY_DELAY_MS,
  max429Retries = SEARCH_429_RETRY_LIMIT,
}) {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", keyword);
  url.searchParams.set("country", "all");

  let lastParsed = null;
  let lastStatus = null;
  let rateLimitHits = 0;
  let warmingAttempts = 0;
  while (true) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          "user-agent": SEARCH_TIER_CANARY_USER_AGENT,
          "cache-control": "no-cache",
          pragma: "no-cache",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return {
        keyword,
        status: null,
        rowCount: 0,
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        headline: null,
        isWarming: false,
        requestError: error instanceof Error ? error.message : String(error),
      };
    }
    lastStatus = response.status;
    if (response.status === 429) {
      rateLimitHits += 1;
      const retryAfterHeader = response.headers.get("retry-after");
      await response.text();
      if (rateLimitHits > max429Retries) {
        return {
          keyword,
          status: 429,
          rowCount: 0,
          tierCounts: { verified: 0, likely: 0, unmatched: 0 },
          headline: null,
          isWarming: false,
          rateLimited: true,
        };
      }
      await sleepImpl(parseRetryAfterMs(retryAfterHeader, SEARCH_429_DEFAULT_WAIT_MS));
      continue;
    }
    const html = await response.text();
    lastParsed = parseSearchResponseHtml(html);
    // A warming page with no rows yet: retry once before calling it a
    // dead-end. A populated page (rows present) is final.
    if (!lastParsed.isWarming || lastParsed.rowCount > 0) {
      break;
    }
    if (warmingAttempts >= retryLimit) {
      break;
    }
    warmingAttempts += 1;
    await sleepImpl(retryDelayMs);
  }

  return {
    keyword,
    status: lastStatus,
    rowCount: lastParsed?.rowCount ?? 0,
    tierCounts: lastParsed?.tierCounts ?? { verified: 0, likely: 0, unmatched: 0 },
    headline: lastParsed?.headline ?? null,
    isWarming: lastParsed?.isWarming ?? false,
  };
}

/**
 * @param {KeywordTierProbe[]} results
 * @returns {{
 *   pass: boolean,
 *   failures: KeywordTierProbe[],
 *   knownGaps: { probe: KeywordTierProbe, issue: string }[],
 * }}
 */
export function evaluateSixDomainTiers(results) {
  const failures = [];
  const knownGaps = [];
  for (const probe of results) {
    if (probe.tierCounts.verified + probe.tierCounts.likely > 0) {
      continue;
    }
    // 0 verified/likely. A dead-end (0 rows, not warming) is always a failure,
    // even for a known alias gap — the guard's core promise is "0 dead-end
    // empty states", and an alias gap never empties the page. A persistent 429
    // (rowCount 0, rateLimited) lands here too and correctly fails the canary:
    // the run could not confirm the domain.
    if (probe.rowCount === 0 && !probe.isWarming) {
      failures.push(probe);
      continue;
    }
    // Rows present but all Unmatched. A known alias gap is a WARNING (the
    // tier-label path is healthy; the mislabel is the named issue's symptom),
    // not a canary failure. An unknown domain blanket-Unmatched is a real
    // tier-label regression and fails.
    const gapIssue = KNOWN_ALIAS_GAPS.get(probe.keyword);
    if (gapIssue) {
      knownGaps.push({ probe, issue: gapIssue });
    } else {
      failures.push(probe);
    }
  }
  return { pass: failures.length === 0, failures, knownGaps };
}

/**
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} [input]
 * @returns {Promise<{ baseUrl: string, results: KeywordTierProbe[], verdict: { pass: boolean, failures: KeywordTierProbe[], knownGaps: { probe: KeywordTierProbe, issue: string }[] } }>}
 */
export async function runCanary({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
} = {}) {
  const results = [];
  for (const keyword of SIX_DOMAINS) {
    results.push(await probeKeywordTier({ keyword, baseUrl, fetchImpl, sleepImpl }));
  }
  const verdict = evaluateSixDomainTiers(results);
  return { baseUrl, results, verdict };
}

/**
 * @param {number} ms
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {KeywordTierProbe} probe
 */
function formatProbeLine(probe) {
  const tier = `${probe.tierCounts.verified} verified / ${probe.tierCounts.likely} likely / ${probe.tierCounts.unmatched} unmatched`;
  const status = probe.rateLimited ? "429" : String(probe.status ?? "ERR");
  return `${probe.keyword.padEnd(10)} status=${status} rows=${String(probe.rowCount).padStart(3)} ${tier}`;
}

/**
 * @param {string} line
 */
function emitLine(line) {
  writeSync(1, `${line}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const baseUrl = process.env.SEARCH_TIER_CANARY_BASE_URL ?? DEFAULT_BASE_URL;
  emitLine(`search tier canary starting @ ${baseUrl} (n=${SIX_DOMAINS.length})`);
  const { results, verdict } = await runCanary({ baseUrl });
  for (const probe of results) {
    emitLine(formatProbeLine(probe));
  }
  emitLine("");
  if (verdict.pass) {
    if (verdict.knownGaps.length === 0) {
      emitLine("PASS: all six domains returned at least one verified or likely row");
    } else {
      emitLine(
        `PASS: all six domains returned rows (0 dead-ends); ${verdict.knownGaps.length} known alias gap(s) warned, not failed:`,
      );
      for (const gap of verdict.knownGaps) {
        const t = gap.probe.tierCounts;
        emitLine(
          `  - ${gap.probe.keyword}: ${t.verified} verified / ${t.likely} likely / ${t.unmatched} unmatched — tracked by ${gap.issue}`,
        );
      }
    }
    process.exit(0);
  }
  emitLine("FAIL: the following domains returned 0 verified/likely rows:");
  for (const probe of verdict.failures) {
    const cause = probe.rateLimited
      ? "rate-limited (429) after retries"
      : `rows=${probe.rowCount}`;
    emitLine(`  - ${probe.keyword} (${cause}, status=${String(probe.status ?? "ERR")})`);
  }
  process.exit(1);
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}
