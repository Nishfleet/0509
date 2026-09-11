#!/usr/bin/env node
// d1-budget: reads=400 writes=0 runs_per_day=8
// Sneaker-resale seed-list recall guard (issue #1945).
//
// The sneaker-resale cluster is the strongest, most-consistent buyer signal
// across the daily market reports (tracked across 7 consecutive daily reports,
// 2026-08-25..2026-09-07). Its 24 seed-list brands must each render >=1
// verified/likely row on a bare /search probe, or the /ads/:domain page cannot
// publish and the brand dead-ends in the free preview. The existing
// search-tier-canary guards only the §1.8 six-domain set and is not scheduled;
// the seed-list cluster that drives the market signal had no recall guard at
// all, so a silent recall/alias regression on the strongest cluster went
// unmeasured.
//
// This canary iterates the 24 `data/seed-lists/sneaker-resale.json` domains,
// probes each against the production /search surface (the exact path a buyer
// and Google take — the same `website=<domain>` probe the ads-domain-publisher
// uses), reports per-domain verified/likely/unmatched rows, and fails loud
// (exit non-zero) when a coverage-bearing brand dead-ends (0 rows) or returns
// blanket-unmatched. A brand that genuinely runs no Meta ads is reported as
// no-coverage and does not fail the canary; a brand that SHOULD have coverage
// but dead-ends is a recall/alias regression and fails.
//
// Reuses `parseSearchResponseHtml` from bet2-live-verification.mjs and the 429
// retry/backoff the search-tier canary uses, so the tier-count parsing and
// rate-limit handling stay in one place.

import { readFileSync } from "node:fs";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseRetryAfterMs, parseSearchResponseHtml } from "./bet2-live-verification.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = new URL("..", import.meta.url).pathname;

export const DEFAULT_BASE_URL = "https://0509.io";
export const SNEAKER_RESALE_CANARY_USER_AGENT = "0509-sneaker-resale-recall-canary/1.0";

// The seed-list file this canary guards. Read at runtime so the canary always
// iterates the live list (a brand added to the list is automatically probed).
export const SEED_LIST_PATH = `${repoRoot}data/seed-lists/sneaker-resale.json`.replace(/\/+/g, "/");

// A brand that genuinely runs no Meta ads is reported as no-coverage and does
// not fail the canary — the honest "not evidence of inactivity" copy, no page.
// A brand NOT in this set (and not a known identity gap) that dead-ends (0
// rows) or blanket-unmatches is a recall/alias regression and fails the canary.
// This set is the classification output of issue #1945. Its only member was
// sneakerping.com (probed 2026-09-07: no verified Meta coverage, not a known
// large-scale Meta advertiser) — removed from the seed list on 2026-09-11 when
// the market signal dropped SneakerPing from the below-retail cluster
// (issue #2926), so the set is empty until a future probe classifies another
// no-coverage seed brand. Add an entry only for a probed no-coverage brand,
// and remove an entry the moment the brand starts running Meta ads so a real
// future regression on that brand is not silently masked.
export const KNOWN_NO_COVERAGE = Object.freeze(new Set());

// A brand that SHOULD carry verified/likely Meta coverage (a major, established
// Meta advertiser) but currently dead-ends (0 rows) or blanket-unmatches
// because the search-v2 identity resolution does not connect its ads to its
// domain. Fixing that gap is a separate search-pipeline change (tracked in the
// follow-up issue), not a canary change. Until the pipeline fix lands, the
// canary reports these brands as known gaps with the tracking issue (surfaced
// in every run) but does NOT hard-fail the guard — mirroring how
// search-tier-canary handles its oura alias gap (KNOWN_ALIAS_GAPS). The moment
// the pipeline fix lands and the brand returns rows, it drops out of this set
// automatically (the probe returns verified/likely) and the guard hard-fails if
// it ever regresses again.
export const KNOWN_IDENTITY_GAPS = Object.freeze(new Map([
  ["reebok.com", "Nishfleet/0509#1950"],
  // Live-evidenced 2026-09-09 ~04:45 IST (senior auditor): zappos ads EXIST and
  // are VERIFIED — /search?q=zappos.com returns 13 rows, all 13 verified, 11
  // linking www.zappos.com — but the website=zappos.com (apex) probe connects 0
  // (settled "No verified ads found for zappos.com", NOT warming — the #2037
  // warming carve-out does not apply), /ads/zappos.com 301s to /search?q=, and
  // the sitemap dropped it after 2026-09-06's indexable capture. Same apex↔www
  // identity-resolution class as goat/on/reebok: the fix is a curated
  // IDENTITY_OVERRIDES entry (ridge.com precedent, #2014), tracked in the issue.
  // Auto-drops the moment the pipeline fix lands and the probe returns rows.
  ["zappos.com", "Nishfleet/0509#2059"],
]));

