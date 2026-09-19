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
 *
 * --json (issue #3321, direction#4518): the direction metric's signup count
 *      as machine-readable JSON. Fixture-free: excludes every fleet-synthetic
 *      identity on the shared SYNTHETIC_USER_PATTERNS list — the #2908
 *      QA/canary fixture enumeration, the billing-canary-lock guard rows, the
 *      launch-readiness canary owner, every 0509.internal-domain mailbox, and the
 *      BET-1 burst cohort (issue #3486). Surviving rows are cross-checked
 *      against their `signup_completed` funnel event (PR #1965) when
 *      --events-ndjson supplies event records; rows without one are listed as
 *      suspect, never silently counted.
 *
 * --json also carries `funnel` (issue #3521): trailing-7d/30d counts per
 *      emitted funnel event kind, read from the Workers Analytics Engine
 *      `funnel_events` dataset — the queryable sink the emit path writes via
 *      writeDataPoint (binding FUNNEL_ANALYTICS, wrangler.jsonc). Counts are
 *      sample-corrected (`sumIf`/`SUM(_sample_interval)`). When the
 *      Analytics Engine read cannot run, `funnel.available` is false with the
 *      reason — never a manufactured zero. Issue #3367 adds
 *      `suggestion_accepted` counts and `suggestions_accepted_per_signup_*`
 *      rates on that same object, plus `tracked_competitors_gte3`: the
 *      share of (fixture-free) signups that currently track >=3 competitors,
 *      grouped by plan, from a read-only D1 join.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
/** Prefer the repo's pinned wrangler (node_modules/.bin) so a plain
 * `node scripts/weekly-business-metrics.mjs` works on hosts without a global
 * wrangler on PATH; fall back to PATH resolution when the repo has none. */
const wranglerBin = existsSync(join(root, "node_modules", ".bin", "wrangler"))
  ? join(root, "node_modules", ".bin", "wrangler")
  : "wrangler";
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
/** Trailing windows of the direction metric (issue #3321; direction#4518). */
const directionWindows = { recent: 7, baseline: 30 };
/** Issue #3521 — the queryable funnel sink: the Workers Analytics Engine
 * dataset the emit path writes via writeDataPoint (binding FUNNEL_ANALYTICS
 * in wrangler.jsonc). Read through the account-level SQL API; the same
 * deploy/operator Cloudflare credentials the D1 reads use already carry
 * Account Analytics Read on this account. */
const FUNNEL_DATASET = "funnel_events";
const FUNNEL_WINDOWS = { recent: 7, baseline: 30 };
/** The visit→signup stage kinds the issue names; every other emitted kind is
 * still counted and listed under `kinds`. */
const FUNNEL_HEADLINE_KINDS = [
  "home_view",
  "search_preview_submit",
  "search_preview_result",
  "search_preview_error",
  "signup_start",
];
/** Issue #3367 — always present on the funnel JSON so a week with zero
 * suggestion-accepts is an honest zero, not a missing key. signup_completed
 * is the denominator for suggestions-accepted-per-signup. */
const FUNNEL_RATE_KINDS = ["suggestion_accepted", "signup_completed"];
const FUNNEL_ZERO_FILL_KINDS = [...FUNNEL_HEADLINE_KINDS, ...FUNNEL_RATE_KINDS];
/** Plans the >=3-tracked-competitors share zero-fills so a plan with no
 * recent signups still appears. Unknown plan strings from D1 are kept. */
const TRACKED_COMPETITORS_PLANS = ["free", "scout", "starter", "agency"];
/** Credential files consulted for the Analytics Engine read, in order. */
const CLOUDFLARE_CREDENTIAL_ENV_FILES = [
  join(homedir(), ".config", "cloudflare", "deploy.env"),
  join(homedir(), ".config", "cloudflare", "analytics.env"),
];
/** Workers Logs retention on this account (docs/funnel-measurement-spec.md):
 * a signup_completed event older than this can no longer be checked. */
const EVENT_RETENTION_DAYS = 7;
/** A surviving signup row and its signup_completed event carry no shared id
 * (the event's spec-§4 field allowlist has no user/workspace correlation), so
 * the cross-check matches the nearest unused event in time. 30min covers the
 * OAuth path (the event fires inside the same request, ~0s gap) and the
 * magic-link path (the verification click can lag the user-row insert by
 * minutes) without letting two same-hour signups share one event: the greedy
 * nearest match pairs rows and events one-to-one. Named, not buried. */
const SIGNUP_EVENT_MATCH_WINDOW_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const helpText = `Weekly business-metrics operator report (read-only).

Usage:
  node scripts/weekly-business-metrics.mjs         Query production (--remote) D1 and print the report
  node scripts/weekly-business-metrics.mjs --json  Print the fixture-free signup meter as JSON (issue #3321)
  node scripts/weekly-business-metrics.mjs --json --events-ndjson <path|->
                                                   Also cross-check surviving rows against their
                                                   signup_completed event (PR #1965); rows without a matching
                                                   event are listed as suspect. One funnel log record per line
                                                   (app/lib/log.server.ts AppLogRecord; operation
                                                   "funnel_signup_completed"), the same NDJSON contract as
                                                   scripts/funnel-daily-counts.mjs. "-" reads stdin.
  node scripts/weekly-business-metrics.mjs --help  Print this help and exit

--json output carries \`funnel\` (issue #3521): per-kind trailing-7d/30d event
counts from the Workers Analytics Engine \`${FUNNEL_DATASET}\` dataset
(credential lookup: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN env, then
~/.config/cloudflare/deploy.env, then analytics.env). \`funnel.available\`
false means the read could not run — counts are then absent, never zeroed.
Issue #3367 adds \`funnel.suggestion_accepted_*\` and
\`funnel.suggestions_accepted_per_signup_*\` on that object, plus
\`tracked_competitors_gte3\` (share of fixture-free signups with >=3 active
competitor watchlists, per plan).

Runs the six docs/ga-metrics.md business-metric queries plus a weekly
watch_event yield check against production D1 via
\`wrangler d1 execute ${databaseName} --remote\` and prints one markdown table
per metric. With --json it instead prints the direction metric's
fixture-free signup count (issue #3321):

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
  /** @type {{ json: boolean, eventsPath: string | null }} */
  const options = { json: false, eventsPath: null };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--json") {
      options.json = true;
    } else if (args[i] === "--events-ndjson") {
      options.eventsPath = args[i + 1];
      if (options.eventsPath === undefined) {
        console.error("--events-ndjson requires a path (or - for stdin).");
        process.exit(1);
      }
      i += 1;
    } else {
      console.error(
        `Unknown argument: ${args[i]}. Supported: --help, --self-test-drift-flag, --json, --events-ndjson <path|->`,
      );
      process.exit(1);
    }
  }
  return options;
}

/**
 * Parse Wrangler's `d1 execute --json` result shape into a flat row list.
 *
 * @param {string} output raw `wrangler d1 execute --json` stdout
 * @returns {Array<Record<string, unknown>>}
 */
export function rowsFromWranglerJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("wrangler d1 execute returned malformed JSON");
  }
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  // An API error envelope can ride on stdout as valid JSON with no results
  // array; parsed naively that reads as "zero rows" and the meter would
  // print a false zero — exactly the corruption this meter exists to
  // prevent. An `error` key at statement level is always a failure: fail
  // loudly instead (issue #3321 — the meter must never manufacture a zero).
  for (const statement of statements) {
    const err = statement?.error;
    const text =
      typeof err === "string" ? err : (err?.text ?? err?.message ?? null);
    if (text) throw new Error(`wrangler d1 execute API error: ${text}`);
  }
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
    wranglerBin,
    ["d1", "execute", databaseName, "--remote", "--command", sql, "--json"],
    { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(`wrangler could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    // stderr usually carries only the config warning; the real API error
    // envelope rides on stdout as JSON. Include both so the thrown failure
    // names its cause instead of a bare exit code.
    throw new Error(
      [stderr, stdout].filter(Boolean).join("\n") || "wrangler d1 execute failed",
    );
  }
  return rowsFromWranglerJson(result.stdout ?? "");
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
  /** @type {Array<"users_total" | "active_watchlists">} */
  const driftMetrics = ["users_total", "active_watchlists"];
  for (const metric of driftMetrics) {
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
    // schemaVersion-2 snapshots (issue #3471) report customer-facing counts
    // as organic-only with the fleet's own rows under synthetic_*. The drift
    // detector compares headline totals, so it re-adds the synthetic share —
    // otherwise the organic-only cutover reads as a >50% drop and auto-files
    // a false unexplained-drift incident.
    return {
      unavailable: false,
      generatedAt,
      users_total: Number(product.users_total ?? 0) + Number(product.synthetic_users_total ?? 0),
      active_watchlists:
        Number(product.active_watchlists ?? 0) + Number(product.synthetic_active_watchlists ?? 0),
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

// ---------------------------------------------------------------------------
// Direction metric (issue #3321, direction#4518): the fixture-free signup
// meter. signups/week is the direction metric, so the count must not include
// the fleet's own QA/canary fixture accounts, and every surviving row must be
// checkable against the signup_completed funnel event (PR #1965).
// ---------------------------------------------------------------------------

/**
 * The fleet's synthetic user identities, as data — the ONE list every
 * customer-facing count shares (issue #3486). No regex, no buried LIKE. Each
 * row: which column, what value, which match rule. First match wins (list
 * order = precedence — exact/id guards sit ahead of the 0509.internal
 * suffix so a canary row is attributed to its specific pattern); matching
 * trims and lowercases both sides, because the canary's own lookup compares
 * lower(email) (getBillingCanaryUser) — #2908's identities were read in
 * mixed case.
 *
 * The market-signal snapshot imports this same list
 * (scripts/market-signal-snapshot.mjs): when a new synthetic family appears,
 * it is added HERE once and both reads exclude it — the #3471 split-list
 * drift is what let burst/canary signups through this metric.
 *
 * "owner" (the #2908 16-row read's remaining account) is deliberately NOT a
 * fixture: the launch canary runs on that account, but it is a real, human
 * signup — it stays counted.
 */
export const SYNTHETIC_USER_PATTERNS = [
  // = BILLING_CANARY_DEFAULT_EMAIL (app/lib/billing-canary-identity.server.ts;
  // #2908's newest row, 2026-09-11T09:16Z).
  { field: "email", value: "billing-canary@0509.internal", match: "exact" },
  // = BILLING_CANARY_USER_ID — the billing-canary-lock guard identity. Also
  // catches the canary when BILLING_CANARY_EMAIL overrides the address,
  // because ensureDedicatedBillingCanaryUser always binds this id.
  { field: "id", value: "billing-canary-0509", match: "exact" },
  // #2908 wrote "codex-qa-*" — the value keeps the #2908 spelling minus the
  // glob, and the match rule below IS the glob's meaning (prefix).
  { field: "email", value: "codex-qa-", match: "prefix" },
  { field: "email", value: "codex-free-qa-", match: "prefix" },
  // #2908 wrote "auth-QA" bare. Emails carry a domain, so the family is
  // auth-QA…@… — a prefix, not an exact address.
  { field: "email", value: "auth-QA", match: "prefix" },
  // CANARY_USER_ID (app/routes/api.launch-readiness.canary.ts) — the launch
  // canary self-provisions this user; its email varies, the id does not.
  { field: "id", value: "launch-readiness-canary-owner", match: "exact" },
  // The fleet's never-routable mailbox domain — covers every current and
  // future *@0509.internal fixture (billing-canary-staging@, codex-qa-*@, …).
  { field: "email", value: "@0509.internal", match: "suffix" },
  // BET-1 cohort burst (#3429, .fleet/burst-3322.sh): bet1-3322-<NN>@0509.io.
  { field: "email", value: "bet1-3322-", match: "prefix" },
];

/**
 * Does one user row match one synthetic-identity pattern? The only matcher
 * there is: trim, lowercase, then exact / prefix / suffix. No regex, no
 * LIKE — the pattern list above is the whole story. An unknown match rule
 * throws rather than silently degrading to prefix (issue #3486).
 *
 * @param {Record<string, unknown>} row
 * @param {{ field: string, value: string, match: string }} pattern
 * @returns {boolean}
 */
function matchesSyntheticUserPattern(row, pattern) {
  const raw = pattern.field === "id" ? row?.id : row?.email;
  const value = String(raw ?? "").trim().toLowerCase();
  const expected = String(pattern.value).trim().toLowerCase();
  if (pattern.match === "exact") return value === expected;
  if (pattern.match === "prefix") return value.startsWith(expected);
  if (pattern.match === "suffix") return value.endsWith(expected);
  throw new Error(`unsupported synthetic-identity match rule: ${pattern.match}`);
}

/**
 * The one read-only D1 read behind the meter: every user row inside the
 * baseline (30d) window. The 7d window is a subset of the 30d one, so a
 * single round trip answers both; the evaluator applies the 7d cut, the
 * fixture exclusion and the event cross-check. SELECT-only; no DDL/DML
 * anywhere in this script (issue #3321 acceptance 5).
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function buildSignupsIntegrityQuery(now = new Date()) {
  const cutoff = new Date(now.getTime() - directionWindows.baseline * DAY_MS).toISOString();
  return `
SELECT id, email, createdAt
FROM "user"
WHERE createdAt >= '${cutoff}'
ORDER BY createdAt DESC
LIMIT 1000;
`;
}

/**
 * Parse Workers Logs NDJSON (one funnel log record per line — the same
 * contract as scripts/funnel-daily-counts.mjs) into records, counting lines
 * that are not JSON objects instead of failing the whole read: one malformed
 * Workers Logs line must not cost the packet its number.
 *
 * @param {string} text
 * @returns {{ records: Array<Record<string, unknown>>, unparseableLines: number }}
 */
export function parseSignupEventRecords(text) {
  const records = [];
  let unparseableLines = 0;
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record === null || typeof record !== "object") {
        unparseableLines += 1;
        continue;
      }
      records.push(record);
    } catch {
      unparseableLines += 1;
    }
  }
  return { records, unparseableLines };
}

/**
 * Pure meter: run it on the rows the D1 read returned (the "D1 mock" in the
 * test) and it returns the exact JSON the packet pastes into the direction
 * entry. `now` is injected, so no test reads the wall clock (fleet-ops
 * #3243/#3246, #3212); the funnel events arrive as an already-parsed record
 * bundle, or null when the caller supplied none.
 *
 * Counting contract:
 *   - rows_total: rows inside the baseline window (what the read returned);
 *     signups_30d + excluded_fixtures = rows_total, by construction.
 *   - excluded_fixtures: fixtures among them (first-matching pattern wins;
 *     excluded_fixtures_by_pattern sums to it).
 *   - signups_30d: surviving (= non-fixture) rows; signups_7d: their 7d
 *     subset. A surviving row is a signup whether or not its funnel event
 *     survives — what the cross-check adds is the disclosure of which rows
 *     lack one, so nothing is silently counted.
 *   - event_cross_check: when records were supplied, every surviving row
 *     inside the Workers Logs retention window (7d — EVENTS_RETENTION: older
 *     events are gone from the log, their absence means nothing) must
 *     consume one signup_completed event within 30 minutes; survivors that
 *     could match and did not are listed in `suspect` (state
 *     "no_event_in_window"). Rows older than retention are counted in
 *     rows_outside_retention — they cannot be checked, so they are
 *     disclosed, not suspected. unparseable_event_lines counts Workers Logs
 *     lines that were not JSON records at all (the reader skipped them),
 *     unreadable_event_records counts funnel_signup_completed records whose
 *     timestamp could not be parsed.
 *
 * @param {Array<Record<string, unknown>>} rows D1 rows ({id, email, createdAt})
 * @param {Date} now
 * @param {{ records: Array<Record<string, unknown>>, unparseableLines?: number } | null | undefined} eventBundle
 * @returns {Record<string, unknown>}
 */
export function evaluateSignupIntegrity(rows, now, eventBundle) {
  const cutoff30 = now.getTime() - directionWindows.baseline * DAY_MS;
  const cutoff7 = now.getTime() - directionWindows.recent * DAY_MS;

  const inWindow = [];
  for (const row of rows ?? []) {
    const ts = Date.parse(String(row?.createdAt ?? ""));
    if (Number.isFinite(ts) && ts >= cutoff30) inWindow.push({ row, ts });
  }

  /** @type {Record<string, number>} */
  const byPattern = {};
  let excludedFixtures = 0;
  const survivors = [];
  for (const entry of inWindow) {
    const pattern = SYNTHETIC_USER_PATTERNS.find((candidate) =>
      matchesSyntheticUserPattern(entry.row, candidate),
    );
    if (pattern) {
      excludedFixtures += 1;
      byPattern[pattern.value] = (byPattern[pattern.value] ?? 0) + 1;
    } else {
      survivors.push(entry);
    }
  }
  const survivors30 = survivors.length;
  const survivors7 = survivors.filter((entry) => entry.ts >= cutoff7).length;

  const retentionCutoff = now.getTime() - EVENT_RETENTION_DAYS * DAY_MS;
  /** @type {{ evaluated: boolean, retention_days: number, match_window_minutes: number, unparseable_event_lines: number, signup_completed_events: number, non_signup_records: number, unreadable_event_records: number, rows_within_retention: number, matched: number, suspect: Array<{ email: unknown, createdAt: unknown, state: string }>, rows_outside_retention: number }} */
  const crossCheck = {
    evaluated: eventBundle !== null && eventBundle !== undefined,
    retention_days: EVENT_RETENTION_DAYS,
    match_window_minutes: SIGNUP_EVENT_MATCH_WINDOW_MS / 60_000,
    unparseable_event_lines: 0,
    signup_completed_events: 0,
    non_signup_records: 0,
    unreadable_event_records: 0,
    rows_within_retention: 0,
    matched: 0,
    suspect: [],
    rows_outside_retention: 0,
  };

  if (crossCheck.evaluated) {
    crossCheck.unparseable_event_lines = Number(eventBundle?.unparseableLines ?? 0);
    const events = [];
    for (const record of eventBundle?.records ?? []) {
      if (record?.operation !== "funnel_signup_completed") {
        crossCheck.non_signup_records += 1;
        continue;
      }
      const ts = Date.parse(String(record?.timestamp ?? ""));
      if (!Number.isFinite(ts)) {
        crossCheck.unreadable_event_records += 1;
        continue;
      }
      events.push(ts);
    }
    crossCheck.signup_completed_events = events.length;
    // Greedy nearest, one-to-one (see SIGNUP_EVENT_MATCH_WINDOW_MS): the
    // oldest surviving row picks first, and ties keep the earlier event.
    // ASC row order + a first-strictly-smaller scan make it deterministic.
    const remaining = [...events].sort((a, b) => a - b);
    const withinRetention = survivors
      .filter((entry) => entry.ts >= retentionCutoff)
      .sort(
        (a, b) =>
          a.ts - b.ts ||
          String(a.row?.email ?? "").localeCompare(String(b.row?.email ?? "")),
      );
    crossCheck.rows_within_retention = withinRetention.length;
    for (const entry of withinRetention) {
      let bestIndex = -1;
      let bestDelta = Infinity;
      remaining.forEach((ts, index) => {
        const delta = Math.abs(ts - entry.ts);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIndex = index;
        }
      });
      if (bestIndex >= 0 && bestDelta <= SIGNUP_EVENT_MATCH_WINDOW_MS) {
        remaining.splice(bestIndex, 1);
        crossCheck.matched += 1;
      } else {
        crossCheck.suspect.push({
          email: entry.row?.email ?? null,
          createdAt: entry.row?.createdAt ?? null,
          state: "no_event_in_window",
        });
      }
    }
    crossCheck.rows_outside_retention = survivors30 - withinRetention.length;
  }

  return {
    metric: "signups/week",
    definition:
      "direction#4518; trailing-7d/30d fixture-free user.createdAt; excludes the shared fleet-synthetic identity list (#2908 enumeration, billing-canary guard, launch-readiness canary owner, *@0509.internal, bet1-3322-*; issue #3486); surviving rows cross-checked against signup_completed funnel events (#1872, PR #1965); documented in docs/ga-metrics.md",
    fixture_patterns: SYNTHETIC_USER_PATTERNS,
    windows_days: directionWindows,
    signups_7d: survivors7,
    signups_30d: survivors30,
    excluded_fixtures: excludedFixtures,
    excluded_fixtures_by_pattern: byPattern,
    rows_total: inWindow.length,
    event_cross_check: crossCheck,
  };
}

/**
 * Read the funnel-event NDJSON (a path, or "-" for stdin) — read-only, and
 * skip-with-a-count for lines that are not JSON records.
 *
 * @param {string} eventsPath
 * @returns {{ records: Array<Record<string, unknown>>, unparseableLines: number }}
 */
function readSignupEventRecords(eventsPath) {
  const text = readFileSync(eventsPath === "-" ? 0 : eventsPath, "utf8");
  const parsed = parseSignupEventRecords(text);
  if (parsed.unparseableLines > 0) {
    console.error(
      `weekly-business-metrics: skipped ${parsed.unparseableLines} unparseable event log line(s).`,
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Funnel read path (issue #3521): the emitted funnel_* events land in the
// Workers Analytics Engine `funnel_events` dataset (writeDataPoint inside
// emitFunnelEvent). One SQL-API round trip yields trailing-7d and -30d
// counts per kind; evaluateFunnelCounts turns the rows into the JSON shape.
// ---------------------------------------------------------------------------

/**
 * Parse a simple KEY=VALUE env file (same convention as
 * scripts/cf-traffic-report.mjs). Blank lines and `#` comments are ignored;
 * an optional `export ` prefix and surrounding quotes are stripped.
 *
 * @param {string} path
 * @returns {Record<string, string>}
 */
function parseEnvFile(path) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Credentials for the Analytics Engine SQL API (Account Analytics Read).
 * Resolution order: exported CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN,
 * then ~/.config/cloudflare/deploy.env (the deploy token already carries
 * the account-analytics read on this account), then
 * ~/.config/cloudflare/analytics.env (the narrower analytics token, same
 * convention as scripts/cf-traffic-report.mjs).
 *
 * @returns {{ accountId: string, token: string, source: string } | null}
 */
function funnelReadCredentials() {
  const sources = [
    {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
      source: "CLOUDFLARE_* environment",
    },
  ];
  for (const path of CLOUDFLARE_CREDENTIAL_ENV_FILES) {
    if (!existsSync(path)) continue;
    try {
      const parsed = parseEnvFile(path);
      sources.push({
        accountId: parsed.CLOUDFLARE_ACCOUNT_ID ?? parsed.CF_ACCOUNT_ID,
        token: parsed.CLOUDFLARE_API_TOKEN ?? parsed.CF_ANALYTICS_API_TOKEN,
        source: path,
      });
    } catch {
      // An unreadable credential file is skipped, not fatal — the next
      // source may still supply credentials.
    }
  }
  const found = sources.find(
    (candidate) =>
      typeof candidate.accountId === "string" &&
      candidate.accountId.trim() &&
      typeof candidate.token === "string" &&
      candidate.token.trim(),
  );
  if (!found) return null;
  return {
    accountId: String(found.accountId).trim(),
    token: String(found.token).trim(),
    source: found.source,
  };
}

/**
 * One Analytics Engine SQL API round trip. Success answers the
 * {meta, data, rows} envelope; a rejected query or bad credential answers
 * plain text ("Input was invalid: ...") with a non-2xx status.
 *
 * @param {string} sql
 * @param {{ accountId: string, token: string }} credentials
 * @returns {Promise<{ data?: Array<Record<string, unknown>> }>}
 */
async function runAnalyticsEngineQuery(sql, credentials) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/analytics_engine/sql`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.token}` },
      body: sql,
    });
  } catch (error) {
    throw new Error(
      `could not reach the Analytics Engine SQL API: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Analytics Engine SQL API HTTP ${response.status}: ${text.trim().slice(0, 300)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Analytics Engine SQL API returned a non-JSON response: ${text.trim().slice(0, 300)}`,
    );
  }
}

