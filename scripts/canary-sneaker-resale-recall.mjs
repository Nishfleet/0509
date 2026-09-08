#!/usr/bin/env node
// Sneaker-resale seed-list recall guard (issue #1945).
//
// The sneaker-resale cluster is the strongest, most-consistent buyer signal
// across the daily market-signal reports (tracked 2026-08-25..2026-09-07),
// yet it had NO recall guard: `scripts/search-tier-canary.mjs` guards only the
// §1.8 six-domain set, and `data/seed-lists/sneaker-resale.json` (25 brands)
// drove no scheduled check at all. A silent recall/alias regression on the
// strongest cluster went unmeasured.
//
// This canary iterates the 25 seed-list brands, probes production
// `/search?q=<brand>&country=all` for each, and reports per-domain
// verified/likely/unmatched/total row counts. It fails loud (exit non-zero)
// when an expected-coverage brand dead-ends (warmed 0 rows) or returns
// blanket-unmatched (rows present, 0 verified/likely) — a silent recall on the
// cluster. It is the measurement + verdict guard the issue asks for.
//
// It reuses `parseSearchResponseHtml` (so tier-count parsing stays in one
// place with the BET 2 verifier / search-tier canary) and the same 429
// retry/backoff the search-tier canary uses. It additionally paces requests
// through the same sliding-window rate limiter the BET 2 verifier uses, so a
// 25-brand run never blows the anonymous /search budget (20 req / 10 min / IP)
// on its own volume.
//
// Two data-driven carve-outs keep the guard honest without masking regressions:
//   - KNOWN_ALIAS_GAPS: a domain whose ads genuinely land on rows but whose
//     identity resolver cannot yet connect them to a verified/likely tier is
//     an identity-resolution gap, not a recall regression. Blanket-unmatched
//     for a known-gap domain is a WARNING (tracked by the named issue), never
//     a dead-end. A warmed 0-row result for a known-gap domain STILL fails —
//     an alias gap never empties the page.
//   - GENUINE_NO_ADS: a brand that provably runs no Meta ads (its warmed
//     `/search` returns a real empty state) is reported as no-coverage, not a
//     dead-end failure — the honest "not evidence of inactivity" state. We
//     never force a page for a brand with no genuine coverage.

import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseRetryAfterMs, parseSearchResponseHtml } from "./bet2-live-verification.mjs";
import {
  createRateLimiter,
  SEARCH_RATE_LIMIT_MAX,
  SEARCH_RATE_LIMIT_WINDOW_MS,
} from "./bet2-live-verification.mjs";

export const DEFAULT_BASE_URL = "https://0509.io";
export const SNEAKER_RESALE_CANARY_USER_AGENT = "0509-sneaker-resale-recall/1.0";

// Path to the seed list, resolved relative to this script's directory.
export const SEED_LIST_PATH = "data/seed-lists/sneaker-resale.json";

// --- warm / 429 handling (same semantics as search-tier-canary.mjs) --------
// A cold domain can return a warming page (0 rows, "Search in progress") on
// the first hit. A warming page is NOT a dead-end (bet2's isDeadEnd treats a
// warming empty page as false) — it is a transient state, so a bounded retry
// clears it without burning the anonymous budget on 35 s polls.
export const WARMING_RETRY_LIMIT = 1;
export const WARMING_RETRY_DELAY_MS = 5_000;

export const SEARCH_429_RETRY_LIMIT = 3;
export const SEARCH_429_DEFAULT_WAIT_MS = 60_000;