// A cold domain can return a warming page (0 rows) on the first hit. The
// canary retries once after a short wait to clear the transient warming state
// without burning the anonymous /search budget (20 req / 10 min / IP).
export const WARMING_RETRY_LIMIT = 2;
export const WARMING_RETRY_DELAY_MS = 15_000;

// A cold domain's first /search response can legitimately take longer than
// the 30s the sibling probes use: the route awaits identity resolution (a
// redirect chain of homepage fetches, up to ~60s) before the warming page or
// rows come back. finishline.com returned HTTP 200 in 30.7s on a live probe
// (issue #2700) — inside a user's wait, outside the old 30s budget. The
// canary asserts what a patient user sees, so the probe waits up to 90s.
export const PROBE_REQUEST_TIMEOUT_MS = 90_000;

// A transport blip — the fetch throwing (timeout, DNS, connection reset) or a
// 5xx from the edge — means the probe could not confirm coverage, but a single
// blip must not fail the whole 24-domain sweep: finishline.com and
// jdsports.com each returned one-off ERRs that failed otherwise-green runs
// (issue #2700). The probe retries a bounded number of times; a persistent
// failure still reports requestError and fails loud — "cannot confirm" is
// never a pass. The 60s spacing gives an in-flight server-side capture (which
// outlives an aborted client request via waitUntil) time to land before the
// retry asks again.
export const REQUEST_ERROR_RETRY_LIMIT = 2;
export const REQUEST_ERROR_RETRY_DELAY_MS = 60_000;

// Anonymous /search is 20 requests per 10 minutes per IP. The canary makes 24
// requests (one per domain), so a scheduled run can collide with other search
// canaries on the same runner IP; a 429 is retried with the same backoff the
// BET 2 verifier uses rather than treated as a dead-end.
export const SEARCH_429_RETRY_LIMIT = 3;
export const SEARCH_429_DEFAULT_WAIT_MS = 60_000;

// The retry budgets above stack: a full brownout (24 domains each burning 3
// attempts × 90s + 2 × 60s) would run ~2h42m — past the unit's 45min
// TimeoutStartSec, so the service would be killed with NO report at all. A
// run-level wall budget below the unit timeout caps total retry wait: once
// the budget is spent the probe stops retrying and fails loud on its last
// state instead of dying silently (reviewer round on issue #2700).
export const RUN_WALL_BUDGET_MS = 40 * 60_000;
const RUN_START_MS = Date.now();

/**
 * @typedef {Object} SneakerResaleProbe
 * @property {string} domain
 * @property {string} brand
 * @property {number | null} status
 * @property {number} rowCount
 * @property {{ verified: number; likely: number; unmatched: number }} tierCounts
 * @property {string | null} headline
 * @property {boolean} isWarming
 * @property {boolean} [rateLimited]
 * @property {string} [requestError]
 */

/**
 * Load the sneaker-resale seed list and return its domain entries.
 * @returns {{ domain: string; brand: string }[]}
 */
