#!/usr/bin/env node
// d1-budget: reads=300 writes=0 runs_per_day=4
/**
 * Live guard for issue #2082: surface the dominant screenshot-failure / skip
 * reasons behind the "saves the screenshots" proof promise, so a low
 * screenshot-carrying rate is never silent.
 *
 * The headline number — the 48h screenshot rate over `status='succeeded'`
 * rows — can be dragged down by a structural population whose screenshot keys
 * are deliberately stripped (the internal launch-readiness captures of 0509.io
 * itself, kind='launch_readiness_real_capture', nulled by launch-canary
 * artifact cleanup) or by budget skips. Issue #2082 acceptance 1 asks that the
 * dominant screenshot-failure / skip reasons be RECORDED (not silent) and the
 * top 3 reported with counts. This canary reads the recorded reasons off
 * `proof_capture` and reports the top reasons with counts, failing (exit 1)
 * when any capture in the window that produced no screenshot carries NO
 * recorded reason — a silent degradation the acceptance forbids.
 *
 * It is the durable companion to `canary-proof-screenshot-rate.mjs` (which
 * gates the rate on the real watcher population): this one explains WHY the
 * aggregate is low instead of letting it degrade silently. Read-only — no DDL,
 * no DML, no schema change. Runs against `--remote` (production D1) by
 * default; use `--local` to dry-run against the `wrangler dev` D1 fixture.
 *
 * Exit codes:
 *   0 — every non-screenshot capture in the window carries a recorded reason
 *       (top reasons surfaced with counts), OR the window has no such rows
 *       (SKIP — reported so silence cannot drift).
 *   1 — a capture produced no screenshot AND carries no recorded reason
 *       (silent degradation), or the dominant reason is unclassified.
 *   2 — wrangler/d1 query could not run.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATABASE_NAME = "0509";
const DEFAULT_WINDOW_HOURS = 48;

/** The internal launch-readiness capture kind whose screenshot keys are
 * deliberately stripped by launch-canary artifact cleanup (see
 * app/lib/data/launch-canary-cleanup.server.ts →
 * app/lib/proof-artifact-retention.server.ts). Structural, not a regression. */
export const CANARY_KIND = "launch_readiness_real_capture";

/** Reasons that are STRUCTURAL (deliberate, not a capture-path regression) and
 * are surfaced as such rather than treated as silent degradation.
 * `skipped_due_to_budget` is the actual `proof_capture.skip_reason` value the
 * capture path writes (monitoring.server.ts); `budget_skip` is retained as the
 * generic label the human-report tests use. */
export const STRUCTURAL_REASONS = new Set([
  "launch_canary_stripped",
  "budget_skip",
  "skipped_due_to_budget",
]);

/** Reasons that mean a capture produced no screenshot AND no recorded reason
 * exists — the silent degradation the acceptance forbids. */
export const SILENT_REASONS = new Set([
  "succeeded_no_screenshot_unclassified",
  "failed_unclassified",
  "budget_skip_unclassified",
  "unclassified",
]);

/**
 * @param {string[]} argv
 * @returns {{local: boolean, json: boolean, windowHours: number}}
 */
export function parseArgs(argv) {
  /** @type {{local: boolean, json: boolean, windowHours: number}} */
  const parsed = {
    local: false,
    json: false,
    windowHours: DEFAULT_WINDOW_HOURS,
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
    throw new Error(
      `Unknown argument: ${arg}. Supported: --local, --json, --window-hours <int>.`,
    );
  }
  return parsed;
}

/**
 * One row per recorded screenshot-failure / skip reason over the window, for
 * every capture that produced no screenshot (succeeded-without-key, failed,
 * skipped). Integer-concatenated window (no SQL interpolation), mirroring
 * canary-proof-screenshot-rate.
 *
 * Reason derivation:
 *   - succeeded without a screenshot key + kind='launch_readiness_real_capture'
 *     -> `launch_canary_stripped` (structural: cleanup nulls the key by design)
 *   - succeeded without a screenshot key otherwise -> `succeeded_no_screenshot_unclassified`
 *   - failed -> `failure_code` (or `failed_unclassified` when empty)
 *   - skipped_due_to_budget -> `skip_reason` (or `budget_skip_unclassified`)
 *   - any other status -> `unclassified`
 *
 * @param {number} windowHours
 */
export function buildReasonQuery(windowHours) {
  return `
    SELECT
      CASE
        WHEN status = 'succeeded'
          AND json_extract(capture_metadata_json, '$.kind') = '${CANARY_KIND}'
          THEN 'launch_canary_stripped'
        WHEN status = 'succeeded' THEN 'succeeded_no_screenshot_unclassified'
        WHEN status = 'failed'
          THEN COALESCE(NULLIF(failure_code, ''), 'failed_unclassified')
        WHEN status = 'skipped_due_to_budget'
          THEN COALESCE(NULLIF(skip_reason, ''), 'budget_skip_unclassified')
        ELSE 'unclassified'
      END AS reason,
      COUNT(*) AS n
    FROM proof_capture
    WHERE created_at >= datetime('now', '-' || ${Math.floor(windowHours)} || ' hours')
      AND NOT (
        status = 'succeeded'
        AND screenshot_artifact_key IS NOT NULL
        AND TRIM(screenshot_artifact_key) != ''
      )
    GROUP BY reason
    ORDER BY n DESC;
  `.trim();
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
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<{reason: string, n: number}>} reasons sorted by count desc
 */
