#!/usr/bin/env node
// Time-to-first-visible-card /search gate (issue #2032).
//
// The issue's metric is: "p95 time-to-first-visible result card on /search
// under 5 s for uncached domains, measured on the §1.8 six-domain set
// (gymshark, hubspot, ridge, allbirds, notion, oura)."
//
// The BET 2 progressive-streaming product work (#1471 / #1482 / #951) already
// paints the synchronous tier + a real "N verified · checking" progress state
// on the first cold payload, so the product acceptance is met. What this gate
// closes is the issue's verify/termination contract: a script that measures
// first-card paint on exactly the six-domain set it pins and fails the run
// (non-zero exit) when p95 first-card >= 5 s, so the metric has a real,
// reproducible verdict instead of a hopefull curl smoke floor.
//
// It reuses the probe machinery from bet2-live-verification.mjs verbatim
// (runLiveVerification, evaluateTermination, formatProbeLine, createRateLimiter,
// the rate limiter, parseSearchResponseHtml) — no parallel parser, no second
// limiter. The only new code is the six-domain cohort constant and the focused
// termination wrapper.
//
// Measure caveats (same as every sibling probe): this measures the SSR HTML
// stream's first row byte, not a literal browser paint, and proxy/CDN caching
// means it cannot guarantee a cold uncached query — it is the metric's real,
// reproducible detector, not a literal gold-button press. With n=6 samples the
// nearest-rank p95 is the maximum, so the gate effectively requires all six
// pinned domains under the ceiling — the conservative reading of a tail metric.
//
// Two verdict checks: `p95_first_card_at_or_below_ceiling` (the issue's metric)
// plus `six_domains_sampled` — a subscription guard that refuses to PASS an
// under-sampled window (a 429/5xx/warming domain drops its first-card sample).
//
// Terminology (accept):
//   node scripts/measure-search-ttfb.mjs
//   # Expected: p95_first_card_ms < 5000 over the six-domain §1.8 set.
//   # Exits non-zero when the p95 first-card ceiling trips.
//
// This script is measurement AND verdict: it exits non-zero when the p95
// first-card check trips (or the six-domain subscription is under-sampled), so
// a scheduled run (the provisioned timer / CI) fails loud. Anonymous /search is
// 20 req / 10 min / IP, so every call goes through the same sliding-window
// limiter as bet2-live-verification.mjs.
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_SPACING_MS,
  createRateLimiter,
  evaluateTermination,
  formatProbeLine,
  runLiveVerification,
  summarizeResults,
} from "./bet2-live-verification.mjs";

// The §1.8 six-domain metric set (issue #2032): the exact cohort the issue
// pins the latency metric to. Distinct from BET2_DOMAINS (25) and
// SECTION_1_8_RERUN (7, adds mamaearth.com) — this is the issue's chose set.
export const MEASURE_TTFB_DOMAINS = Object.freeze([
  "gymshark.com",
  "hubspot.com",
  "ridge.com",
  "allbirds.com",
  "notion.so",
  "oura.com",
]);

// The metric's p95 first-card ceiling (issue: "under 5 s").
export const TTFB_P95_CEILING_MS = 5_000;

// Own user-agent so prod logs tell this gate apart from the canaries.
export const SEARCH_TTFB_USER_AGENT = "0509-search-ttfb/1.0";

/**
 * Focused termination for the issue #2032 metric. Unlike the streaming canary
 * this gate is ONLY the first-card-paint assertion the metric names — dead-end
 * and verified-share are product-recall concerns covered by #2024/#1858, not
 * the perceived-latency metric here. It admits two checks:
 *
 *   - `p95_first_card_at_or_below_ceiling` from the shared `evaluateTermination`
 *     (p95 null => fail), and
 *   - `six_domains_sampled` — a subscription guard: the gate must FAIL if any
 *     pinned domain produced NO first-card sample (a 429/5xx/warming outcome
 *     drops its `firstCardAtMs` from `summarizeResults`). `sampledCount` is the
 *     number of probed domains that actually painted a first card; when it is
 *     below the six-domain cohort the p95 of whatever survived is meaningless,
 *     so the gate refuses to pass on an under-subscribed window.
 *
 * @param {ReturnType<typeof summarizeResults>} summary
 * @param {{ p95CeilingMs?: number, sampledCount?: number }} [thresholds]
 * @returns {{ pass: boolean, checks: Array<{ name: string, ok: boolean, observed: unknown, threshold: number | null, detail: string }> }}
 */