// --- the classification (issue #1945 accept bullet 2) ----------------------
// These two sets encode the live classification of the 5 brands that had no
// `/ads/:domain` page on 2026-09-07. They are data, not logic: a brand moves
// between sets only on fresh evidence (the canary output + provider probe),
// exactly as the issue requires. Remove/reclassify the moment the underlying
// state changes:
//
//   goat.com / on.com / solesavy.com — the warm search returns real rows
//   (`N ads found`) but every row resolves Unmatched (no verified/likely).
//   That is an identity-resolution gap: coverage EXISTS, the tier resolver
//   cannot connect it to the brand keyword. Tracked by the follow-up issue;
//   blanket-unmatched for these is a WARNING, not a dead-end.
//
//   reebok.com / sneakerping.com — the warm search returns a genuine empty
//   state (`0 ads found`, not warming). These brands run no discoverable Meta
//   ads on the current identity; forcing a page for them would be dishonest.
//   They are reported as no-coverage and never fail the canary.
export const KNOWN_ALIAS_GAPS = Object.freeze(
  new Map([
    ["goat.com", "Nishfleet/0509#1982"],
    ["on.com", "Nishfleet/0509#1982"],
    ["solesavy.com", "Nishfleet/0509#1982"],
  ]),
);

export const GENUINE_NO_ADS = Object.freeze(
  new Map([
    ["reebok.com", "no Meta ad coverage found by warm /search probe (2026-09-08)"],
    ["sneakerping.com", "no Meta ad coverage found by warm /search probe (2026-09-08)"],
  ]),
);

/**
 * @typedef {Object} SeedBrand
 * @property {string} domain
 * @property {string} brand
 */

/**
 * Read the sneaker-resale seed list from the repo. Resolved relative to this
 * script so it works from any CWD (the systemd timer runs a fixed WorkingDirectory).
 * @returns {Promise<SeedBrand[]>}
 */
export async function loadSeedList() {
  const { readFile } = await import("node:fs/promises");
  const seedPath = fileURLToPath(new URL(`../${SEED_LIST_PATH}`, import.meta.url));
  const raw = await readFile(seedPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.domains)) {
    throw new Error(`seed list ${SEED_LIST_PATH} is missing a "domains" array`);
  }
  const brands = parsed.domains.map((entry) => {
    if (typeof entry?.domain !== "string" || typeof entry?.brand !== "string") {
      throw new Error(`seed list entry missing domain/brand: ${JSON.stringify(entry)}`);
    }
    return { domain: entry.domain, brand: entry.brand };
  });
  return brands;
}

/**
 * @typedef {Object} SnkProbe
 * @property {string} domain
 * @property {string} brand
 * @property {number | null} status
 * @property {number} rowCount
 * @property {{ verified: number; likely: number; unmatched: number }} tierCounts
 * @property {string | null} headline
 * @property {boolean} isWarming
 * @property {boolean} [rateLimited]
 * @property {"covered"|"no_coverage"|"known_gap"|"dead_end"|"blanket_unmatched"|"warming"|"rate_limited"|"request_error"} category
 * @property {string | null} [issue]
 */

/**
 * Probe one seed-list brand against production /search.
 * @param {{
 *   brand: string,
 *   domain: string,
 *   baseUrl: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   rateLimiter?: { acquire: () => Promise<void> },
 *   warmingRetryLimit?: number,
 *   warmingRetryDelayMs?: number,
 *   max429Retries?: number,
 * }} input
 * @returns {Promise<SnkProbe>}
 */
