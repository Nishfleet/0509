#!/usr/bin/env node
// Sneaker-resale seed-list recall guard (issue #1945).
//
// The sneaker-resale cluster is the strongest, most-consistent buyer signal
// across the daily market reports (tracked across 7 consecutive daily reports,
// 2026-08-25..2026-09-07). Its 25 seed-list brands must each render >=1
// verified/likely row on a bare /search probe, or the /ads/:domain page cannot
// publish and the brand dead-ends in the free preview. The existing
// search-tier-canary guards only the §1.8 six-domain set and is not scheduled;
// the seed-list cluster that drives the market signal had no recall guard at
// all, so a silent recall/alias regression on the strongest cluster went
// unmeasured.
//
// This canary iterates the 25 `data/seed-lists/sneaker-resale.json` domains,
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
// A brand NOT in this set that dead-ends (0 rows) or blanket-unmatches is a
// recall/alias regression and fails the canary. This set is the classification
// output of issue #1945: each entry was probed and confirmed to have no
// verified/likely Meta coverage on the live search surface. Remove an entry
// the moment the brand starts running Meta ads (or the identity gap is fixed)
// so a real future regression on that brand is not silently masked.
export const KNOWN_NO_COVERAGE = Object.freeze(new Set([]));

// A cold domain can return a warming page (0 rows) on the first hit. The
// canary retries once after a short wait to clear the transient warming state
// without burning the anonymous /search budget (20 req / 10 min / IP).
export const WARMING_RETRY_LIMIT = 1;
export const WARMING_RETRY_DELAY_MS = 5_000;

// Anonymous /search is 20 requests per 10 minutes per IP. The canary makes 25
// requests (one per domain), so a scheduled run can collide with other search
// canaries on the same runner IP; a 429 is retried with the same backoff the
// BET 2 verifier uses rather than treated as a dead-end.
export const SEARCH_429_RETRY_LIMIT = 3;
export const SEARCH_429_DEFAULT_WAIT_MS = 60_000;

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
  const list = JSON.parse(raw);
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
}) {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("website", domain);
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
          "user-agent": SNEAKER_RESALE_CANARY_USER_AGENT,
          "cache-control": "no-cache",
          pragma: "no-cache",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return {
        domain,
        brand: domain,
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
 * @returns {{
 *   pass: boolean,
 *   failures: SneakerResaleProbe[],
 *   noCoverage: SneakerResaleProbe[],
 * }}
 */
export function evaluateSneakerResaleRecall(results) {
  const failures = [];
  const noCoverage = [];
  for (const probe of results) {
    if (probe.tierCounts.verified + probe.tierCounts.likely > 0) {
      continue;
    }
    // 0 verified/likely. A known genuine-no-ads brand is reported as
    // no-coverage and does not fail — the honest "not evidence of inactivity"
    // copy, no page. A persistent 429 (rowCount 0, rateLimited) is never a
    // no-coverage verdict: the run could not confirm the domain, so it fails.
    if (KNOWN_NO_COVERAGE.has(probe.domain)) {
      noCoverage.push(probe);
      continue;
    }
    // A dead-end (0 rows, not warming) is always a failure — the guard's core
    // promise is "0 dead-end empty states". A blanket-unmatched page (rows
    // present but all Unmatched) is also a failure: the brand's ads are not
    // being connected to its domain, so the /ads/:domain page cannot publish.
    failures.push(probe);
  }
  return { pass: failures.length === 0, failures, noCoverage };
}

/**
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} [input]
 * @returns {Promise<{ baseUrl: string, results: SneakerResaleProbe[], verdict: { pass: boolean, failures: SneakerResaleProbe[], noCoverage: SneakerResaleProbe[] } }>}
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

async function main() {
  const baseUrl = process.env.SNEAKER_RESALE_CANARY_BASE_URL ?? DEFAULT_BASE_URL;
  const domains = loadSneakerResaleDomains();
  emitLine(`sneaker-resale recall canary starting @ ${baseUrl} (n=${domains.length})`);
  const { results, verdict } = await runCanary({ baseUrl });
  for (const probe of results) {
    emitLine(formatProbeLine(probe));
  }
  emitLine("");
  if (verdict.pass) {
    if (verdict.noCoverage.length === 0) {
      emitLine("PASS: every sneaker-resale seed-list brand returned at least one verified or likely row");
    } else {
      emitLine(
        `PASS: every coverage-bearing brand returned rows (0 dead-ends); ${verdict.noCoverage.length} genuine no-coverage brand(s) reported, not failed:`,
      );
      for (const probe of verdict.noCoverage) {
        const t = probe.tierCounts;
        emitLine(
          `  - ${probe.domain}: ${t.verified} verified / ${t.likely} likely / ${t.unmatched} unmatched — genuine no Meta ads`,
        );
      }
    }
    process.exit(0);
  }
  emitLine("FAIL: the following sneaker-resale brands returned 0 verified/likely rows:");
  for (const probe of verdict.failures) {
    const cause = probe.rateLimited
      ? "rate-limited (429) after retries"
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