export function mapReasonRows(rows) {
  return rows
    .map((row) => ({
      reason: String(row.reason ?? "unclassified"),
      n: Number(row.n ?? 0),
    }))
    .filter((row) => row.n > 0)
    .sort((a, b) => b.n - a.n);
}

/**
 * @param {{reasons: Array<{reason: string, n: number}>, windowHours: number}} input
 * @returns {{verdict: "pass" | "fail" | "skip", failures: string[], skips: string[], silent: Array<{reason: string, n: number}>}}
 */
export function validateReasons({ reasons, windowHours }) {
  const failures = [];
  const skips = [];
  const silent = reasons.filter((row) => SILENT_REASONS.has(row.reason));
  const total = reasons.reduce((sum, row) => sum + row.n, 0);

  if (total === 0) {
    skips.push(
      `no screenshot-less captures in the last ${windowHours}h (n=0); nothing to judge — reported so silence cannot drift.`,
    );
  } else if (silent.length > 0) {
    for (const row of silent) {
      failures.push(
        `silent screenshot degradation: ${row.n} capture(s) produced no screenshot and carried no recorded reason (reason='${row.reason}').`,
      );
    }
  }

  return {
    verdict: failures.length > 0 ? "fail" : skips.length > 0 ? "skip" : "pass",
    failures,
    skips,
    silent,
  };
}

/**
 * @param {{reasons: Array<{reason: string, n: number}>, windowHours: number, checkedAt: string, local: boolean}} input
 * @returns {{ok: boolean, verdict: "pass" | "fail" | "skip", local: boolean, windowHours: number, database: string, checkedAt: string, total: number, reasons: Array<{reason: string, n: number}>, top3: Array<{reason: string, n: number}>, silent: Array<{reason: string, n: number}>, failures: string[], skips: string[]}}
 */
export function summarize(input) {
  const { reasons, windowHours, checkedAt, local } = input;
  const validation = validateReasons({ reasons, windowHours });
  const total = reasons.reduce((sum, row) => sum + row.n, 0);
  const top3 = reasons.slice(0, 3);
  return {
    ok: validation.verdict !== "fail",
    verdict: validation.verdict,
    local,
    windowHours,
    database: DATABASE_NAME,
    checkedAt,
    total,
    reasons,
    top3,
    silent: validation.silent,
    failures: validation.failures,
    skips: validation.skips,
  };
}

/**
 * @param {{reasons: Array<{reason: string, n: number}>, windowHours: number, checkedAt: string, local: boolean}} input
 * @returns {string}
 */
export function renderHumanReport(input) {
  const s = summarize(input);
  const lines = [];
  lines.push(
    `proof-screenshot-reasons canary (mode=${s.local ? "local" : "remote"}, window=${s.windowHours}h at ${s.checkedAt})`,
  );
  if (s.total === 0) {
    lines.push(`no screenshot-less captures in the last ${s.windowHours}h (n=0).`);
    lines.push(`verdict: skip — ${s.skips.join(" ")}`);
    return lines.join("\n");
  }
  lines.push(`screenshot-less captures in window: ${s.total}`);
  lines.push(`top reasons (count):`);
  for (const row of s.reasons) {
    const structural = STRUCTURAL_REASONS.has(row.reason) ? " [structural]" : "";
    const silent = SILENT_REASONS.has(row.reason) ? " [SILENT]" : "";
    lines.push(`- ${row.reason}${structural}${silent}: ${row.n}`);
  }
  if (s.verdict === "pass") {
    lines.push(`verdict: ok — every screenshot-less capture carries a recorded reason; top 3: ${s.top3.map((r) => `${r.reason} (${r.n})`).join(", ")}.`);
  } else if (s.verdict === "skip") {
    lines.push(`verdict: skip — ${s.skips.join(" ")}`);
  } else {
    lines.push(`verdict: FAILED —`);
    for (const failure of s.failures) {
      lines.push(`- ${failure}`);
    }
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkedAt = new Date().toISOString();
  const query = buildReasonQuery(args.windowHours);
  const wranglerArgs = [
    "wrangler",
    "d1",
    "execute",
    DATABASE_NAME,
    args.local ? "--local" : "--remote",
    "--json",
    "--command",
    query,
  ];
  const result = spawnSync("npx", wranglerArgs, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: message, mode: args.local ? "local" : "remote", windowHours: args.windowHours }, null, 2));
    } else {
      console.error(`proof-screenshot-reasons canary: ${message}`);
    }
    process.exit(2);
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: message, mode: args.local ? "local" : "remote", windowHours: args.windowHours }, null, 2));
    } else {
      console.error(`proof-screenshot-reasons canary: wrangler d1 execute failed${message ? `: ${message}` : ""}`);
    }
    process.exit(2);
  }

  const rows = rowsFromWranglerJson(result.stdout ?? "");
  const reasons = mapReasonRows(rows);
  const report = summarize({ reasons, windowHours: args.windowHours, checkedAt, local: args.local });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHumanReport({ reasons, windowHours: args.windowHours, checkedAt, local: args.local }));
  }

  process.exit(report.verdict === "fail" ? 1 : 0);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}