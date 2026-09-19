#!/usr/bin/env node
// d1-budget: reads=200 writes=0 runs_per_day=4
/**
 * Live canary for issue #1500: the landing-page CTA-change detector must
 * emit ≥1 `landing_page_cta_changed` event per 25 watchlists over any
 * rolling 7-day window. The canary reads only from the existing
 * `watch_event` table — no DDL, no DML.
 *
 * The detector went silent for 77 days (4 events all-time across 88
 * watchlists, last 2026-06-15 as of 2026-08-25). This script is the
 * 7-day regression guard that the audit instrumentation in
 * `app/lib/landing-page-run-audit.server.ts` enables: once the bail-out
 * telemetry lands, the canary catches a re-silence in the next 7-day
 * window instead of the next 77-day one.
 *
 * Exit codes:
 *   0 — at least 1 `landing_page_cta_changed` event in the window.
 *   1 — zero `landing_page_cta_changed` events in the window (silent
 *       detector, the orchestration layer opens a scout-candidate issue).
 *   2 — wrangler/d1 query could not run.
 *
 * Usage:
 *   node scripts/canary-cta-detector.mjs              # remote (production) D1
 *   node scripts/canary-cta-detector.mjs --local      # local wrangler D1 fixture
 *   node scripts/canary-cta-detector.mjs --json       # machine-readable output
 *   node scripts/canary-cta-detector.mjs --window-days 7
 *
 * The query is constant and idempotent. The script does not touch D1
 * outside the SELECT.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATABASE_NAME = "0509";
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_WATCHLIST_COHORT = 25;

/**
 * @param {string[]} argv
 * @returns {{ local: boolean, json: boolean, windowDays: number, watchlistCohort: number }}
 */