/**
 * The funnel-counts query. `SUM(_sample_interval)` (not COUNT(*)) is the
 * documented sample-corrected event count: when the engine samples, each
 * row's interval is >1 and a bare COUNT underreports. `sumIf` splits the
 * recent window inside the same round trip. blob1 is the emitted operation
 * (`funnel_<kind>`) — see writeFunnelDataPoint in
 * app/lib/funnel-measurement.server.ts.
 *
 * @returns {string}
 */
export function buildFunnelCountsQuery() {
  return `SELECT blob1 AS kind, sumIf(_sample_interval, timestamp >= NOW() - INTERVAL '${FUNNEL_WINDOWS.recent}' DAY) AS events_7d, SUM(_sample_interval) AS events_30d FROM ${FUNNEL_DATASET} WHERE timestamp >= NOW() - INTERVAL '${FUNNEL_WINDOWS.baseline}' DAY GROUP BY kind ORDER BY kind`;
}

/**
 * Pure mapper: AE rows ({kind, events_7d, events_30d}) → the `funnel` JSON
 * object. Every headline kind is present even at zero events — an absent
 * `funnel_*` row means none were written, an honest zero; a row whose kind
 * does not start with `funnel_` cannot enter the report.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {{ kinds: Array<{ kind: string, events_7d: number, events_30d: number }> } & Record<string, unknown>}
 */
