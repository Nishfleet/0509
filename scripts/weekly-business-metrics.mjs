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
 *   8. Drift check (issue #2836): headline headline counts (users, active
 *      watchlists) compared against the prior daily market-signal snapshot;
 *      any drop to <50% of the prior value emits an `unexplained-drift`
 *      marker and — on a real run only — auto-files a follow-up issue.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const databaseName = "0509";
const driftRepo = "Nishfleet/0509";
/** Prior daily D1 counts come from the private telemetry sink (see
 * automation/HERMES_MARKET_SIGNAL.md). Never fetched from the public repo. */
const priorSnapshotSpec = {
  repoUrl: "https://github.com/Nishfleet/0509-telemetry.git",
  ref: "automation/market-signal-snapshot",
  path: "ops/market-signal/0509-market-signal.json",
};
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
  if (args.includes("--self-test-drift-flag")) {
    selfTestDriftFlag();
    process.exit(0);
  }
  if (args.length > 0) {
    console.error(
      `Unknown argument: ${args[0]}. Supported: --help, --self-test-drift-flag`,
    );
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

/** One read-only round trip for the headline counts the drift check needs. */
const headlineCountsQuery = `
SELECT
  (SELECT COUNT(*) FROM "user") AS users_total,
  (SELECT COUNT(*) FROM watchlist WHERE is_active = 1) AS active_watchlists;
`;

/**
 * Pure drift evaluation: a headline count at <50% of the prior day's value
 * is an unexplained drop and must be flagged, not absorbed as prose.
 *
 * @param {{ users_total: number, active_watchlists: number }} current
 * @param {{ users_total: number, active_watchlists: number }} previous
 * @returns {Array<{ metric: string, current: number, previous: number, ratio: number }>}
 */
export function evaluateDrift(current, previous) {
  const flags = [];
  for (const metric of ["users_total", "active_watchlists"]) {
    const now = Number(current?.[metric] ?? 0);
    const prior = Number(previous?.[metric] ?? 0);
    if (!Number.isFinite(now) || !Number.isFinite(prior) || prior <= 0) continue;
    const ratio = now / prior;
    if (ratio < 0.5) {
      flags.push({ metric, current: now, previous: prior, ratio });
    }
  }
  return flags;
}

/**
 * Fetch the prior daily market-signal snapshot from the private telemetry
 * sink and return the headline counts plus its generation time. Read-only;
 * any failure degrades to `unavailable` instead of failing the report —
 * absence of a prior snapshot is not drift evidence.
 *
 * @returns {{ unavailable: true, detail: string } | { unavailable: false, generatedAt: string, users_total: number, active_watchlists: number }}
 */
export function fetchPriorSnapshot(maxAgeMs = 26 * 60 * 60 * 1000) {
  const tmp = mkdtempSync("/tmp/drift-snapshot-");
  try {
    const init = spawnSync("git", ["init", "-q", "."], {
      cwd: tmp,
      env: process.env,
      encoding: "utf8",
    });
    if (init.status !== 0) {
      return {
        unavailable: true,
        detail: (init.stderr || init.error?.message || "git init failed").trim(),
      };
    }
    const fetch = spawnSync(
      "git",
      ["fetch", "--depth", "1", priorSnapshotSpec.repoUrl, priorSnapshotSpec.ref],
      { cwd: tmp, env: process.env, encoding: "utf8", timeout: 60_000 },
    );
    if (fetch.status !== 0) {
      return {
        unavailable: true,
        detail: (fetch.stderr || fetch.error?.message || "git fetch failed").trim(),
      };
    }
    const show = spawnSync(
      "git",
      ["show", `FETCH_HEAD:${priorSnapshotSpec.path}`],
      { cwd: tmp, env: process.env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (show.status !== 0) {
      return {
        unavailable: true,
        detail: (show.stderr || "git show failed").trim(),
      };
    }
    const parsed = JSON.parse(show.stdout);
    const product = parsed?.product ?? {};
    const generatedAt = String(parsed?.generatedAt ?? "");
    const generated = Date.parse(generatedAt);
    // Same freshness contract as automation/HERMES_MARKET_SIGNAL.md and the
    // snapshot-age workflow: a stale snapshot is not today's evidence and
    // must never be the prior in a drift comparison (it would manufacture
    // 100% false drift from a silently stopped daily workflow).
    if (!Number.isFinite(generated) || Date.now() - generated > maxAgeMs) {
      return {
        unavailable: true,
        detail: `prior snapshot is stale (generatedAt ${generatedAt || "missing"}, freshness gate 26h); not valid drift evidence`,
      };
    }
    return {
      unavailable: false,
      generatedAt,
      users_total: Number(product.users_total ?? 0),
      active_watchlists: Number(product.active_watchlists ?? 0),
    };
  } catch (error) {
    return {
      unavailable: true,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The exact `gh issue create` argv for a drift incident. Mirrors the
 * existing canary auto-file path (see scripts/canary-proof-screenshot-rate.mjs).
 *
 * @param {{ metric: string, current: number, previous: number, ratio: number, generatedAt: string }} drift
 */
export function buildDriftIssueCommand(drift) {
  const title = `unexplained-drift: ${drift.metric} fell from ${drift.previous} to ${drift.current} (<50% of prior day)`;
  const body = [
    "`unexplained-drift` marker emitted by the weekly business-metrics drift check (issue #2836).",
    "",
    `- metric: \`${drift.metric}\``,
    `- prior-day value: ${drift.previous} (daily market-signal snapshot generated ${drift.generatedAt})`,
    `- current value: ${drift.current} (ratio ${(drift.ratio * 100).toFixed(1)}% of prior)`,
    "",
    "Investigation needed: confirm from audit rows whether this was test/telemetry cleanup or find the deletion source. No data restoration without Nish.",
    "",
    "Relates to #2836",
  ].join("\n");
  return ["issue", "create", "-R", driftRepo, "--title", title, "--body", body];
}

/**
 * Dedupe check: one open drift incident per marker, like the canary path.
 *
 * @returns {boolean} true when an open unexplained-drift incident already exists
 */
function existingOpenDriftIncident() {
  const result = spawnSync(
    "gh",
    ["issue", "list", "-R", driftRepo, "--state", "open", "--search", "unexplained-drift in:title", "--json", "number"],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  if (result.status !== 0) return false;
  try {
    return JSON.parse(result.stdout ?? "[]").length > 0;
  } catch {
    return false;
  }
}

/**
 * Self-test (issue #2836 termination clause): replay a fixture snapshot with
 * a 100% drop and assert the unexplained-drift marker is emitted. Never
 * touches D1 and never files anything. Exits 0 when the guard fires.
 */
function selfTestDriftFlag() {
  const fixture = { users_total: 15, active_watchlists: 11 };
  const current = { users_total: 15, active_watchlists: 0 };
  const flags = evaluateDrift(current, fixture);
  const watchlistFlag = flags.find((flag) => flag.metric === "active_watchlists");
  if (!watchlistFlag || watchlistFlag.current !== 0 || watchlistFlag.previous !== 11) {
    console.error("self-test FAILED: 100% watchlist drop did not produce the unexplained-drift flag.");
    process.exit(1);
  }
  const argv = buildDriftIssueCommand({
    ...watchlistFlag,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  const marker = `unexplained-drift: ${watchlistFlag.metric} ${watchlistFlag.current} < 50% of prior ${watchlistFlag.previous}`;
  console.log(marker);
  console.log(`self-test OK: guard fired; would file via gh ${argv[0]} (dry-run, nothing filed).`);
}

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

    printSection("8. Drift check — headline counts vs prior daily snapshot");
    runDriftCheck();
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

/**
 * Compare the just-queried headline counts against the prior daily
 * market-signal snapshot. Emits an `unexplained-drift` marker per flagged
 * metric. Filing is gated on real samples (a real --remote D1 run plus a
 * real prior snapshot from the private telemetry sink); fixture/self-test
 * runs never open production incidents (fleet-ops #2479-style gate).
 */
function runDriftCheck() {
  const countRows = runQuery(headlineCountsQuery);
  const current = {
    users_total: Number(countRows[0]?.users_total ?? 0),
    active_watchlists: Number(countRows[0]?.active_watchlists ?? 0),
  };
  const prior = fetchPriorSnapshot();
  if (prior.unavailable) {
    console.log(
      `no-drift-check: prior daily snapshot unavailable (${prior.detail}); cannot evaluate drift.`,
    );
    return;
  }
  const previous = {
    users_total: prior.users_total,
    active_watchlists: prior.active_watchlists,
  };
  console.log(
    `_Prior daily snapshot: generated ${prior.generatedAt} (users ${previous.users_total}, active watchlists ${previous.active_watchlists})._`,
  );
  const flags = evaluateDrift(current, previous);
  if (flags.length === 0) {
    console.log(
      `OK: no drift — users_total ${current.users_total} (prior ${previous.users_total}), active_watchlists ${current.active_watchlists} (prior ${previous.active_watchlists}); both >= 50% of prior.`,
    );
    return;
  }
  for (const flag of flags) {
    console.log(
      `unexplained-drift: ${flag.metric} ${flag.current} < 50% of prior ${flag.previous} (ratio ${(flag.ratio * 100).toFixed(1)}%).`,
    );
  }
  // Real samples only: this path only runs after a live --remote D1 query and
  // a real snapshot fetch; a self-test/fixture run exits before this point.
  if (existingOpenDriftIncident()) {
    console.log("auto-file skipped: an open unexplained-drift incident already exists (dedupe).");
    return;
  }
  for (const flag of flags) {
    const command = buildDriftIssueCommand({ ...flag, generatedAt: prior.generatedAt });
    const createResult = spawnSync("gh", command, {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (createResult.status !== 0) {
      const message = (createResult.stderr || createResult.stdout || "").trim();
      console.log(`auto-file failed for ${flag.metric}${message ? `: ${message}` : ""}`);
      continue;
    }
    console.log(`auto-filed ${flag.metric}: ${(createResult.stdout ?? "").trim()}`);
  }
}

if (invokedDirectly) {
  main();
}