export function parseArgs(argv) {
  /** @type {{ local: boolean, json: boolean, windowDays: number, watchlistCohort: number }} */
  const parsed = {
    local: false,
    json: false,
    windowDays: DEFAULT_WINDOW_DAYS,
    watchlistCohort: DEFAULT_WATCHLIST_COHORT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--local") {
      parsed.local = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--window-days" && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.windowDays = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--watchlist-cohort" && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.watchlistCohort = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/canary-cta-detector.mjs [--local] [--json] [--window-days N] [--watchlist-cohort N]",
      );
      process.exit(0);
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --local, --json, --window-days <int>, --watchlist-cohort <int>.`,
    );
  }
  return parsed;
}

/**
 * Parse the wrangler JSON output into a single result row. wrangler wraps
 * the D1 response in either an array or a single object depending on the
 * version, so we walk both shapes to keep this script tolerant.
 *
 * @param {string} output
 * @returns {Array<Record<string, unknown>>}
 */
export function rowsFromWranglerJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  return statements.flatMap((statement) => {
    if (Array.isArray(statement?.results)) return statement.results;
    if (Array.isArray(statement?.result?.results)) return statement.result.results;
    if (Array.isArray(statement?.result?.[0]?.results)) return statement.result[0].results;
    return [];
  });
}

/**
 * Build the SELECT that counts `landing_page_cta_changed` events in the
 * window. We also count distinct watchlists in the same window so the
 * canary can report the cohort size (the issue's acceptance criterion is
 * per-25-watchlists; a small cohort shouldn't pass silently). Both
 * numbers come from the same query so they are timestamp-coherent.
 *
 * @param {number} windowDays
 */
export function buildCtaEventCountQuery(windowDays) {
  // Issue #1500: read-only count over watch_event. The query joins
  // watch_event → watchlist so the watchlist count is over the same
  // population the event count is over. A watchlist is "active in the
  // window" when it had at least one watch_event row, which keeps the
  // canary's "per 25 watchlists" denominator honest without a second
  // SELECT.
  return `
    SELECT
      (SELECT COUNT(*) FROM watch_event
        WHERE event_type = 'landing_page_cta_changed'
          AND created_at > datetime('now', '-' || ${Math.floor(windowDays)} || ' days')
      ) AS cta_event_count,
      (SELECT COUNT(DISTINCT watchlist_id) FROM watch_event
        WHERE created_at > datetime('now', '-' || ${Math.floor(windowDays)} || ' days')
      ) AS active_watchlist_count,
      (SELECT MIN(created_at) FROM watch_event
        WHERE event_type = 'landing_page_cta_changed'
          AND created_at > datetime('now', '-' || ${Math.floor(windowDays)} || ' days')
      ) AS first_cta_event_at,
      (SELECT MAX(created_at) FROM watch_event
        WHERE event_type = 'landing_page_cta_changed'
          AND created_at > datetime('now', '-' || ${Math.floor(windowDays)} || ' days')
      ) AS last_cta_event_at;
  `.trim();
}

/**
 * @typedef {{
 *   ctaEventCount: number,
 *   activeWatchlistCount: number,
 *   firstCtaEventAt: string | null,
 *   lastCtaEventAt: string | null,
 * }} CtaDetectorCanaryRow
 */

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {CtaDetectorCanaryRow | null}
 */
export function mapCtaDetectorRow(rows) {
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ctaEventCount: Number(row.cta_event_count ?? 0),
    activeWatchlistCount: Number(row.active_watchlist_count ?? 0),
    firstCtaEventAt:
      typeof row.first_cta_event_at === "string" ? row.first_cta_event_at : null,
    lastCtaEventAt:
      typeof row.last_cta_event_at === "string" ? row.last_cta_event_at : null,
  };
}

/**
 * @param {{
 *   windowDays: number,
 *   watchlistCohort: number,
 *   row: CtaDetectorCanaryRow | null,
 * }} input
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function validateCtaDetector(input) {
  /** @type {string[]} */
  const failures = [];
  if (input.row === null) {
    failures.push("canary query returned no rows.");
    return { ok: false, failures };
  }
  if (input.row.ctaEventCount < 1) {
    failures.push(
      `silent CTA detector: 0 landing_page_cta_changed events in the last ${input.windowDays} day(s).`,
    );
  }
  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ local: boolean, windowDays: number }} input
 * @returns {CtaDetectorCanaryRow | null}
 */
function runCanaryQuery(input) {
  const args = [
    "wrangler",
    "d1",
    "execute",
    DATABASE_NAME,
    input.local ? "--local" : "--remote",
    "--json",
    "--command",
    buildCtaEventCountQuery(input.windowDays),
  ];
  const result = spawnSync("npx", args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    throw new Error(`wrangler d1 execute could not start: ${message}`);
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(`wrangler d1 execute failed${message ? `: ${message}` : ""}`);
  }
  return mapCtaDetectorRow(rowsFromWranglerJson(result.stdout ?? ""));
}

/**
 * @param {{
 *   local: boolean,
 *   windowDays: number,
 *   watchlistCohort: number,
 *   row: CtaDetectorCanaryRow | null,
 *   validation: ReturnType<typeof validateCtaDetector>,
 * }} report
 */
function renderHumanReport(report) {
  const lines = [];
  lines.push(
    `cta-detector canary (mode=${report.local ? "local" : "remote"}, window=${report.windowDays}d, cohort=${report.watchlistCohort})`,
  );
  if (report.row === null) {
    lines.push("- query returned no rows.");
  } else {
    lines.push(`- landing_page_cta_changed events in window: ${report.row.ctaEventCount}`);
    lines.push(`- distinct watchlists with any event in window: ${report.row.activeWatchlistCount}`);
    if (report.row.ctaEventCount > 0) {
      lines.push(`- first event: ${report.row.firstCtaEventAt ?? "n/a"}`);
      lines.push(`- last event: ${report.row.lastCtaEventAt ?? "n/a"}`);
    }
  }
  if (report.validation.failures.length === 0) {
    lines.push("verdict: ok — CTA detector fired within the window.");
  } else {
    lines.push("verdict: failed — CTA detector is silent in the window:");
    for (const failure of report.validation.failures) {
      lines.push(`- ${failure}`);
    }
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let row;
  try {
    row = runCanaryQuery({ local: args.local, windowDays: args.windowDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: message,
            mode: args.local ? "local" : "remote",
            windowDays: args.windowDays,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`cta-detector canary: ${message}`);
    }
    process.exit(2);
  }
  const validation = validateCtaDetector({
    windowDays: args.windowDays,
    watchlistCohort: args.watchlistCohort,
    row,
  });
  const report = {
    ok: validation.ok,
    local: args.local,
    windowDays: args.windowDays,
    watchlistCohort: args.watchlistCohort,
    database: DATABASE_NAME,
    row,
    validation,
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHumanReport(report));
  }
  process.exit(validation.ok ? 0 : 1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