export function evaluateTtfbTermination(summary, thresholds = {}) {
  const p95Ceiling = thresholds.p95CeilingMs ?? TTFB_P95_CEILING_MS;
  const sampledCount = thresholds.sampledCount ?? summary.total;
  const full = evaluateTermination(summary, {
    p95FirstCardCeilingMs: p95Ceiling,
  });
  const byName = new Map(full.checks.map((check) => [check.name, check]));
  const p95check = byName.get("p95_first_card_at_or_below_ceiling");
  if (!p95check) {
    throw new Error(
      "evaluateTermination did not produce check \"p95_first_card_at_or_below_ceiling\"",
    );
  }
  const sampledCheck = {
    name: "six_domains_sampled",
    ok: sampledCount >= MEASURE_TTFB_DOMAINS.length,
    observed: sampledCount,
    threshold: MEASURE_TTFB_DOMAINS.length,
    detail: `first-card samples: ${sampledCount}/${MEASURE_TTFB_DOMAINS.length}`,
  };
  return {
    pass: p95check.ok && sampledCheck.ok,
    checks: [p95check, sampledCheck],
  };
}

/**
 * Run the six-domain TTFB gate. Reuses `runLiveVerification` verbatim — the
 * same probe, parser, and rate limiter as the BET 2 canary.
 *
 * @param {{
 *   domains?: readonly string[],
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   requestSpacingMs?: number,
 *   userAgent?: string,
 *   paceRequests?: boolean,
 *   onResult?: (probe: import("./bet2-live-verification.mjs").ProbeResult, index: number, total: number) => void,
 *   beforeRequest?: () => Promise<void> | void,
 * }} [input]
 * @returns {Promise<{ run: import("./bet2-live-verification.mjs").RunResult, verdict: ReturnType<typeof evaluateTtfbTermination> }>}
 */
export async function runSearchTtfb(input = {}) {
  const domains = input.domains ?? MEASURE_TTFB_DOMAINS;
  const run = await runLiveVerification({
    domains,
    baseUrl: input.baseUrl ?? DEFAULT_BASE_URL,
    fetchImpl: input.fetchImpl,
    sleepImpl: input.sleepImpl,
    nowImpl: input.nowImpl,
    requestSpacingMs: input.requestSpacingMs ?? DEFAULT_REQUEST_SPACING_MS,
    userAgent: input.userAgent ?? SEARCH_TTFB_USER_AGENT,
    // Default to pace=true (internal limiter built by runLiveVerification) so
    // a caller that forgets `beforeRequest` still throttles to the anonymous
    // /search budget — mirroring the sibling runSearchStreamCanary. The CLI's
    // main() overrides to the shared external limiter it already acquired.
    paceRequests: input.paceRequests ?? true,
    onResult: input.onResult,
    beforeRequest: input.beforeRequest,
  });
  // Count the domains that actually painted a first card (status 200 with a
  // firstCardAtMs) so the subscription guard can refuse an under-sampled
  // window where 429/5xx/warming dropped pinned domains from the metric.
  const sampledCount = run.results.filter(
    (r) => r.status === 200 && r.firstCardAtMs !== null,
  ).length;
  const verdict = evaluateTtfbTermination(run.summary, { sampledCount });
  return { run, verdict };
}

/**
 * @param {{ run: import("./bet2-live-verification.mjs").RunResult, verdict: ReturnType<typeof evaluateTtfbTermination> }} input
 * @returns {string[]}
 */