export async function probeBrand({
  brand,
  domain,
  baseUrl,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  rateLimiter,
  warmingRetryLimit = WARMING_RETRY_LIMIT,
  warmingRetryDelayMs = WARMING_RETRY_DELAY_MS,
  max429Retries = SEARCH_429_RETRY_LIMIT,
}) {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", brand);
  url.searchParams.set("country", "all");

  let lastParsed = null;
  let lastStatus = null;
  let rateLimitHits = 0;
  let warmingAttempts = 0;
  while (true) {
    if (rateLimiter) {
      await rateLimiter.acquire();
    }
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
        brand,
        status: null,
        rowCount: 0,
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        headline: null,
        isWarming: false,
        requestError: error instanceof Error ? error.message : String(error),
        category: "request_error",
        issue: null,
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
          brand,
          status: 429,
          rowCount: 0,
          tierCounts: { verified: 0, likely: 0, unmatched: 0 },
          headline: null,
          isWarming: false,
          rateLimited: true,
          category: "rate_limited",
          issue: null,
        };
      }
      await sleepImpl(parseRetryAfterMs(retryAfterHeader, SEARCH_429_DEFAULT_WAIT_MS));
      continue;
    }
    const html = await response.text();
    lastParsed = parseSearchResponseHtml(html);
    // A warming page with no rows yet: retry up to the limit before calling
    // it. A populated page (rows present) is final.
    if (!lastParsed.isWarming || lastParsed.rowCount > 0) {
      break;
    }
    if (warmingAttempts >= warmingRetryLimit) {
      break;
    }
    warmingAttempts += 1;
    await sleepImpl(warmingRetryDelayMs);
  }

  const tierCounts = lastParsed?.tierCounts ?? { verified: 0, likely: 0, unmatched: 0 };
  const rowCount = lastParsed?.rowCount ?? 0;
  const isWarming = lastParsed?.isWarming ?? false;
  const headline = lastParsed?.headline ?? null;

  const covered = tierCounts.verified + tierCounts.likely > 0;
  let category;
  if (covered) {
    category = "covered";
  } else if (isWarming && rowCount === 0) {
    // Retries exhausted on a warming page: transient, not a dead-end.
    category = "warming";
  } else if (rowCount === 0) {
    // Warmed real empty state. Genuine-no-ads is honest no-coverage; anything
    // else is a dead-end regression.
    category = GENUINE_NO_ADS.has(domain) ? "no_coverage" : "dead_end";
  } else {
    // Rows present but all Unmatched. Known alias gap warns; anything else is
    // a blanket-unmatched regression.
    category = KNOWN_ALIAS_GAPS.has(domain) ? "known_gap" : "blanket_unmatched";
  }

  return {
    domain,
    brand,
    status: lastStatus,
    rowCount,
    tierCounts,
    headline,
    isWarming,
    category,
    issue: KNOWN_ALIAS_GAPS.get(domain),
  };
}

/**
 * @typedef {Object} SnkVerdict
 * @property {boolean} pass
 * @property {SnkProbe[]} failures
 * @property {{ probe: SnkProbe, issue: string }[]} knownGaps
 * @property {SnkProbe[]} noCoverage
 * @property {SnkProbe[]} covered
 * @property {SnkProbe[]} warming
 */

/**
 * Classify the batch of probes into the canary verdict.
 * @param {SnkProbe[]} results
 * @returns {SnkVerdict}
 */
export function evaluateSneakerResale(results) {
  const failures = [];
  const knownGaps = [];
  const noCoverage = [];
  const covered = [];
  const warming = [];
  for (const probe of results) {
    switch (probe.category) {
      case "covered":
        covered.push(probe);
        break;
      case "no_coverage":
        noCoverage.push(probe);
        break;
      case "known_gap":
        knownGaps.push({ probe, issue: probe.issue ?? "Nishfleet/0509#1982" });
        break;
      case "warming":
        warming.push(probe);
        break;
      case "request_error":
      case "rate_limited":
      case "dead_end":
      case "blanket_unmatched":
        failures.push(probe);
        break;
      default:
        failures.push(probe);
    }
  }
  return {
    pass: failures.length === 0,
    failures,
    knownGaps,
    noCoverage,
    covered,
    warming,
  };
}

/**
 * @param {{
 *   baseUrl?: string,
 *   seedList?: SeedBrand[],
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   pacingEnabled?: boolean,
 * }} [input]
 * @returns {Promise<{ baseUrl: string, results: SnkProbe[], verdict: SnkVerdict }>}
 */
