#!/usr/bin/env node
/**
 * Weekly business-metrics operator report (issue #2116).
 *
 * Runs the six docs/ga-metrics.md business-metric queries plus a weekly
 * watch_event yield check against production D1 via
 * `wrangler d1 execute 0509 --remote`, and prints one markdown table per
 * metric.
 *
 * Read-only: SELECT queries only. No D1 writes, no PII beyond aggregate
 * counts, no route or cron — an operator runs this by hand.
 *
 * Usage:
 *   node scripts/weekly-business-metrics.mjs         # query --remote D1, print the report
 *   node scripts/weekly-business-metrics.mjs --help  # print this help and exit
 *
 * Requires wrangler authentication with read access to the production 0509
 * D1 database (CLOUDFLARE_API_TOKEN or `wrangler login`).
 *
 * Metrics printed:
 *   1. New signups per day (last 14 days)          — "user".createdAt
 *   2. Paid conversions (current non-free plans)   — user_plan
 *   3. Active watchlists (is_active = 1)           — watchlist
 *   4. Evidence usage (recent periods)             — evidence_usage_period
 *   5. Top-up revenue events (last 14 days)        — evidence_top_up_grant
 *   6. Churn signals (failed/on_hold/cancelled)    — user_plan.dodo_status
 *   7. Event yield: watch_event count per active watchlist per week
 *      (12-week series + trailing-7-day median, WARN when the median < 1)
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const databaseName = "0509";
const signupDays = 14;
const topUpDays = 14;
const usagePeriods = 12;
const yieldWeeks = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

const helpText = `Weekly business-metrics operator report (read-only).

Usage:
  node scripts/weekly-business-metrics.mjs         Query production (--remote) D1 and print the report
  node scripts/weekly-business-metrics.mjs --help  Print this help and exit

Runs the six docs/ga-metrics.md business-metric queries plus a weekly
watch_event yield check against production D1 via
\`wrangler d1 execute ${databaseName} --remote\` and prints one markdown table
per metric:

  1. New signups per day (last ${signupDays} days)        — "user".createdAt
  2. Paid conversions (current non-free plans)     — user_plan
  3. Active watchlists (is_active = 1)             — watchlist
  4. Evidence usage (last ${usagePeriods} period rows)        — evidence_usage_period
  5. Top-up revenue events (last ${topUpDays} days)         — evidence_top_up_grant
  6. Churn signals (failed/on_hold/cancelled)      — user_plan.dodo_status
  7. Event yield: watch_event count per active watchlist per week
     (${yieldWeeks}-week series + trailing-7-day median; prints WARN when the
     median falls below 1)

Read-only: SELECT queries only. No D1 writes, no PII beyond aggregate counts.

Requires wrangler authentication with read access to the production ${databaseName}
D1 database (CLOUDFLARE_API_TOKEN or \`wrangler login\`).`;

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(helpText);
    process.exit(0);
  }
  if (args.length > 0) {
    console.error(`Unknown argument: ${args[0]}. Supported: --help`);
    process.exit(1);
  }
}

/**
 * Parse Wrangler's `d1 execute --json` result shape into a flat row list.
 *
 * @param {string} output raw `wrangler d1 execute --json` stdout
 * @returns {Array<Record<string, unknown>>}
 */