export function formatTtfbSummary({ run, verdict }) {
  const lines = [];
  lines.push(`search TTFB gate @ ${run.baseUrl}`);
  lines.push(
    `  domains=${run.summary.total}  p95_first_card_ms=${
      run.summary.p95FirstCard === null
        ? "no_samples"
        : run.summary.p95FirstCard.toFixed(0)
    }  ceiling=${TTFB_P95_CEILING_MS}ms  warming=${run.summary.warmingDomains}  errors=${run.summary.errorDomains}`,
  );
  lines.push("");
  lines.push("TTFB termination checks:");
  for (const check of verdict.checks) {
    lines.push(
      `  ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`,
    );
  }
  return lines;
}

/**
 * Unbuffered stdout so a piped long run is not silent until exit.
 * @param {string} line
 */
function emitLine(line) {
  writeSync(1, `${line}\n`);
}

/**
 * @param {string[]} argv
 * @returns {{ baseUrl?: string, spacingMs?: number, json?: boolean, help?: boolean }}
 */
function parseCliArgs(argv) {
  /** @type {{ baseUrl?: string, spacingMs?: number, json?: boolean, help?: boolean }} */
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--base-url" || arg === "--baseUrl") {
      parsed.baseUrl = argv[++i];
    } else if (arg === "--spacing-ms" || arg === "--spacingMs") {
      parsed.spacingMs = Number(argv[++i]);
    } else if (arg.startsWith("--base-url=")) {
      parsed.baseUrl = arg.slice("--base-url=".length);
    } else if (arg.startsWith("--spacing-ms=")) {
      parsed.spacingMs = Number(arg.slice("--spacing-ms=".length));
    }
  }
  return parsed;
}

function printHelp() {
  emitLine("Usage: node scripts/measure-search-ttfb.mjs [-- --base-url=URL] [-- --json] [-- --spacing-ms=N]");
  emitLine("");
  emitLine("Search time-to-first-visible-card gate (issue #2032). Probes the six-domain");
  emitLine("§1.8 metric set (gymshark, hubspot, ridge, allbirds, notion, oura) against");
  emitLine("/search and asserts p95 first-card paint < 5s. Exits non-zero when the");
  emitLine("p95 first-card ceiling trips.");
  emitLine("");
  emitLine("Options:");
  emitLine("  --base-url=URL     Base URL to probe (default: https://0509.io).");
  emitLine("  --spacing-ms=N     Inter-domain request spacing in ms (default 0).");
  emitLine("  --json             Emit a JSON_REPORT_BEGIN/END block with the probe set.");
  emitLine("  --help, -h         Show this help and exit.");
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const baseUrl = args.baseUrl ?? DEFAULT_BASE_URL;
  const spacingMs = args.spacingMs ?? DEFAULT_REQUEST_SPACING_MS;
  emitLine(
    `search TTFB gate starting @ ${baseUrl} (n=${MEASURE_TTFB_DOMAINS.length}, spacing=${spacingMs}ms)`,
  );
  // One limiter for the whole cohort so the 20 req / 10 min / IP anonymous
  // /search budget is shared across the six probes (and any warming polls).
  // Acquire happens BEFORE the first-card clock starts, so queue time is not
  // counted as product latency — the same convention as bet2-live-verification.
  const limiter = createRateLimiter();
  const { run, verdict } = await runSearchTtfb({
    baseUrl,
    requestSpacingMs: spacingMs,
    beforeRequest: () => limiter.acquire(),
    onResult: (probe, index, total) => {
      emitLine(formatProbeLine(probe, index, total));
    },
  });
  emitLine("");
  for (const line of formatTtfbSummary({ run, verdict })) {
    emitLine(line);
  }
  if (args.json) {
    emitLine("");
    emitLine("JSON_REPORT_BEGIN");
    emitLine(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseUrl,
          cohort: MEASURE_TTFB_DOMAINS,
          results: run.results,
          summary: run.summary,
          termination: {
            pass: verdict.pass,
            checks: verdict.checks,
          },
        },
        null,
        2,
      ),
    );
    emitLine("JSON_REPORT_END");
  }
  process.exit(verdict.pass ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((error) => {
    emitLine(
      `search TTFB gate fatal: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }`,
    );
    process.exit(1);
  });
}