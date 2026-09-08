#!/usr/bin/env node
// Regression guard for /search latency (issue #1450, accept #2).
//
// Reads the probe's runs.csv and fires when p95 time-to-first-visible-card
// exceeds the threshold for 3+ consecutive runs. It is an edge detector: it
// only fires at the START of a red streak (the run immediately before the
// streak must be green, or the history must begin at the streak). The guard
// therefore files at most one issue per regression incident instead of
// spamming one per 30-minute cron while a regression persists.
//
// Default mode creates an issue in Nishfleet/0509 via gh. Pass --dry-run to
// print what would be created without touching the GitHub API (used by the
// repo's tests and by an operator replaying the guard by hand).

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_THRESHOLD_MS = 5_000;
export const DEFAULT_REPO = "Nishfleet/0509";

// Auth-page availability guard (issue #1692). The guard fires when an auth
// page (the Sign in / Sign up CTAs) returns 5xx for 3+ consecutive runs.
export const DEFAULT_AUTH_CONSECUTIVE = 3;

/**
 * @typedef {Object} RunSample
 * @property {string} runAt
 * @property {number | null} p95Ms
 * @property {string} baseUrl
 */

/**
 * @typedef {Object} Regression
 * @property {number} thresholdMs
 * @property {RunSample[]} runs
 * @property {RunSample | null} previous
 */

/**
 * RFC-4180-style splitter matching scripts/search-latency-probe.mjs.
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  const result = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let cell = "";
      i += 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else if (line[i] === '"') {
          i += 1;
          if (line[i] === ",") i += 1;
          break;
        } else {
          cell += line[i];
          i += 1;
        }
      }
      result.push(cell);
    } else {
      const next = line.indexOf(",", i);
      if (next === -1) {
        result.push(line.slice(i));
        break;
      }
      result.push(line.slice(i, next));
      i = next + 1;
    }
  }
  return result;
}

/**
 * @param {string} path
 * @returns {{ headers: string[], rows: string[][] } | null}
 */
function readCsv(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  return { headers, rows };
}

/**
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
export function emptyOrNumber(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a runs.csv written by scripts/search-latency-probe.mjs into sorted
 * samples, dropping rows without a numeric p95.
 * @param {string} runsPath
 * @returns {RunSample[]}
 */
export function parseRuns(runsPath) {
  const csv = readCsv(runsPath);
  if (!csv) return [];

  const headers = csv.headers;
  const runAtIdx = headers.indexOf("run_at");
  const p95Idx = headers.indexOf("p95_ms");
  const baseUrlIdx = headers.indexOf("base_url");

  const runs = csv.rows
    .map((row) => ({
      runAt: row[runAtIdx] ?? "",
      p95Ms: emptyOrNumber(row[p95Idx]),
      baseUrl: row[baseUrlIdx] ?? "",
    }))
    .filter((r) => r.runAt && r.p95Ms != null)
    .sort((a, b) => a.runAt.localeCompare(b.runAt));

  return runs;
}

/**
 * Edge detector: fires when the last 3 runs are all above the threshold and
 * the run before them (if any) was not. Returns null when the guard should
 * stay quiet.
 * @param {RunSample[]} runs
 * @param {number} thresholdMs
 * @returns {Regression | null}
 */
export function detectRegression(runs, thresholdMs = DEFAULT_THRESHOLD_MS) {
  if (runs.length < 3) return null;

  const lastThree = runs.slice(-3);
  const allAbove = lastThree.every((r) => r.p95Ms !== null && r.p95Ms > thresholdMs);
  if (!allAbove) return null;

  const previous = runs[runs.length - 4];
  if (previous && previous.p95Ms !== null && previous.p95Ms > thresholdMs) {
    return null;
  }

  return {
    thresholdMs,
    runs: lastThree,
    previous: previous ?? null,
  };
}

/**
 * @param {Regression} regression
 * @returns {string}
 */
