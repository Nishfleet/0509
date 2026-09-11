#!/usr/bin/env node
// d1-budget: reads=2000 writes=0 runs_per_day=1
// Streaming /search canary (issue #1858, accept #4).
//
// The /search loader streams results via the warming + revalidation path
// (issue #951 / #1482 / #1851): the first SSR payload paints the synchronous
// tier (cached/partial verified rows) and the client poll appends the rest as
// labelled likely/unmatched rows. This canary is the verdict gate that proves
// that streaming reaches a visitor on the 25 mixed BET 2 domains:
//
//   p95_first_card_ms < 5000   — the first visible row lands inside the 5s
//                                budget across the cohort (issue §3.5 Q4).
//   dead_end_count = 0         — no recognizable brand renders a bare
//                                "No verified ads found" empty page; the
//                                three-tier model renders its candidates
//                                instead (issue §1.8 / §3.4 BET 2).
//   verified_share >= 0.8      — at least 80% of the cohort resolves a
//                                verified row, the precision bar the
//                                verified-domain post-filter keeps.
//
// It reuses the probe machinery from bet2-live-verification.mjs verbatim
// (runLiveVerification, summarizeResults, evaluateTermination, the rate
// limiter, parseSearchResponseHtml) — no parallel parser, no second limiter.
// The only new code is the focused streaming termination and its CLI.
//
// Termination (issue #1858 verify block):
//   npm run canary:search-stream
//   # Expected output: p95_first_card_ms < 5000, dead_end_count = 0,
//   #                  verified_share >= 0.8
//
// This script is measurement AND verdict: it exits non-zero when any of the
// three streaming checks trips, so a scheduled run (GitHub Actions cron) fails
// loud. Anonymous /search is 20 req / 10 min / IP, so every call goes through
// the same sliding-window limiter as bet2-live-verification.mjs.

import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BET2_DOMAINS,
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_SPACING_MS,
  DEFAULT_USER_AGENT,
  createRateLimiter,
  evaluateTermination,
  formatProbeLine,
  runLiveVerification,
  summarizeResults,
} from "./bet2-live-verification.mjs";

// The 25 mixed domains (DTC US/EU/IN + B2B US/EU/IN) from BET2_DOMAINS — the
// same cohort search-latency-probe.mjs and bet2-live-verification.mjs use, so
// the streaming bar is measured over the identical set the latency probe
// already records p95 for.
export const STREAM_CANARY_DOMAINS = Object.freeze([...BET2_DOMAINS]);

export const STREAM_P95_CEILING_MS = 5_000;
export const STREAM_VERIFIED_SHARE_FLOOR = 0.8;
export const SEARCH_STREAM_CANARY_USER_AGENT = "0509-search-stream-canary/1.0";

/**
 * The focused streaming termination (issue #1858 verify block). Reuses
 * `evaluateTermination` for the check semantics (p95 null handling,
 * verified_share rounding, dead-end counting) and surfaces the three named
 * metrics — `p95_first_card_ms`, `dead_end_count`, `verified_share` — as the
 * verdict. The extra bet2 hardening checks (rate-limit / error / demo-sourced
 * probes) are returned separately as informational: an errored or rate-limited
 * probe is already a dead-end (`isDeadEnd` is true when rowCount === 0), so it
 * fails `zero_dead_ends`; demo-sourced probes have rows and are surfaced as a
 * warning rather than failing the streaming contract on their own.
 *
 * @typedef {ReturnType<typeof summarizeResults>} StreamSummary
 * @param {StreamSummary} summary
 * @param {{ p95FirstCardCeilingMs?: number, verifiedShareFloor?: number }} [thresholds]
 * @returns {{ pass: boolean, checks: Array<{ name: string, ok: boolean, observed: unknown, threshold: unknown, detail: string }>, metrics: { p95_first_card_ms: number | null, dead_end_count: number, verified_share: number, total_domains: number }, warnings: Array<{ name: string, ok: boolean, observed: unknown, detail: string }> }}
 */
export function evaluateStreamTermination(summary, thresholds = {}) {
  const p95Ceiling = thresholds.p95FirstCardCeilingMs ?? STREAM_P95_CEILING_MS;
  const verifiedFloor =
    thresholds.verifiedShareFloor ?? STREAM_VERIFIED_SHARE_FLOOR;
  const full = evaluateTermination(summary, {
    p95FirstCardCeilingMs: p95Ceiling,
    verifiedShareFloor: verifiedFloor,
  });
  const byName = new Map(full.checks.map((check) => [check.name, check]));
  /** @param {string} name */
  const pick = (name) => {
    const check = byName.get(name);
    if (!check) {
      throw new Error(`evaluateTermination did not produce check "${name}"`);
    }
    return check;
  };
  const checks = [
    pick("p95_first_card_at_or_below_ceiling"),
    pick("zero_dead_ends"),
    pick("verified_share_at_or_above_floor"),
  ];
  const warnings = [
    pick("no_rate_limit_blocks"),
    pick("no_error_probes"),
    pick("no_demo_sourced_probes"),
  ].map((check) => ({
    name: check.name,
    ok: check.ok,
    observed: check.observed,
    detail: check.detail,
  }));
  return {
    pass: checks.every((check) => check.ok),
    checks,
    metrics: {
      p95_first_card_ms: summary.p95FirstCard,
      dead_end_count: summary.deadEnds,
      verified_share: summary.verifiedShare,
      total_domains: summary.total,
    },
    warnings,
  };
}