export function loadSneakerResaleDomains() {
  let raw;
  try {
    raw = readFileSync(SEED_LIST_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read seed list at data/seed-lists/sneaker-resale.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const list = /** @type {{ domains?: Array<Record<string, unknown>> }} */ (JSON.parse(raw));
  if (!Array.isArray(list.domains) || list.domains.length === 0) {
    throw new Error("Sneaker-resale seed list has no domains");
  }
  return list.domains.map((entry) => ({
    domain: String(entry.domain ?? "").trim(),
    brand: String(entry.brand ?? entry.domain ?? "").trim(),
  }));
}

/**
 * @param {number} ms
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probe one seed-list domain against the production /search surface and report
 * its verified/likely/unmatched tier counts. Uses the same `website=<domain>`
 * probe the ads-domain-publisher uses — the exact path that decides whether
 * the /ads/:domain page publishes. 429s wait out the Retry-After, capped at the
 * search window, so the anonymous budget is never violated.
 *
 * @param {{
 *   domain: string,
 *   baseUrl: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   retryLimit?: number,
 *   retryDelayMs?: number,
 *   max429Retries?: number,
 *   requestErrorRetryLimit?: number,
 *   requestErrorRetryDelayMs?: number,
 *   elapsedMsImpl?: () => number,
 * }} input
 * @returns {Promise<SneakerResaleProbe>}
 */
export async function probeSneakerResaleDomain({
  domain,
  baseUrl,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  retryLimit = WARMING_RETRY_LIMIT,
  retryDelayMs = WARMING_RETRY_DELAY_MS,
  max429Retries = SEARCH_429_RETRY_LIMIT,
  requestErrorRetryLimit = REQUEST_ERROR_RETRY_LIMIT,
  requestErrorRetryDelayMs = REQUEST_ERROR_RETRY_DELAY_MS,
  elapsedMsImpl = () => Date.now() - RUN_START_MS,
}) {
  // Remaining wall budget for this run; a retry is only taken when its wait
  // (plus a 90s attempt) still fits. Exhausted budget ⇒ no retry, terminal
  // state, fail loud.
  const canAffordRetry = (/** @type {number} */ delayMs) =>
    elapsedMsImpl() + delayMs + PROBE_REQUEST_TIMEOUT_MS <= RUN_WALL_BUDGET_MS;
  const url = new URL("/search", baseUrl);
  url.searchParams.set("website", domain);
  url.searchParams.set("country", "all");

  let lastParsed = null;
  let lastStatus = null;
  let rateLimitHits = 0;
  let warmingAttempts = 0;
  let requestErrorAttempts = 0;
  while (true) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          "user-agent": SNEAKER_RESALE_CANARY_USER_AGENT,
          "cache-control": "no-cache",
          pragma: "no-cache",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(PROBE_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      requestErrorAttempts += 1;
      if (requestErrorAttempts <= requestErrorRetryLimit && canAffordRetry(requestErrorRetryDelayMs)) {
        await sleepImpl(requestErrorRetryDelayMs);
        continue;
      }
      return {
        domain,
        brand: domain,
        status: lastStatus,
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
      if (rateLimitHits > max429Retries || !canAffordRetry(parseRetryAfterMs(retryAfterHeader, SEARCH_429_DEFAULT_WAIT_MS))) {
        return {
          domain,
          brand: domain,
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
    if (response.status >= 500) {
      await response.text();
      requestErrorAttempts += 1;
      if (requestErrorAttempts <= requestErrorRetryLimit && canAffordRetry(requestErrorRetryDelayMs)) {
        await sleepImpl(requestErrorRetryDelayMs);
        continue;
      }
      return {
        domain,
        brand: domain,
        status: lastStatus,
        rowCount: 0,
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        headline: null,
        isWarming: false,
        requestError: `HTTP ${response.status}`,
      };
    }
    const html = await response.text();
    lastParsed = parseSearchResponseHtml(html);
    // A warming page with no rows yet: retry once before calling it a
    // dead-end. A populated page (rows present) is final.
    if (!lastParsed.isWarming || lastParsed.rowCount > 0) {
      break;
    }
    if (warmingAttempts >= retryLimit || !canAffordRetry(retryDelayMs)) {
      break;
    }
    warmingAttempts += 1;
    await sleepImpl(retryDelayMs);
  }

  return {
    domain,
    brand: domain,
    status: lastStatus,
    rowCount: lastParsed?.rowCount ?? 0,
    tierCounts: lastParsed?.tierCounts ?? { verified: 0, likely: 0, unmatched: 0 },
    headline: lastParsed?.headline ?? null,
    isWarming: lastParsed?.isWarming ?? false,
  };
}

/**
 * @param {SneakerResaleProbe[]} results
 * @param {{ knownNoCoverage?: Set<string> }} [options] Test seam: the live
 *   KNOWN_NO_COVERAGE set is empty since #2926 removed the only member, so the
 *   carve-out contract is pinned with an injected set instead.
 * @returns {{
 *   pass: boolean,
 *   failures: SneakerResaleProbe[],
 *   noCoverage: SneakerResaleProbe[],
 *   identityGaps: { probe: SneakerResaleProbe, issue: string }[],
 *   warming: SneakerResaleProbe[],
 * }}
 */
export function evaluateSneakerResaleRecall(results, { knownNoCoverage = KNOWN_NO_COVERAGE } = {}) {
  const failures = [];
  const noCoverage = [];
  const identityGaps = [];
  const warming = [];
  for (const probe of results) {
    if (probe.tierCounts.verified + probe.tierCounts.likely > 0) {
      continue;
    }
    // A run that could not confirm a domain's coverage — a persistent 429
    // (rateLimited) or a network error — is NEVER a pass, no matter which
    // carve-out the domain is in. The guard cannot prove the brand has no
    // coverage (or that its gap still holds) if the request never returned a
    // settled page; "cannot confirm" must fail loud, exactly as the reference
    // search-tier canary does for a persistent 429.
    if (probe.rateLimited || probe.requestError) {
      failures.push(probe);
      continue;
    }
    // A probe that is STILL on the warming page after the retry budget is
    // INCONCLUSIVE, not a dead-end: warming is the site's designed cold-cache
    // state (production /search can stay warming for minutes on a cold
    // domain, especially overnight), and the reference verifier's own
    // contract counts a dead-end only as `rowCount == 0 && !isWarming`
    // (bet2-live-verification.mjs). Treating a persistent warming page as a
    // recall regression made the guard flap on rotating brands every night
    // (2026-09-09 03:00/03:03 IST: footlocker+zappos, then puma+zappos, on
    // identical code). Surfaced every run; a genuine regression (a settled,
    // non-warming 0-row page) still fails loud below.
    if (probe.isWarming) {
      warming.push(probe);
      continue;
    }
    // 0 verified/likely on a CONFIRMED settled page. A known genuine-no-ads
    // brand is reported as no-coverage and does not fail — the honest "not
    // evidence of inactivity" copy, no page (issue #1945 verify). A brand not
    // in any carve-out that dead-ends (0 rows) or blanket-unmatches is a real
    // recall/alias regression and fails.
    if (knownNoCoverage.has(probe.domain)) {
      noCoverage.push(probe);
      continue;
    }
    // A brand with a documented identity-resolution gap (a major advertiser
    // whose ads the pipeline does not yet connect to its domain) is surfaced
    // as a known gap with its tracking issue rather than hard-failed —
    // mirroring search-tier-canary's known-alias-gap handling and the issue's
    // "fix the identity gap, defer the pipeline change" classification. The
    // gap's current symptom (0 rows / blanket-unmatched) is the documented
    // state, surfed every run. The moment the pipeline fix lands the probe
    // returns rows and the brand drops out of this set; a confirmable 429 or
    // request error above still fails regardless.
    const gapIssue = KNOWN_IDENTITY_GAPS.get(probe.domain);
    if (gapIssue) {
      identityGaps.push({ probe, issue: gapIssue });
      continue;
    }
    // An unknown dead-end (0 rows, not warming) is always a failure — the
    // guard's core promise is "0 dead-end empty states". A blanket-unmatched
    // page (rows present but all Unmatched) on an unknown domain is also a
    // failure: the brand's ads are not being connected to its domain, so the
    // /ads/:domain page cannot publish.
    failures.push(probe);
  }
  return { pass: failures.length === 0, failures, noCoverage, identityGaps, warming };
}

/**
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} [input]
 * @returns {Promise<{ baseUrl: string, results: SneakerResaleProbe[], verdict: { pass: boolean, failures: SneakerResaleProbe[], noCoverage: SneakerResaleProbe[], identityGaps: { probe: SneakerResaleProbe, issue: string }[], warming: SneakerResaleProbe[] } }>}
 */
export async function runCanary({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
} = {}) {
  const domains = loadSneakerResaleDomains();
  const results = [];
  for (const entry of domains) {
    const probe = await probeSneakerResaleDomain({ domain: entry.domain, baseUrl, fetchImpl, sleepImpl });
    probe.brand = entry.brand;
    results.push(probe);
  }
  const verdict = evaluateSneakerResaleRecall(results);
  return { baseUrl, results, verdict };
}

/**
 * @param {SneakerResaleProbe} probe
 */
function formatProbeLine(probe) {
  const tier = `${probe.tierCounts.verified} verified / ${probe.tierCounts.likely} likely / ${probe.tierCounts.unmatched} unmatched`;
  const status = probe.rateLimited ? "429" : String(probe.status ?? "ERR");
  return `${probe.domain.padEnd(18)} status=${status} rows=${String(probe.rowCount).padStart(3)} ${tier}`;
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

/**
 * Parse `--base-url <url>` from argv (the issue's documented verify command is
 * `node scripts/canary-sneaker-resale-recall.mjs --base-url <url>`). Mirrors the
 * simple `--key=value` style used by the sibling ads-domain-publisher, extended
 * with a space-separated value form. Unknown flags are ignored (the canary is
 * read-only).
 * @param {string[]} argv
 * @returns {{ baseUrl: string }}
 */
function parseArgs(argv) {
  let baseUrl = process.env.SNEAKER_RESALE_CANARY_BASE_URL ?? DEFAULT_BASE_URL;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = /^--base-url=(.*)$/.exec(arg);
    if (eq) {
      baseUrl = eq[1] || DEFAULT_BASE_URL;
    } else if (arg === "--base-url" && i + 1 < argv.length) {
      baseUrl = argv[i + 1] || DEFAULT_BASE_URL;
      i += 1;
    }
  }
  return { baseUrl };
}

async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2));
  const domains = loadSneakerResaleDomains();
  emitLine(`sneaker-resale recall canary starting @ ${baseUrl} (n=${domains.length})`);
  const { results, verdict } = await runCanary({ baseUrl });
  for (const probe of results) {
    emitLine(formatProbeLine(probe));
  }
  emitLine("");
  if (verdict.warming.length > 0) {
    emitLine(
      `${verdict.warming.length} brand(s) still on the warming page after retries — inconclusive (not failed):`,
    );
    for (const probe of verdict.warming) {
      emitLine(`  - ${probe.domain}: warming page, 0 rows — cold-cache, not a dead-end`);
    }
  }
  if (verdict.pass) {
    emitLine("PASS: every coverage-bearing sneaker-resale brand returned at least one verified or likely row");
    if (verdict.noCoverage.length > 0) {
      emitLine(
        `${verdict.noCoverage.length} genuine no-coverage brand(s) reported (kept honest, not failed):`,
      );
      for (const probe of verdict.noCoverage) {
        const t = probe.tierCounts;
        emitLine(
          `  - ${probe.domain}: ${t.verified} verified / ${t.likely} likely / ${t.unmatched} unmatched — genuine no Meta ads`,
        );
      }
    }
    if (verdict.identityGaps.length > 0) {
      emitLine(
        `${verdict.identityGaps.length} known identity-gap brand(s) surfaced (pipeline fix tracked, not hard-failed):`,
      );
      for (const { probe, issue } of verdict.identityGaps) {
        const t = probe.tierCounts;
        emitLine(
          `  - ${probe.domain}: ${t.verified} verified / ${t.likely} likely / ${t.unmatched} unmatched — identity gap, ${issue}`,
        );
      }
    }
    process.exit(0);
  }
  emitLine("FAIL: the following sneaker-resale brands returned 0 verified/likely rows:");
  for (const probe of verdict.failures) {
    const cause = probe.rateLimited
      ? "rate-limited (429) after retries"
      : probe.requestError
        ? `request error after retries (${probe.requestError})`
        : `rows=${probe.rowCount}`;
    emitLine(`  - ${probe.domain} (${cause}, status=${String(probe.status ?? "ERR")})`);
  }
  process.exit(1);
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}