export async function runCanary({
  baseUrl = DEFAULT_BASE_URL,
  seedList,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  pacingEnabled = true,
} = {}) {
  const brands = seedList ?? await loadSeedList();
  const rateLimiter = pacingEnabled
    ? createRateLimiter({
        sleepImpl,
        maxRequests: SEARCH_RATE_LIMIT_MAX,
        windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
      })
    : undefined;
  const results = [];
  for (const { domain, brand } of brands) {
    results.push(await probeBrand({
      brand,
      domain,
      baseUrl,
      fetchImpl,
      sleepImpl,
      rateLimiter,
    }));
  }
  const verdict = evaluateSneakerResale(results);
  return { baseUrl, results, verdict };
}

/**
 * @param {number} ms
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {SnkProbe} probe
 */
function formatProbeLine(probe) {
  const t = probe.tierCounts;
  const tier = `${t.verified} verified / ${t.likely} likely / ${t.unmatched} unmatched`;
  const status = probe.rateLimited ? "429" : String(probe.status ?? "ERR");
  const tag = probe.category.padEnd(16);
  return `${probe.domain.padEnd(18)} status=${status} rows=${String(probe.rowCount).padStart(3)} ${tier}  [${tag}]`;
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
  const pacingEnabled = !process.argv.includes("--no-pace");

  emitLine(`sneaker-resale recall canary starting @ ${baseUrl} (n=${(await loadSeedList()).length}${pacingEnabled ? ", paced" : ""})`);
  const { results, verdict } = await runCanary({ baseUrl, pacingEnabled });

  emitLine(`sneaker-resale recall canary starting @ ${baseUrl} (n=${results.length})`);
  for (const probe of results) {
    emitLine(formatProbeLine(probe));
  }
  emitLine("");
  emitLine(
    `summary: ${verdict.covered.length} covered, ${verdict.noCoverage.length} no-coverage, ` +
      `${verdict.knownGaps.length} known-alias-gap, ${verdict.warming.length} warming, ` +
      `${verdict.failures.length} FAIL`,
  );

  if (verdict.knownGaps.length > 0) {
    emitLine("");
    emitLine("known alias gaps warned (identity resolution, not a recall regression):");
    for (const gap of verdict.knownGaps) {
      const t = gap.probe.tierCounts;
      emitLine(
        `  - ${gap.probe.domain}: ${t.verified} verified / ${t.likely} likely / ${t.unmatched} unmatched — tracked by ${gap.issue}`,
      );
    }
  }

  if (!verdict.pass) {
    emitLine("");
    emitLine("FAIL: the following seed-list brands failed the recall guard:");
    for (const probe of verdict.failures) {
      const cause = probe.category === "rate_limited"
        ? "rate-limited (429) after retries"
        : probe.category === "request_error"
          ? `request error: ${probe.requestError}`
          : probe.category === "dead_end"
            ? `dead-end (0 rows, warmed)`
            : `blanket-unmatched (rows=${probe.rowCount}, 0 verified/likely)`;
      emitLine(`  - ${probe.domain} (${probe.brand}) — ${cause}, status=${String(probe.status ?? "ERR")}`);
    }
    process.exit(1);
  }

  emitLine("");
  if (verdict.warming.length === 0 && verdict.noCoverage.length === 0 && verdict.knownGaps.length === 0) {
    emitLine("PASS: every sneaker-resale seed-list brand returned at least one verified or likely row");
  } else {
    const notes = [];
    if (verdict.noCoverage.length > 0) {
      notes.push(`${verdict.noCoverage.length} genuinely-no-ads brand(s) reported as no-coverage (not evidence of inactivity)`);
    }
    if (verdict.knownGaps.length > 0) {
      notes.push(`${verdict.knownGaps.length} known alias gap(s) warned`);
    }
    if (verdict.warming.length > 0) {
      notes.push(`${verdict.warming.length} brand(s) left warming after retries (transient, not a dead-end)`);
    }
    emitLine(`PASS: 0 dead-ends and 0 blanket-unmatched among expected-coverage brands; ${notes.join("; ")}`);
  }
  process.exit(0);
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}