export function formatIssueBody(regression) {
  const lines = [
    "Search latency regression: p95 time-to-first-visible-card exceeded 5 seconds for 3+ consecutive runs.",
    "",
    "| run_at | base_url | p95_ms |",
    "|---|---|---|",
  ];
  for (const run of regression.runs) {
    lines.push(`| ${run.runAt} | ${run.baseUrl} | ${run.p95Ms} |`);
  }
  lines.push("");
  lines.push(`Threshold: ${regression.thresholdMs} ms`);
  lines.push("");
  lines.push("Relates to #973");
  return lines.join("\n");
}

/**
 * Parse an auth.csv written by scripts/search-latency-probe.mjs.
 * @param {string} authPath
 * @returns {Array<{ runAt: string, path: string, status: number | null, outcome: string }>}
 */
export function parseAuthRecords(authPath) {
  const csv = readCsv(authPath);
  if (!csv) return [];

  const headers = csv.headers;
  const runAtIdx = headers.indexOf("run_at");
  const pathIdx = headers.indexOf("path");
  const statusIdx = headers.indexOf("status");
  const outcomeIdx = headers.indexOf("outcome");

  return csv.rows
    .map((row) => {
      const status = emptyOrNumber(row[statusIdx]);
      return {
        runAt: row[runAtIdx] ?? "",
        path: row[pathIdx] ?? "",
        status: status,
        outcome: row[outcomeIdx] ?? "",
      };
    })
    .filter((r) => r.runAt && r.path);
}

/**
 * Group auth records into per-run rows, one per auth page, ordered by run time.
 * @param {Array<{ runAt: string, path: string, status: number | null, outcome: string }>} records
 * @returns {Map<string, Array<{ runAt: string, path: string, status: number | null, outcome: string }>>}
 */
export function groupAuthRuns(records) {
  const sorted = [...records].sort((a, b) => a.runAt.localeCompare(b.runAt));
  const byRun = new Map();
  for (const record of sorted) {
    if (!byRun.has(record.runAt)) byRun.set(record.runAt, []);
    byRun.get(record.runAt).push(record);
  }
  return byRun;
}

/**
 * Decide whether a single auth record counts as an availability failure: a
 * record is red when the page returned 5xx or was unreachable. A 4xx is not a
 * transient outage (it is a misconfiguration) so it is not treated as a
 * regression here.
 * @param {{ outcome: string }} record
 * @returns {boolean}
 */
export function isAuthFailure(record) {
  return record.outcome === "error" || record.outcome === "fetch_error";
}

/**
 * Edge detector for auth-page availability. Fires when the last
 * `consecutiveRuns` runs each had at least one auth page in a failing (5xx /
 * unreachable) state, and the run before the streak was not. One incident, one
 * issue. Returns null while the guard should stay quiet.
 * @param {Array<{ runAt: string, path: string, status: number | null, outcome: string }>} records
 * @param {number} consecutiveRuns
 * @returns {{
 *   consecutiveRuns: number,
 *   runs: Array<{ runAt: string, failures: Array<{ path: string, status: number | null }> }>,
 *   previous: { runAt: string } | null,
 *   title: string,
 * } | null}
 */
export function detectAuthRegression(records, consecutiveRuns = DEFAULT_AUTH_CONSECUTIVE) {
  const byRun = groupAuthRuns(records);
  const runs = [...byRun.keys()];
  if (runs.length < consecutiveRuns) return null;

  const runEntries = runs.map((runAt) => ({
    runAt,
    records: byRun.get(runAt),
  }));

  const lastN = runEntries.slice(-consecutiveRuns);
  const everyStreakRunRed = lastN.every((entry) =>
    entry.records.some((r) => isAuthFailure(r)),
  );
  if (!everyStreakRunRed) return null;

  const previous = runEntries[runEntries.length - consecutiveRuns - 1];
  if (previous && previous.records.some((r) => isAuthFailure(r))) {
    return null;
  }

  return {
    consecutiveRuns,
    runs: lastN.map((entry) => ({
      runAt: entry.runAt,
      failures: entry.records.filter((r) => isAuthFailure(r)).map((r) => ({
        path: r.path,
        status: r.status,
      })),
    })),
    previous: previous ? { runAt: previous.runAt } : null,
    title: `regression: /auth page returned 5xx for ${consecutiveRuns}+ consecutive runs`,
  };
}