export function evaluateFunnelCounts(rows) {
  /** @type {Map<string, { kind: string, events_7d: number, events_30d: number }>} */
  const perKind = new Map();
  for (const kind of FUNNEL_ZERO_FILL_KINDS) {
    perKind.set(`funnel_${kind}`, {
      kind: `funnel_${kind}`,
      events_7d: 0,
      events_30d: 0,
    });
  }
  for (const row of rows ?? []) {
    const kind = String(row?.kind ?? "");
    if (!kind.startsWith("funnel_")) continue;
    perKind.set(kind, {
      kind,
      events_7d: Number(row?.events_7d ?? 0),
      events_30d: Number(row?.events_30d ?? 0),
    });
  }
  /** @type {{ kinds: Array<{ kind: string, events_7d: number, events_30d: number }> } & Record<string, unknown>} */
  const funnel = {
    kinds: [...perKind.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
  };
  for (const kind of FUNNEL_HEADLINE_KINDS) {
    const cell = perKind.get(`funnel_${kind}`);
    funnel[`${kind}_7d`] = cell?.events_7d ?? 0;
    funnel[`${kind}_30d`] = cell?.events_30d ?? 0;
  }
  const accepted7 = perKind.get("funnel_suggestion_accepted")?.events_7d ?? 0;
  const accepted30 = perKind.get("funnel_suggestion_accepted")?.events_30d ?? 0;
  const signups7 = perKind.get("funnel_signup_completed")?.events_7d ?? 0;
  const signups30 = perKind.get("funnel_signup_completed")?.events_30d ?? 0;
  funnel.suggestion_accepted_7d = accepted7;
  funnel.suggestion_accepted_30d = accepted30;
  funnel.signup_completed_7d = signups7;
  funnel.signup_completed_30d = signups30;
  funnel.suggestions_accepted_per_signup_7d =
    signups7 > 0 ? accepted7 / signups7 : null;
  funnel.suggestions_accepted_per_signup_30d =
    signups30 > 0 ? accepted30 / signups30 : null;
  return funnel;
}

/**
 * The funnel section: `available` is honest. Missing credentials or a failed
 * query reports `available: false` + the reason — the report never prints a
 * manufactured zero. A not-yet-created dataset is NOT an error: the SQL API
 * answers an empty result set for an unwritten dataset, which maps to real
 * zeros (no events written yet).
 *
 * @returns {Promise<{ available: boolean, detail?: string, dataset?: string, credential_source?: string, windows_days?: { recent: number, baseline: number }, kinds?: Array<{ kind: string, events_7d: number, events_30d: number }> } & Record<string, unknown>>}
 */
async function readFunnelCounts() {
  const credentials = funnelReadCredentials();
  if (!credentials) {
    return {
      available: false,
      detail:
        "no Cloudflare API credentials found — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, or store them in ~/.config/cloudflare/deploy.env or analytics.env",
    };
  }
  try {
    const response = await runAnalyticsEngineQuery(
      buildFunnelCountsQuery(),
      credentials,
    );
    const rows = Array.isArray(response?.data) ? response.data : [];
    return {
      available: true,
      dataset: FUNNEL_DATASET,
      credential_source: credentials.source,
      windows_days: FUNNEL_WINDOWS,
      ...evaluateFunnelCounts(rows),
    };
  } catch (error) {
    return {
      available: false,
      credential_source: credentials.source,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Issue #3367: one read-only D1 join answering "share of signups that
 * currently track >=3 competitors, per plan". The 7d window is a subset of
 * the 30d one, so a single round trip answers both. Email/id ride so the
 * evaluator can apply SYNTHETIC_USER_PATTERNS; they never appear in the
 * JSON. SELECT-only.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function buildTrackedCompetitorsGte3Query(now = new Date()) {
  const cutoff = new Date(now.getTime() - directionWindows.baseline * DAY_MS).toISOString();
  return `
SELECT u.id, u.email, u.createdAt, COALESCE(up.plan, 'free') AS plan,
       COALESCE(c.n, 0) AS competitor_count
FROM "user" u
LEFT JOIN user_plan up ON up.user_id = u.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS n
  FROM watchlist
  WHERE is_active = 1 AND tracking_role = 'competitor'
  GROUP BY user_id
) c ON c.user_id = u.id
WHERE u.createdAt >= '${cutoff}'
ORDER BY u.createdAt DESC
LIMIT 1000;
`;
}

/**
 * @param {number} reached
 * @param {number} signups
 * @returns {number | null}
 */
function shareOrNull(reached, signups) {
  if (!signups) return null;
  return reached / signups;
}

/**
 * Pure mapper: D1 rows → per-plan 7d/30d signup counts and the share that
 * currently hold >=3 active competitor watchlists. Fixtures are excluded
 * with the same SYNTHETIC_USER_PATTERNS the direction meter uses. Output
 * never carries email, id, or watchlist content.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {Date} now
 * @returns {{ windows_days: { recent: number, baseline: number }, by_plan: Array<Record<string, unknown>> }}
 */
export function evaluateTrackedCompetitorsGte3(rows, now) {
  const cutoff30 = now.getTime() - directionWindows.baseline * DAY_MS;
  const cutoff7 = now.getTime() - directionWindows.recent * DAY_MS;
  /** @type {Map<string, { plan: string, signups_7d: number, reached_gte3_7d: number, signups_30d: number, reached_gte3_30d: number }>} */
  const byPlan = new Map();
  for (const plan of TRACKED_COMPETITORS_PLANS) {
    byPlan.set(plan, {
      plan,
      signups_7d: 0,
      reached_gte3_7d: 0,
      signups_30d: 0,
      reached_gte3_30d: 0,
    });
  }

  for (const row of rows ?? []) {
    if (SYNTHETIC_USER_PATTERNS.some((pattern) => matchesSyntheticUserPattern(row, pattern))) {
      continue;
    }
    const ts = Date.parse(String(row?.createdAt ?? ""));
    if (!Number.isFinite(ts) || ts < cutoff30) continue;
    const plan = String(row?.plan ?? "free").trim() || "free";
    if (!byPlan.has(plan)) {
      byPlan.set(plan, {
        plan,
        signups_7d: 0,
        reached_gte3_7d: 0,
        signups_30d: 0,
        reached_gte3_30d: 0,
      });
    }
    const cell = byPlan.get(plan);
    const reached = Number(row?.competitor_count ?? 0) >= 3;
    cell.signups_30d += 1;
    if (reached) cell.reached_gte3_30d += 1;
    if (ts >= cutoff7) {
      cell.signups_7d += 1;
      if (reached) cell.reached_gte3_7d += 1;
    }
  }

  const by_plan = [...byPlan.values()]
    .sort((a, b) => a.plan.localeCompare(b.plan))
    .map((cell) => ({
      ...cell,
      share_7d: shareOrNull(cell.reached_gte3_7d, cell.signups_7d),
      share_30d: shareOrNull(cell.reached_gte3_30d, cell.signups_30d),
    }));

  return {
    windows_days: { ...directionWindows },
    by_plan,
  };
}

/**
 * @param {Date} now
 * @returns {{ available: boolean, detail?: string } & Record<string, unknown>}
 */
function readTrackedCompetitorsGte3(now) {
  try {
    const rows = runQuery(buildTrackedCompetitorsGte3Query(now));
    return { available: true, ...evaluateTrackedCompetitorsGte3(rows, now) };
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The --json mode (issue #3321): one read-only production read, the pure
 * meter, one JSON object. Fails honestly — any read error propagates to
 * main() and exits 1 rather than printing partial numbers. The `funnel`
 * section degrades to `available: false` with its reason instead of failing
 * the direction metric.
 *
 * @param {string | null} eventsPath
 */
async function runSignupIntegrityJson(eventsPath) {
  const rows = runQuery(buildSignupsIntegrityQuery());
  const events = eventsPath ? readSignupEventRecords(eventsPath) : null;
  const now = new Date();
  const result = evaluateSignupIntegrity(rows, now, events);
  result.generated_at = now.toISOString();
  result.funnel = await readFunnelCounts();
  result.tracked_competitors_gte3 = readTrackedCompetitorsGte3(now);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const options = parseArgs();
  if (options.json) {
    try {
      await runSignupIntegrityJson(options.eventsPath);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }
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
    console.log(
      "Direction metric (fixture-free, direction#4518): `node scripts/weekly-business-metrics.mjs --json`",
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

    printSection("9. Funnel events — visit→signup (Workers Analytics Engine)");
    const funnel = await readFunnelCounts();
    if (!funnel.available) {
      console.log(`funnel unavailable: ${String(funnel.detail)}`);
    } else {
      printTable(
        [
          { key: "kind", label: "kind" },
          { key: "events_7d", label: "events_7d" },
          { key: "events_30d", label: "events_30d" },
        ],
        funnel.kinds ?? [],
      );
      console.log(
        `\n_Source: Analytics Engine dataset \`${FUNNEL_DATASET}\`, sample-corrected counts; credentials from ${String(funnel.credential_source)}._\n`,
      );
      if (
        funnel.suggestions_accepted_per_signup_7d != null ||
        funnel.suggestions_accepted_per_signup_30d != null
      ) {
        console.log(
          `_Suggestions accepted per signup: 7d ${formatCell(funnel.suggestions_accepted_per_signup_7d)} (${formatCell(funnel.suggestion_accepted_7d)} / ${formatCell(funnel.signup_completed_7d)}), 30d ${formatCell(funnel.suggestions_accepted_per_signup_30d)} (${formatCell(funnel.suggestion_accepted_30d)} / ${formatCell(funnel.signup_completed_30d)})._\n`,
        );
      }
    }

    printSection("10. Signups reaching >=3 tracked competitors, per plan");
    const tracked = readTrackedCompetitorsGte3(new Date());
    if (!tracked.available) {
      console.log(`tracked_competitors_gte3 unavailable: ${String(tracked.detail)}`);
    } else {
      printTable(
        [
          { key: "plan", label: "plan" },
          { key: "signups_7d", label: "signups_7d" },
          { key: "reached_gte3_7d", label: "reached_gte3_7d" },
          { key: "share_7d", label: "share_7d" },
          { key: "signups_30d", label: "signups_30d" },
          { key: "reached_gte3_30d", label: "reached_gte3_30d" },
          { key: "share_30d", label: "share_30d" },
        ],
        tracked.by_plan ?? [],
      );
      console.log(
        "\n_Fixture-free signups (same SYNTHETIC_USER_PATTERNS as the direction metric). A competitor is an active watchlist with tracking_role = competitor. Share is null when a plan has zero signups in the window._\n",
      );
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
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