/**
 * Run the streaming canary over a domain cohort. Reuses `runLiveVerification`
 * verbatim — the same probe, parser, and rate limiter as the BET 2 canary.
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
 * @returns {Promise<{ run: import("./bet2-live-verification.mjs").RunResult, verdict: ReturnType<typeof evaluateStreamTermination> }>}
 */
export async function runSearchStreamCanary(input = {}) {
  const domains = input.domains ?? STREAM_CANARY_DOMAINS;
  const run = await runLiveVerification({
    domains,
    baseUrl: input.baseUrl ?? DEFAULT_BASE_URL,
    fetchImpl: input.fetchImpl,
    sleepImpl: input.sleepImpl,
    nowImpl: input.nowImpl,
    requestSpacingMs: input.requestSpacingMs ?? DEFAULT_REQUEST_SPACING_MS,
    userAgent: input.userAgent ?? SEARCH_STREAM_CANARY_USER_AGENT,
    paceRequests: input.paceRequests ?? true,
    onResult: input.onResult,
    beforeRequest: input.beforeRequest,
  });
  const verdict = evaluateStreamTermination(run.summary);
  return { run, verdict };
}

/**
 * @param {{ run: import("./bet2-live-verification.mjs").RunResult, verdict: ReturnType<typeof evaluateStreamTermination> }} input
 * @returns {string[]}
 */
export function formatStreamSummary({ run, verdict }) {
  const lines = [];
  lines.push(`search-stream canary @ ${run.baseUrl}`);
  lines.push(
    `  domains=${verdict.metrics.total_domains}  p95_first_card_ms=${
      verdict.metrics.p95_first_card_ms === null
        ? "no_samples"
        : verdict.metrics.p95_first_card_ms.toFixed(0)
    }  dead_end_count=${verdict.metrics.dead_end_count}  verified_share=${(verdict.metrics.verified_share * 100).toFixed(1)}%`,
  );
  lines.push("");
  lines.push("Streaming termination checks:");
  for (const check of verdict.checks) {
    lines.push(`  ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
  const trippedWarnings = verdict.warnings.filter((w) => !w.ok);
  if (trippedWarnings.length > 0) {
    lines.push("");
    lines.push("Informational warnings (not verdict-affecting):");
    for (const warning of trippedWarnings) {
      lines.push(`  WARN ${warning.name}: ${warning.detail}`);
    }
  }
  return lines;
}

/**
 * Unbuffered stdout so a piped long canary is not silent until exit.
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
  emitLine("Usage: npm run canary:search-stream [-- --base-url=URL] [-- --json] [-- --spacing-ms=N]");
  emitLine("");
  emitLine("Streaming /search canary (issue #1858). Hits the 25 mixed BET 2 domains and");
  emitLine("asserts p95 time-to-first-card < 5s, 0 dead-end empty states, and verified");
  emitLine("share >= 0.8. Exits non-zero when any streaming check trips.");
  emitLine("");
  emitLine("Options:");
  emitLine("  --base-url=URL     Base URL to probe (default: https://0509.io).");
  emitLine("  --spacing-ms=N     Inter-domain request spacing in ms (default 0).");
  emitLine("  --json             Emit a JSON_REPORT_BEGIN/END block with the full probe set.");
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
    `search-stream canary starting @ ${baseUrl} (n=${STREAM_CANARY_DOMAINS.length}, spacing=${spacingMs}ms)`,
  );
  // One limiter for the whole cohort so the 20 req / 10 min / IP anonymous
  // /search budget is shared across the 25 probes (and any warming polls).
  // Acquire happens BEFORE the first-card clock starts, so queue time is not
  // counted as product latency — the same convention as bet2-live-verification.
  const limiter = createRateLimiter();
  const { run, verdict } = await runSearchStreamCanary({
    baseUrl,
    requestSpacingMs: spacingMs,
    paceRequests: false,
    beforeRequest: () => limiter.acquire(),
    onResult: (probe, index, total) => {
      emitLine(formatProbeLine(probe, index, total));
    },
  });
  emitLine("");
  for (const line of formatStreamSummary({ run, verdict })) {
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
          cohort: STREAM_CANARY_DOMAINS,
          results: run.results,
          summary: run.summary,
          termination: {
            pass: verdict.pass,
            checks: verdict.checks,
            metrics: verdict.metrics,
            warnings: verdict.warnings,
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
      `search-stream canary fatal: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }`,
    );
    process.exit(1);
  });
}