/**
 * @param {NonNullable<ReturnType<typeof detectAuthRegression>>} regression
 * @returns {string}
 */
export function formatAuthIssueBody(regression) {
  const lines = [
    `Auth page availability regression: an auth page returned a 5xx (or was unreachable) for ${regression.consecutiveRuns}+ consecutive probe runs.`,
    "",
    "| run_at | path | status |",
    "|---|---|---|",
  ];
  for (const run of regression.runs) {
    for (const failure of run.failures) {
      lines.push(`| ${run.runAt} | ${failure.path} | ${failure.status ?? "unreachable"} |`);
    }
  }
  lines.push("");
  lines.push("Consecutive failing runs: " + String(regression.consecutiveRuns));
  return lines.join("\n");
}

/**
 * @param {string} repo
 * @param {string} title
 * @param {string} body
 * @param {boolean} dryRun
 * @returns {string | null}
 */
function openIssue(repo, title, body, dryRun) {
  if (dryRun) {
    process.stdout.write(`DRY-RUN: would create issue in ${repo}\n${title}\n\n${body}\n`);
    return null;
  }

  // The guard runs in a GitHub Actions job with the runner token; prefer the
  // GH_TOKEN the workflow sets, fall back to GITHUB_TOKEN, never inherit an
  // ambient token from the calling shell.
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  return execFileSync(
    "gh",
    ["issue", "create", "-R", repo, "--title", title, "--body", body],
    {
      env: { ...process.env, GH_TOKEN: token },
      encoding: "utf8",
    },
  );
}

/**
 * @param {string[]} argv
 * @returns {{ runsCsv: string, authCsv: string, repo: string, thresholdMs: number, dryRun: boolean, json: boolean }}
 */
function parseCliArgs(argv) {
  const parsed = {
    runsCsv: "",
    authCsv: "",
    repo: DEFAULT_REPO,
    thresholdMs: DEFAULT_THRESHOLD_MS,
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--runs-csv" && argv[i + 1]) {
      parsed.runsCsv = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--auth-csv" && argv[i + 1]) {
      parsed.authCsv = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repo" && argv[i + 1]) {
      parsed.repo = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--threshold-ms" && argv[i + 1]) {
      parsed.thresholdMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
  }
  return parsed;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.runsCsv && !args.authCsv) {
    console.error("search-latency-regression-guard: --runs-csv (or --auth-csv) is required");
    process.exit(2);
  }

  const runs = args.runsCsv ? parseRuns(args.runsCsv) : [];
  const regression = args.runsCsv ? detectRegression(runs, args.thresholdMs) : null;

  const authRegression = args.authCsv
    ? detectAuthRegression(parseAuthRecords(args.authCsv))
    : null;

  const firedAuth = authRegression ? openIssue(args.repo, authRegression.title, formatAuthIssueBody(authRegression), args.dryRun) : null;

  if (regression) {
    const title = "regression: /search p95 latency >5s for 3+ consecutive runs";
    const body = formatIssueBody(regression);
    const created = openIssue(args.repo, title, body, args.dryRun);
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ fired: true, title, created: created ? created.trim() : null, authFired: Boolean(authRegression) })}\n`,
      );
    } else {
      process.stdout.write(
        `search-latency-regression-guard: p95 > ${args.thresholdMs} ms for 3+ consecutive runs\n`,
      );
      if (authRegression) {
        process.stdout.write(
          `search-latency-regression-guard: ${authRegression.title}\n`,
        );
      }
    }
    return;
  }

  if (authRegression) {
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ fired: true, title: authRegression.title, created: firedAuth ? firedAuth.trim() : null })}\n`,
      );
    } else {
      process.stdout.write(
        `search-latency-regression-guard: ${authRegression.title}\n`,
      );
    }
    return;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ fired: false })}\n`);
  } else {
    process.stdout.write("search-latency-regression-guard: no regression\n");
  }
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}