function rowsFromWranglerJson(output) {
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
 * Run one read-only query against production D1 and return its rows.
 * Throws on any failure — a metrics report must fail honestly, not print
 * partial numbers.
 *
 * @param {string} sql
 * @returns {Array<Record<string, unknown>>}
 */
function runQuery(sql) {
  const result = spawnSync(
    "wrangler",
    ["d1", "execute", databaseName, "--remote", "--command", sql, "--json"],
    { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(`wrangler could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || "").trim() || "wrangler d1 execute failed");
  }
  try {
    return rowsFromWranglerJson(result.stdout ?? "");
  } catch {
    throw new Error("wrangler d1 execute returned malformed JSON");
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatCell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

/**
 * Print one markdown table.
 *
 * @param {Array<{ key: string, label: string }>} columns
 * @param {Array<Record<string, unknown>>} rows
 */
function printTable(columns, rows) {
  console.log(`| ${columns.map((column) => column.label).join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);
  if (rows.length === 0) {
    console.log(`| ${columns.map(() => "(none)").join(" | ")} |`);
    return;
  }
  for (const row of rows) {
    console.log(`| ${columns.map((column) => formatCell(row[column.key])).join(" | ")} |`);
  }
}

/**
 * @param {string} title
 */
function printSection(title) {
  console.log(`\n## ${title}\n`);
}

/**
 * Median of a list of numbers (average of the two middle values when even).
 *
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

// createdAt / granted_at / period_start / created_at are stored as ISO-8601
// strings with a 'T' separator; comparing them against SQLite datetime('now')
// (space separator) would mis-order, so every window floor is computed in JS
// as an ISO literal — same convention as the app's bound params. Each floor
// tracks its own query's window variable so the WHERE and the LIMIT never
// desync, and a stale period can never surface under a "last N" heading.
export function buildSignupsQuery(now = new Date()) {
  const signupsCutoff = new Date(now.getTime() - signupDays * DAY_MS).toISOString();
  return `
SELECT date(createdAt) AS day, COUNT(*) AS signups
FROM "user"
WHERE createdAt >= '${signupsCutoff}'
GROUP BY day
ORDER BY day DESC
LIMIT ${signupDays};
`;
}

const paidConversionsQuery = `
SELECT plan, COUNT(*) AS users
FROM user_plan
WHERE plan != 'free'
GROUP BY plan
ORDER BY users DESC;
`;

const activeWatchlistsQuery = `
SELECT target_type, COUNT(*) AS active_watchlists
FROM watchlist
WHERE is_active = 1
GROUP BY target_type
ORDER BY active_watchlists DESC;
`;

export function buildEvidenceUsageQuery(now = new Date()) {
  // period_start is the first instant of a monthly entitlement period, so the
  // floor is now - usagePeriods months, not days.
  const usageCutoff = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - usagePeriods,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  ).toISOString();
  return `
SELECT period_start, plan_family, COUNT(*) AS workspaces,
       SUM(included_allowance) AS included_allowance,
       SUM(included_consumed) AS included_consumed
FROM evidence_usage_period
WHERE period_start >= '${usageCutoff}'
GROUP BY period_start, plan_family
ORDER BY period_start DESC, plan_family
LIMIT ${usagePeriods};
`;
}

export function buildTopUpsQuery(now = new Date()) {
  const topUpsCutoff = new Date(now.getTime() - topUpDays * DAY_MS).toISOString();
  return `
SELECT date(granted_at) AS day, COUNT(*) AS grants, SUM(quantity_granted) AS credits_granted
FROM evidence_top_up_grant
WHERE granted_at >= '${topUpsCutoff}'
GROUP BY day
ORDER BY day DESC
LIMIT ${topUpDays};
`;
}

const churnQuery = `
SELECT dodo_status, COUNT(*) AS users
FROM user_plan
WHERE dodo_status IN ('failed', 'on_hold', 'cancelled')
GROUP BY dodo_status
ORDER BY users DESC;
`;

export function buildYieldWeeklyQuery(now = new Date()) {
  const weeksCutoff = new Date(now.getTime() - yieldWeeks * 7 * DAY_MS).toISOString();
  return `
SELECT strftime('%Y-W%W', we.created_at) AS week, COUNT(*) AS events
FROM watch_event we
JOIN watchlist w ON w.id = we.watchlist_id
WHERE w.is_active = 1
  AND we.created_at >= '${weeksCutoff}'
GROUP BY week
ORDER BY week DESC
LIMIT ${yieldWeeks};
`;
}

const activeWatchlistCountQuery = `
SELECT COUNT(*) AS active_watchlists
FROM watchlist
WHERE is_active = 1;
`;

export function buildYieldPerWatchlistQuery(now = new Date()) {
  const trailingWeekCutoff = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  return `
SELECT we.watchlist_id AS watchlist_id, COUNT(*) AS events
FROM watch_event we
JOIN watchlist w ON w.id = we.watchlist_id
WHERE w.is_active = 1
  AND we.created_at >= '${trailingWeekCutoff}'
GROUP BY we.watchlist_id;
`;
}

function main() {
  parseArgs();
  try {
    console.log("# Weekly business metrics");
    console.log(`\n_Source: production D1 (\`${databaseName}\`, read-only). Generated ${new Date().toISOString()}._`);

    printSection("1. New signups per day");
    printTable(
      [
        { key: "day", label: "day" },
        { key: "signups", label: "signups" },
      ],
      runQuery(buildSignupsQuery()),
    );

    printSection("2. Paid conversions (current non-free plans)");
    const paidRows = runQuery(paidConversionsQuery);
    const paidTotal = paidRows.reduce((sum, row) => sum + Number(row.users ?? 0), 0);
    printTable(
      [
        { key: "plan", label: "plan" },
        { key: "users", label: "users" },
      ],
      paidRows.length > 0 ? [...paidRows, { plan: "total", users: paidTotal }] : paidRows,
    );

    printSection("3. Active watchlists (is_active = 1)");
    const watchlistRows = runQuery(activeWatchlistsQuery);
    const watchlistTotal = watchlistRows.reduce(
      (sum, row) => sum + Number(row.active_watchlists ?? 0),
      0,
    );
    printTable(
      [
        { key: "target_type", label: "target_type" },
        { key: "active_watchlists", label: "active_watchlists" },
      ],
      watchlistRows.length > 0
        ? [...watchlistRows, { target_type: "total", active_watchlists: watchlistTotal }]
        : watchlistRows,
    );

    printSection("4. Evidence usage (recent periods)");
    printTable(
      [
        { key: "period_start", label: "period_start" },
        { key: "plan_family", label: "plan_family" },
        { key: "workspaces", label: "workspaces" },
        { key: "included_allowance", label: "included_allowance" },
        { key: "included_consumed", label: "included_consumed" },
      ],
      runQuery(buildEvidenceUsageQuery()),
    );

    printSection("5. Top-up revenue events");
    printTable(
      [
        { key: "day", label: "day" },
        { key: "grants", label: "grants" },
        { key: "credits_granted", label: "credits_granted" },
      ],
      runQuery(buildTopUpsQuery()),
    );

    printSection("6. Churn signals (user_plan.dodo_status)");
    printTable(
      [
        { key: "dodo_status", label: "dodo_status" },
        { key: "users", label: "users" },
      ],
      runQuery(churnQuery),
    );

    printSection("7. Event yield — watch_events per active watchlist");
    const weeklyRows = runQuery(buildYieldWeeklyQuery());
    const countRows = runQuery(activeWatchlistCountQuery);
    const activeWatchlists = Number(countRows[0]?.active_watchlists ?? 0);
    printTable(
      [
        { key: "week", label: "week" },
        { key: "events", label: "events_on_active_watchlists" },
        { key: "per_watchlist", label: "events_per_active_watchlist" },
      ],
      weeklyRows.map((row) => ({
        week: row.week,
        events: row.events,
        per_watchlist:
          activeWatchlists > 0 ? Number(row.events ?? 0) / activeWatchlists : null,
      })),
    );
    console.log(
      `\n_Denominator is the current active-watchlist count (is_active = 1): ${activeWatchlists}._\n`,
    );

    const perWatchlistRows = runQuery(buildYieldPerWatchlistQuery());
    const weeklyCounts = perWatchlistRows.map((row) => Number(row.events ?? 0));
    const zeroEventWatchlists = Math.max(activeWatchlists - weeklyCounts.length, 0);
    const allWeeklyCounts = [...weeklyCounts, ...Array(zeroEventWatchlists).fill(0)];

    if (activeWatchlists === 0) {
      console.log("WARN: no active watchlists — event-yield median is undefined.");
    } else {
      const medianEvents = median(allWeeklyCounts);
      if (medianEvents < 1) {
        console.log(
          `WARN: median weekly watch_event count per active watchlist is ${formatCell(medianEvents)} (< 1) over the trailing 7 days.`,
        );
      } else {
        console.log(
          `OK: median weekly watch_event count per active watchlist is ${formatCell(medianEvents)} (>= 1) over the trailing 7 days.`,
        );
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Only run the report when executed directly; importing this module (the
// query-builder test does) must not spawn wrangler or touch argv.
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main();
}
