#!/usr/bin/env node
// d1-budget: reads=300 writes=0 runs_per_day=4
/**
 * Live canary for issue #1287: every `skipped_due_to_budget` proof_capture
 * row over a 72 h window must surface a user-visible reason (a non-null
 * `skip_reason`), and the per-workspace volume of paid-tier budget skips
 * must stay below a sane alert threshold. The unit-level surface guard
 * lives in `tests/run-history-capture-visibility.test.ts`; this script is
 * the live production canary the unit guard cannot reach.
 *
 * Exit codes:
 *   0 — every budget-skip row over the window has a non-null skip_reason
 *       AND the per-workspace paid-tier skip count is below the alert
 *       threshold.
 *   1 — silent budget skip detected (a row with status='skipped_due_to_budget'
 *       and skip_reason IS NULL), or per-workspace volume above threshold.
 *   2 — wrangler/d1 query could not run.
 *
 * The canary reads only — no DDL, no DML. It runs against `--remote`
 * (production D1) by default. Use `--local` to dry-run against the
 * `wrangler dev` D1 fixture. The query is constant and idempotent.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATABASE_NAME = "0509";
const DEFAULT_WINDOW_HOURS = 72;
const DEFAULT_PAID_PER_WORKSPACE_ALERT_THRESHOLD = 100;
const PAID_PLANS = new Set(["scout", "starter", "agency"]);

/**
 * @param {string[]} argv
 * @returns {{ local: boolean, json: boolean, windowHours: number, paidThreshold: number }}
 */
