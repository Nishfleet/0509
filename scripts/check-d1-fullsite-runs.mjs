#!/usr/bin/env node
/**
 * Full-Site Watch liveness canary for issue #2110. The broad rollout
 * (FULLSITE_WATCH_CANARY_HOSTS emptied in wrangler.jsonc, flag kept on)
 * means every scheduled monitoring cycle may write `website_site_scan`
 * rows to production D1. A silently dead full-site scan path leaves that
 * table empty; this check fails loud when that happens.
 *
 * Exit codes:
 *   0 — `website_site_scan` has at least one row, OR the table is empty but
 *       the grace instant FULLSITE_RUNS_GRACE_UNTIL has not passed yet
 *       (prints WARN so the empty table is visible in the canary log).
 *   1 — `website_site_scan` has 0 rows AND now is past
 *       FULLSITE_RUNS_GRACE_UNTIL.
 *   2 — wrangler/d1 query could not run.
 *
 * The check reads only — no DDL, no DML. It runs against `--remote`
 * (production D1) by default. Use `--local` to dry-run against the
 * `wrangler dev` D1 fixture. The query is constant and idempotent.
 *
 * Usage:
 *   node scripts/check-d1-fullsite-runs.mjs [--local] [--json] [--help]
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATABASE_NAME = "0509";

/**
 * Grace instant for the broad rollout: the first scheduled scan after the
 * 2026-09-09 deploy needs time to land rows. An empty table before this
 * instant is a WARN (exit 0); an empty table once now is PAST this instant
 * means the scan path is silently dead and the canary exits 1.
 */
export const FULLSITE_RUNS_GRACE_UNTIL = "2026-09-11T00:00:00Z";

const USAGE = `check-d1-fullsite-runs — Full-Site Watch liveness canary (issue #2110)

Usage:
  node scripts/check-d1-fullsite-runs.mjs [--local] [--json] [--help]

Options:
  --local   Query the local \`wrangler dev\` D1 fixture instead of --remote.
  --json    Print the verdict as JSON instead of human-readable lines.
  --help    Print this help and exit 0.

Exit codes:
  0  website_site_scan has rows, or it is empty before the grace instant
     (${FULLSITE_RUNS_GRACE_UNTIL}) — prints WARN.
  1  website_site_scan has 0 rows and now is past the grace instant.
  2  the wrangler/d1 query could not run.
`;

/**
 * @param {string[]} argv
 * @returns {{ local: boolean, json: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ local: boolean, json: boolean, help: boolean }} */
  const parsed = { local: false, json: false, help: false };
  for (const arg of argv) {
    if (arg === "--local") {
      parsed.local = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}. Supported: --local, --json, --help.`);
  }
  return parsed;
}

/**
 * Parse wrangler `d1 execute --json` into result rows. Wrangler wraps the
 * D1 response in either an array or a single object depending on version.
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

/** Read-only row count over the full-site scan manifest table. */
export function buildFullSiteRunsQuery() {
  return "SELECT COUNT(*) AS scan_count FROM website_site_scan;";
}

/**
 * Fail closed: a missing or unreadable count is a query failure (exit 2),
 * not a silent "0 rows" that would later trip the liveness canary.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {number}
 */
export function scanCountFromRows(rows) {
  const first = rows[0];
  const value = Number(first?.scan_count);
  if (first == null || !Number.isFinite(value) || value < 0) {
    throw new Error("fullsite-runs canary: wrangler JSON did not include a trustworthy scan_count");
  }
  return Math.floor(value);
}

/**
 * The grace verdict, pure so the unit test can drive it with a fake clock.
 * "Past the grace constant" is strict: at exactly FULLSITE_RUNS_GRACE_UNTIL
 * the window has not passed yet and an empty table is still a WARN.
 *
 * @param {{ rowCount: number, now: Date }} input
 * @returns {{ ok: boolean, warned: boolean, pastGrace: boolean, rowCount: number }}
 */
export function evaluateFullSiteRuns(input) {
  const pastGrace = input.now.getTime() > Date.parse(FULLSITE_RUNS_GRACE_UNTIL);
  if (input.rowCount > 0) {
    return { ok: true, warned: false, pastGrace, rowCount: input.rowCount };
  }
  if (!pastGrace) {
    return { ok: true, warned: true, pastGrace, rowCount: 0 };
  }
  return { ok: false, warned: false, pastGrace, rowCount: 0 };
}

/**
 * @param {{ local: boolean }} input
 * @returns {number}
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
    buildFullSiteRunsQuery(),
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
  return scanCountFromRows(rowsFromWranglerJson(result.stdout ?? ""));
}

/**
 * @param {{ local: boolean, verdict: ReturnType<typeof evaluateFullSiteRuns>, now: Date }} report
 */
function renderHumanReport(report) {
  const lines = [];
  lines.push(
    `fullsite-runs canary (mode=${report.local ? "local" : "remote"}, now=${report.now.toISOString()}, graceUntil=${FULLSITE_RUNS_GRACE_UNTIL})`,
  );
  lines.push(`- website_site_scan rows: ${report.verdict.rowCount}`);
  if (report.verdict.rowCount > 0) {
    lines.push("verdict: ok — full-site scans are landing rows.");
  } else if (report.verdict.warned) {
    lines.push(
      `verdict: WARN — website_site_scan has 0 rows but the grace instant ${FULLSITE_RUNS_GRACE_UNTIL} has not passed; exiting 0 until then.`,
    );
  } else {
    lines.push(
      `verdict: failed — website_site_scan has 0 rows and now is past the grace instant ${FULLSITE_RUNS_GRACE_UNTIL}; the full-site scan path is silently dead.`,
    );
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  let rowCount;
  try {
    rowCount = runCanaryQuery({ local: args.local });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      console.log(
        JSON.stringify(
          { ok: false, error: message, mode: args.local ? "local" : "remote" },
          null,
          2,
        ),
      );
    } else {
      console.error(`fullsite-runs canary: ${message}`);
    }
    process.exit(2);
  }
  const now = new Date();
  const verdict = evaluateFullSiteRuns({ rowCount, now });
  const report = {
    ok: verdict.ok,
    warned: verdict.warned,
    pastGrace: verdict.pastGrace,
    rowCount: verdict.rowCount,
    graceUntil: FULLSITE_RUNS_GRACE_UNTIL,
    local: args.local,
    database: DATABASE_NAME,
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHumanReport({ local: args.local, verdict, now }));
  }
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