export function parseArgs(argv) {
  /** @type {{ local: boolean, json: boolean, windowHours: number, paidThreshold: number }} */
  const parsed = {
    local: false,
    json: false,
    windowHours: DEFAULT_WINDOW_HOURS,
    paidThreshold: DEFAULT_PAID_PER_WORKSPACE_ALERT_THRESHOLD,
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
    if (arg === "--window-hours" && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.windowHours = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--paid-threshold" && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.paidThreshold = value;
      }
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --local, --json, --window-hours <int>, --paid-threshold <int>.`,
    );
  }
  return parsed;
}

/**
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
 * @param {number} windowHours
 */
export function buildBudgetSkipSurfaceQuery(windowHours) {
  // One row per (workspace_user_id, plan) so the canary can flag silent
  // drops (skip_reason IS NULL) AND over-volume per paid workspace in the
  // same query. The plan lookup joins watchlist → user_plan so the canary
  // reports the actual tier the customer is on, not a stale cache.
  return `
    SELECT
      w.user_id AS workspace_user_id,
      COALESCE(up.plan, 'free') AS plan,
      SUM(CASE WHEN pc.status = 'skipped_due_to_budget' THEN 1 ELSE 0 END) AS budget_skips_total,
      SUM(CASE WHEN pc.status = 'skipped_due_to_budget' AND pc.skip_reason IS NULL THEN 1 ELSE 0 END) AS budget_skips_silent,
      MIN(CASE WHEN pc.status = 'skipped_due_to_budget' THEN pc.created_at END) AS first_budget_skip_at,
      MAX(CASE WHEN pc.status = 'skipped_due_to_budget' THEN pc.created_at END) AS last_budget_skip_at
    FROM proof_capture pc
    INNER JOIN proof_target pt ON pt.id = pc.proof_target_id
    INNER JOIN watchlist w ON w.id = pt.watchlist_id
    LEFT JOIN user_plan up ON up.user_id = w.user_id
    WHERE pc.created_at > datetime('now', '-' || ${Math.floor(windowHours)} || ' hours')
    GROUP BY w.user_id, COALESCE(up.plan, 'free')
    ORDER BY budget_skips_total DESC, workspace_user_id ASC;
  `.trim();
}

/**
 * @typedef {{
 *   workspaceUserId: string,
 *   plan: string,
 *   budgetSkipsTotal: number,
 *   budgetSkipsSilent: number,
 *   firstBudgetSkipAt: string | null,
 *   lastBudgetSkipAt: string | null,
 * }} WorkspaceBudgetSkipRow
 */

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {WorkspaceBudgetSkipRow[]}
 */
export function mapBudgetSkipRows(rows) {
  return rows
    .map((row) => ({
      workspaceUserId: String(row.workspace_user_id ?? ""),
      plan: String(row.plan ?? "free"),
      budgetSkipsTotal: Number(row.budget_skips_total ?? 0),
      budgetSkipsSilent: Number(row.budget_skips_silent ?? 0),
      firstBudgetSkipAt:
        typeof row.first_budget_skip_at === "string" ? row.first_budget_skip_at : null,
      lastBudgetSkipAt:
        typeof row.last_budget_skip_at === "string" ? row.last_budget_skip_at : null,
    }))
    .filter((row) => row.workspaceUserId.length > 0 && row.budgetSkipsTotal > 0);
}

/**
 * @param {{
 *   windowHours: number,
 *   paidThreshold: number,
 *   rows: WorkspaceBudgetSkipRow[],
 * }} input
 * @returns {{ ok: boolean, failures: string[], silentRows: WorkspaceBudgetSkipRow[], overVolumeRows: WorkspaceBudgetSkipRow[] }}
 */
export function validateBudgetSkipSurface(input) {
  /** @type {string[]} */
  const failures = [];
  const silentRows = input.rows.filter((row) => row.budgetSkipsSilent > 0);
  if (silentRows.length > 0) {
    const sample = silentRows
      .slice(0, 5)
      .map(
        (row) =>
          `${row.workspaceUserId} (${row.plan}, ${row.budgetSkipsSilent}/${row.budgetSkipsTotal} silent)`,
      )
      .join(", ");
    failures.push(
      `silent budget skips detected in ${silentRows.length} workspace(s): ${sample}.`,
    );
  }
  const overVolumeRows = input.rows.filter(
    (row) => PAID_PLANS.has(row.plan) && row.budgetSkipsTotal > input.paidThreshold,
  );
  if (overVolumeRows.length > 0) {
    const sample = overVolumeRows
      .slice(0, 5)
      .map(
        (row) =>
          `${row.workspaceUserId} (${row.plan}, ${row.budgetSkipsTotal} skips > ${input.paidThreshold} threshold)`,
      )
      .join(", ");
    failures.push(
      `paid-tier workspace(s) exceeded ${input.paidThreshold} budget skips in ${input.windowHours}h: ${sample}.`,
    );
  }
  return { ok: failures.length === 0, failures, silentRows, overVolumeRows };
}

/**
 * @param {{ local: boolean, windowHours: number }} input
 * @returns {WorkspaceBudgetSkipRow[]}
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
    buildBudgetSkipSurfaceQuery(input.windowHours),
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
  return mapBudgetSkipRows(rowsFromWranglerJson(result.stdout ?? ""));
}

/**
 * @param {{
 *   windowHours: number,
 *   paidThreshold: number,
 *   rows: WorkspaceBudgetSkipRow[],
 *   validation: ReturnType<typeof validateBudgetSkipSurface>,
 *   local: boolean,
 * }} report
 */
function renderHumanReport(report) {
  const lines = [];
  lines.push(
    `proof-budget-skip-surface canary (mode=${report.local ? "local" : "remote"}, window=${report.windowHours}h, paidThreshold=${report.paidThreshold})`,
  );
  lines.push(`- workspaces with at least one budget skip: ${report.rows.length}`);
  if (report.rows.length === 0) {
    lines.push("- no `skipped_due_to_budget` rows in the window.");
  } else {
    for (const row of report.rows.slice(0, 10)) {
      lines.push(
        `- ${row.workspaceUserId} (${row.plan}): ${row.budgetSkipsTotal} skips, ${row.budgetSkipsSilent} silent, first=${row.firstBudgetSkipAt ?? "n/a"}, last=${row.lastBudgetSkipAt ?? "n/a"}`,
      );
    }
    if (report.rows.length > 10) {
      lines.push(`- …and ${report.rows.length - 10} more workspace(s).`);
    }
  }
  if (report.validation.failures.length === 0) {
    lines.push("verdict: ok — every budget skip is visible; no paid workspace over the volume threshold.");
  } else {
    lines.push("verdict: failed — see failures:");
    for (const failure of report.validation.failures) {
      lines.push(`- ${failure}`);
    }
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let rows;
  try {
    rows = runCanaryQuery({ local: args.local, windowHours: args.windowHours });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: message,
            mode: args.local ? "local" : "remote",
            windowHours: args.windowHours,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`proof-budget-skip-surface canary: ${message}`);
    }
    process.exit(2);
  }
  const validation = validateBudgetSkipSurface({
    windowHours: args.windowHours,
    paidThreshold: args.paidThreshold,
    rows,
  });
  const report = {
    ok: validation.ok,
    local: args.local,
    windowHours: args.windowHours,
    paidThreshold: args.paidThreshold,
    database: DATABASE_NAME,
    rows,
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
