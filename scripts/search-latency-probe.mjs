#!/usr/bin/env node
// Continuous /search latency probe for the BET 2 25-domain set (issue #1450).
//
// Runs the 25-domain list against production /search, records
// time_to_first_visible_card (DOM ready -> first result row with text visible)
// and response size per domain, and persists three CSV artifacts:
//
//   runs.csv  - one row per probe run (p95/p50/mean time-to-first-card, bytes)
//   cards.csv - one row per domain per run (per-domain timing + response size)
//   daily.csv - per-UTC-day rollup over all runs of that day
//
// Every HTTP call goes through the same sliding-window rate limiter as
// bet2-live-verification.mjs (20 req / 10 min / IP, enforcePublicSearchRateLimit),
// so the probe never trips the anonymous /search budget it is measuring.
//
// The script is measurement, not verdict: it never fails the run because a
// domain is slow. The p95>5s verdict belongs to the regression guard
// (scripts/search-latency-regression-guard.mjs), which reads runs.csv.
//
// The scheduled execution (a GitHub Actions workflow, cron */30) is a CI-path
// change that lands separately; this script is its payload.

import { existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BET2_DOMAINS,
  DEFAULT_BASE_URL,
  runLiveVerification,
} from "./bet2-live-verification.mjs";

export const SEARCH_LATENCY_PROBE_USER_AGENT = "0509-search-latency-probe/1.0";

// Default automation state directory for the CSV artifacts. The scheduled
// workflow passes --output-dir explicitly; this constant documents the
// convention the workflow and the regression guard agree on.
export const DEFAULT_STATE_DIR = "ops/search-latency";

const RUNS_FILE = "runs.csv";
const CARDS_FILE = "cards.csv";
const DAILY_FILE = "daily.csv";

// Only timing metric + response size are persisted: no query text, no cookies,
// no account identifiers. Accept #4 of issue #1450 pins this list.
export const RUNS_HEADERS = Object.freeze([
  "run_at",
  "run_date",
  "base_url",
  "domains",
  "p95_ms",
  "p50_ms",
  "mean_ms",
  "samples",
  "total_bytes",
  "error_domains",
  "rate_limited_domains",
]);

export const CARDS_HEADERS = Object.freeze([
  "run_at",
  "domain",
  "time_to_first_visible_card_ms",
  "response_size_bytes",
  "status",
  "outcome",
]);

export const DAILY_HEADERS = Object.freeze([
  "date",
  "p95_ms",
  "p50_ms",
  "mean_ms",
  "runs",
  "samples",
  "total_bytes",
]);

// Auth-page availability probe (issue #1692). The Sign in / Sign up CTAs on
// the /search preview link to these two pages; a 503 there blocks the only
// conversion path at the first-value moment. The probe records their HTTP
// status so the regression guard can detect a 5xx streak.
export const AUTH_PAGES = Object.freeze(["/auth/login", "/auth/signup"]);

export const AUTH_HEADERS = Object.freeze([
  "run_at",
  "path",
  "status",
  "outcome",
  "elapsed_ms",
]);

// Pacing between the two auth-page fetches. The auth pages are separate
// endpoints from /search and never touch the anonymous /search budget (20
// req / 10 min / IP), but they must stay low-frequency: a 1s gap keeps the
// whole pair under the shared-VPS rate limit that caused the original 503
// (issue #1692 observed).
export const AUTH_PROBE_SPACING_MS = 1_000;

// Anonymous first-value canary (issue #1972). A fresh no-cookie /search walk
// that asserts the result step is reachable (not a 429) on the shared IP.
// Uses its own user-agent so the per-browser bucket is not the visitor's, and
// sends no Cookie header so it matches a first-time evaluator. One GET per
// probe run cannot fill the 100/10min per-IP backstop, so it does not create
// the false-positive 429 it guards against.
export const FIRST_VALUE_PATH = "/search?q=nike&country=all";
export const FIRST_VALUE_PROBE_USER_AGENT = "0509-anonymous-first-value-canary/1.0";
export const FIRST_VALUE_HEADERS = Object.freeze([
  "run_at",
  "path",
  "status",
  "outcome",
  "retry_after",
  "elapsed_ms",
]);

/**
 * @typedef {Object} LatencyStats
 * @property {number | null} p95Ms
 * @property {number | null} p50Ms
 * @property {number | null} meanMs
 * @property {number} samples
 * @property {number} totalBytes
 * @property {number} errorDomains
 * @property {number} rateLimitedDomains
 */

/**
 * @typedef {Object} RunRecord
 * @property {string} runAt
 * @property {string} runDate
 * @property {string} baseUrl
 * @property {number} domains
 * @property {number | null} p95Ms
 * @property {number | null} p50Ms
 * @property {number | null} meanMs
 * @property {number} samples
 * @property {number} totalBytes
 * @property {number} errorDomains
 * @property {number} rateLimitedDomains
 */

/**
 * @param {string} dir
 */
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeCsv(value) {
  const s = value == null ? "" : String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {unknown[]} row
 * @returns {string}
 */
function rowToCsv(row) {
  return row.map(escapeCsv).join(",");
}

/**
 * RFC-4180-style splitter for the values this repo writes (no quoted cells
 * unless the value contains a separator, in which case quotes are doubled).
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
 * @param {string} path
 * @param {string[]} headers
 * @param {string[][]} rows
 */
function appendCsv(path, headers, rows) {
  let text = "";
  if (!existsSync(path)) {
    text += `${rowToCsv(headers)}\n`;
  }
  for (const row of rows) {
    text += `${rowToCsv(row)}\n`;
  }
  writeFileSync(path, text, { flag: "a" });
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
 * Nearest-rank percentile over a sorted sample. Mirrors the bet2 p95 helper
 * so the probe and the campaign agree on the statistic.
 * @param {number[]} sorted
 * @param {number} p
 * @returns {number | null}
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length) - 1;
  const clamped = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[clamped];
}

/**
 * Aggregate per-probe timings into the run-level latency statistics.
 * @param {Array<{ firstCardAtMs?: number | null, bodyBytes?: number, outcome: string }>} results
 * @returns {LatencyStats}
 */
export function computeLatencyStats(results) {
  const samples = /** @type {number[]} */ (
    results
      .map((r) => r.firstCardAtMs)
      .filter(
        /** @param {number | null | undefined} ms @returns {ms is number} */
        (ms) => typeof ms === "number" && ms >= 0,
      )
      .sort((a, b) => a - b)
  );
  const totalBytes = results.reduce((sum, r) => sum + (r.bodyBytes ?? 0), 0);
  const errorDomains = results.filter((r) => r.outcome === "error").length;
  const rateLimitedDomains = results.filter(
    (r) => r.outcome === "rate_limited",
  ).length;
  return {
    p95Ms: percentile(samples, 0.95),
    p50Ms: percentile(samples, 0.5),
    meanMs: samples.length
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : null,
    samples: samples.length,
    totalBytes,
    errorDomains,
    rateLimitedDomains,
  };
}

/**
 * The machine-readable metric line the probe emits and CI greps for. Field
 * names are snake_case and stable: changing one breaks the acceptance test.
 * @param {{ runAt: string, baseUrl: string, stats: LatencyStats }} input
 * @returns {string}
 */
export function formatMetricLine({ runAt, baseUrl, stats }) {
  /** @param {number | null} n */
  const num = (n) => (n == null ? "n/a" : String(n));
  return [
    "search_latency_probe",
    `run=${runAt}`,
    `base_url=${baseUrl}`,
    `time_to_first_visible_card_p95_ms=${num(stats.p95Ms)}`,
    `time_to_first_visible_card_p50_ms=${num(stats.p50Ms)}`,
    `time_to_first_visible_card_mean_ms=${num(stats.meanMs)}`,
    `samples=${stats.samples}`,
    `total_response_bytes=${stats.totalBytes}`,
    `error_domains=${stats.errorDomains}`,
    `rate_limited_domains=${stats.rateLimitedDomains}`,
  ].join(" ");
}

/**
 * @param {string} runAt
 * @param {string} baseUrl
 * @param {Array<{ firstCardAtMs?: number | null, bodyBytes?: number, outcome: string }>} results
 * @returns {RunRecord}
 */
function buildRunRecord(runAt, baseUrl, results) {
  const stats = computeLatencyStats(results);
  return {
    runAt,
    runDate: runAt.slice(0, 10),
    baseUrl,
    domains: results.length,
    ...stats,
  };
}

/**
 * @param {string} runAt
 * @param {Array<{ domain: string, firstCardAtMs?: number | null, bodyBytes?: number, status?: number | null, outcome: string }>} results
 * @returns {string[][]}
 */
function buildCardRows(runAt, results) {
  return results.map((r) => [
    runAt,
    r.domain,
    r.firstCardAtMs == null ? "" : String(r.firstCardAtMs),
    String(r.bodyBytes ?? 0),
    r.status == null ? "" : String(r.status),
    r.outcome,
  ]);
}

/**
 * @param {string} outputDir
 * @param {RunRecord} runRecord
 * @param {string[][]} cardRows
 */
function writeRunAndCards(outputDir, runRecord, cardRows) {
  const runRow = [
    runRecord.runAt,
    runRecord.runDate,
    runRecord.baseUrl,
    String(runRecord.domains),
    runRecord.p95Ms == null ? "" : String(runRecord.p95Ms),
    runRecord.p50Ms == null ? "" : String(runRecord.p50Ms),
    runRecord.meanMs == null ? "" : String(runRecord.meanMs),
    String(runRecord.samples),
    String(runRecord.totalBytes),
    String(runRecord.errorDomains),
    String(runRecord.rateLimitedDomains),
  ];
  appendCsv(join(outputDir, RUNS_FILE), [...RUNS_HEADERS], [runRow]);
  appendCsv(join(outputDir, CARDS_FILE), [...CARDS_HEADERS], cardRows);
}

/**
 * Rewrite daily.csv so the per-day rollup always reflects every run that has
 * touched cards.csv, including rewritten rows from a re-run of the same day.
 * @param {string} outputDir
 * @param {RunRecord} runRecord
 */
function updateDailySummary(outputDir, runRecord) {
  const cards = readCsv(join(outputDir, CARDS_FILE));
  if (!cards) return;

  const date = runRecord.runDate;
  const runAtIdx = cards.headers.indexOf("run_at");
  const timeIdx = cards.headers.indexOf("time_to_first_visible_card_ms");
  const sizeIdx = cards.headers.indexOf("response_size_bytes");

  const dayCards = cards.rows.filter((row) => {
    const runAt = row[runAtIdx];
    return typeof runAt === "string" && runAt.startsWith(date);
  });

  const times = /** @type {number[]} */ (
    dayCards
      .map((row) => emptyOrNumber(row[timeIdx]))
      .filter(
        /** @param {number | null} n @returns {n is number} */
        (n) => n !== null,
      )
      .sort((a, b) => a - b)
  );
  const totalBytes = dayCards.reduce(
    (sum, row) => sum + (emptyOrNumber(row[sizeIdx]) ?? 0),
    0,
  );
  const runs = new Set(dayCards.map((row) => row[runAtIdx])).size;
  const samples = times.length;
  const p95 = percentile(times, 0.95);
  const p50 = percentile(times, 0.5);
  const mean = samples
    ? Math.round(times.reduce((a, b) => a + b, 0) / samples)
    : null;

  const dailyPath = join(outputDir, DAILY_FILE);
  const daily = readCsv(dailyPath);
  const row = [
    date,
    p95 == null ? "" : String(p95),
    p50 == null ? "" : String(p50),
    mean == null ? "" : String(mean),
    String(runs),
    String(samples),
    String(totalBytes),
  ];

  if (!daily) {
    writeFileSync(dailyPath, `${rowToCsv([...DAILY_HEADERS])}\n${rowToCsv(row)}\n`);
    return;
  }

  const dateIdx = daily.headers.indexOf("date");
  let found = false;
  const rows = daily.rows.map((r) => {
    if (r[dateIdx] === date) {
      found = true;
      return row;
    }
    return r;
  });
  if (!found) {
    rows.push(row);
  }

  writeFileSync(
    dailyPath,
    `${rowToCsv([...DAILY_HEADERS])}\n${rows.map(rowToCsv).join("\n")}\n`,
  );
}

// Any 5xx (or a transport error) on an auth page is an availability failure
// for the guard to detect. 4xx statuses are recorded but not treated as an
// outage: a 404/401 on an auth route is a misconfiguration, not a transient
// availability blip.
/**
 * @param {number | null} status
 */
export function authOutcome(status) {
  if (status == null) return "fetch_error";
  if (status >= 500) return "error";
  return "ok";
}

/** @param {number} ms */
async function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch each auth page and record its HTTP status. Not paced by the /search
 * limiter: these are separate endpoints that must stay low-frequency (a fixed
 * gap between them), and must never be counted against the anonymous /search
 * budget. Network errors are recorded as a fetch_error outcome.
 *
 * @param {{
 *   baseUrl?: string,
 *   paths?: readonly string[],
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   userAgent?: string,
 * }} [input]
 * @returns {Promise<Array<{ runAt: string, path: string, status: number | null, outcome: string, elapsedMs: number }>>}
 */
export async function probeAuthPages({
  baseUrl = DEFAULT_BASE_URL,
  paths = AUTH_PAGES,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  nowImpl = () => Date.now(),
  userAgent = SEARCH_LATENCY_PROBE_USER_AGENT,
} = {}) {
  const runAt = new Date().toISOString();
  const records = [];
  for (const path of paths) {
    const startedAt = nowImpl();
    let status = null;
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "GET",
        headers: {
          "user-agent": userAgent,
          "cache-control": "no-cache",
          pragma: "no-cache",
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      status = response.status;
      await response.text();
    } catch (_error) {
      status = null;
    }
    const elapsedMs = nowImpl() - startedAt;
    records.push({
      runAt,
      path,
      status,
      outcome: authOutcome(status),
      elapsedMs,
    });
    await sleepImpl(AUTH_PROBE_SPACING_MS);
  }
  return records;
}

/**
 * The auth-availability metric line the probe emits and CI greps for.
 * @param {{ runAt: string, baseUrl: string, records: Array<{ path: string, status: number | null, outcome: string }> }} input
 * @returns {string}
 */
/**
 * Classify a first-value /search status. 429 is the defect this canary
 * guards; 5xx / unreachable are recorded but the edge detector only fires
 * on rate_limited so a transient 5xx does not open a search-budget incident.
 * @param {number | null} status
 * @returns {"ok" | "rate_limited" | "error" | "fetch_error"}
 */
export function firstValueOutcome(status) {
  if (status == null) return "fetch_error";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "error";
  return "ok";
}

/**
 * Fresh no-cookie GET of /search?q=nike&country=all. Must not send a Cookie
 * header and must not reuse the 25-domain latency probe user-agent, so the
 * walk is a genuine first-time evaluation and does not share that probe's
 * per-browser 20-slot bucket.
 *
 * @param {{
 *   baseUrl?: string,
 *   path?: string,
 *   fetchImpl?: typeof fetch,
 *   nowImpl?: () => number,
 *   userAgent?: string,
 * }} [input]
 * @returns {Promise<{ runAt: string, path: string, status: number | null, outcome: string, retryAfter: string, elapsedMs: number }>}
 */
export async function probeAnonymousFirstValue({
  baseUrl = DEFAULT_BASE_URL,
  path = FIRST_VALUE_PATH,
  fetchImpl = fetch,
  nowImpl = () => Date.now(),
  userAgent = FIRST_VALUE_PROBE_USER_AGENT,
} = {}) {
  const runAt = new Date().toISOString();
  const startedAt = nowImpl();
  let status = null;
  let retryAfter = "";
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        "user-agent": userAgent,
        "cache-control": "no-cache",
        pragma: "no-cache",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    retryAfter = response.headers.get("retry-after")?.trim() ?? "";
    await response.text();
  } catch (_error) {
    status = null;
  }
  return {
    runAt,
    path,
    status,
    outcome: firstValueOutcome(status),
    retryAfter,
    elapsedMs: nowImpl() - startedAt,
  };
}

/**
 * Metric line the probe emits and CI greps for.
 * @param {{ runAt: string, baseUrl: string, record: { path: string, status: number | null, outcome: string, retryAfter: string } }} input
 * @returns {string}
 */
export function formatFirstValueLine({ runAt, baseUrl, record }) {
  return [
    "anonymous_first_value_probe",
    `run=${runAt}`,
    `base_url=${baseUrl}`,
    `path=${record.path}`,
    `status=${record.status ?? "unreachable"}`,
    `outcome=${record.outcome}`,
    `retry_after=${record.retryAfter || "none"}`,
  ].join(" ");
}

export const DEFAULT_FIRST_VALUE_CONSECUTIVE = 3;

/**
 * Edge detector for anonymous first-value /search. Fires at the START of a
 * red streak: the last `consecutiveRuns` runs were all rate_limited (HTTP
 * 429), and the run before them (if any) was not. One incident, one issue.
 * Same edge-detector contract as detectAuthRegression on the latency guard.
 *
 * @param {Array<{ runAt: string, path: string, status: number | null, outcome: string, retryAfter?: string }>} records
 * @param {number} [consecutiveRuns]
 * @returns {{
 *   consecutiveRuns: number,
 *   runs: Array<{ runAt: string, path: string, status: number | null, retryAfter?: string }>,
 *   previous: { runAt: string } | null,
 *   title: string,
 * } | null}
 */
export function detectFirstValueRegression(
  records,
  consecutiveRuns = DEFAULT_FIRST_VALUE_CONSECUTIVE,
) {
  if (records.length < consecutiveRuns) return null;

  const lastN = records.slice(-consecutiveRuns);
  const everyStreakRunRed = lastN.every((r) => r.outcome === "rate_limited");
  if (!everyStreakRunRed) return null;

  const previous = records[records.length - consecutiveRuns - 1];
  if (previous && previous.outcome === "rate_limited") {
    return null;
  }

  return {
    consecutiveRuns,
    runs: lastN.map((r) => ({
      runAt: r.runAt,
      path: r.path,
      status: r.status,
      retryAfter: r.retryAfter,
    })),
    previous: previous ? { runAt: previous.runAt } : null,
    title:
      "regression: anonymous /search first-value session rate-limited for " +
      String(consecutiveRuns) +
      "+ consecutive windows",
  };
}

/**
 * @param {NonNullable<ReturnType<typeof detectFirstValueRegression>>} regression
 * @returns {string}
 */
export function formatFirstValueIssueBody(regression) {
  const lines = [
    "Anonymous first-value /search regression: a fresh no-cookie /search walk returned HTTP 429 for 3+ consecutive probe windows, so a first-time evaluator on the shared IP cannot reach the result step.",
    "",
    "| run_at | path | status | retry_after |",
    "|---|---|---|---|",
  ];
  for (const run of regression.runs) {
    lines.push(
      "| " +
        run.runAt +
        " | " +
        run.path +
        " | " +
        String(run.status ?? "unreachable") +
        " | " +
        (run.retryAfter || "none") +
        " |",
    );
  }
  lines.push("");
  lines.push("Consecutive failing runs: " + String(regression.consecutiveRuns));
  return lines.join("\n");
}

/**
 * The auth-availability metric line the probe emits and CI greps for.
 * @param {{ runAt: string, baseUrl: string, records: Array<{ path: string, status: number | null, outcome: string }> }} input
 * @returns {string}
 */
export function formatAuthAvailabilityLine({ runAt, baseUrl, records }) {
  const statuses = records.map((r) => `${r.path}=${r.status ?? "unreachable"}`).join(" ");
  const failures = records.filter((r) => r.outcome === "error" || r.outcome === "fetch_error").length;
  return [
    "auth_availability_probe",
    `run=${runAt}`,
    `base_url=${baseUrl}`,
    ...records.map((r) => `${r.path.replaceAll("/", "_").replaceAll("-", "_")}_status=${r.status ?? "unreachable"}`),
    `auth_failures=${failures}`,
    statuses ? statuses : "",
  ].join(" ");
}

/**
 * Run the 25-domain latency probe. Pacing stays inside runLiveVerification
 * (sliding-window limiter, 20 req / 10 min), so a single run can never exceed
 * the anonymous /search budget even with warming polls.
 *
 * @param {{
 *   baseUrl?: string,
 *   domains?: readonly string[],
 *   outputDir?: string | null,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   userAgent?: string,
 *   onResult?: (probe: any, index: number, total: number) => void,
 * }} [input]
 * @returns {Promise<{
 *   runAt: string,
 *   baseUrl: string,
 *   results: any[],
 *   run: RunRecord,
 *   stats: LatencyStats,
 *   metricLine: string,
 *   authResults: Array<{ runAt: string, path: string, status: number | null, outcome: string, elapsedMs: number }>,
 *   authMetricLine: string,
 *   firstValueResult: { runAt: string, path: string, status: number | null, outcome: string, retryAfter: string, elapsedMs: number },
 *   firstValueMetricLine: string,
 * }>}
 */
export async function runLatencyProbe({
  baseUrl = DEFAULT_BASE_URL,
  domains = BET2_DOMAINS,
  outputDir = null,
  fetchImpl,
  sleepImpl,
  nowImpl,
  userAgent = SEARCH_LATENCY_PROBE_USER_AGENT,
  onResult,
} = {}) {
  const runAt = new Date().toISOString();
  // First-value canary runs BEFORE the 25-domain set so it measures a genuine
  // first-time evaluator on the shared IP, not a walk that already spent 25
  // anonymous slots in this same process.
  const firstValueResult = await probeAnonymousFirstValue({
    baseUrl,
    fetchImpl,
    nowImpl,
  });

  const { results } = await runLiveVerification({
    domains,
    baseUrl,
    fetchImpl,
    sleepImpl,
    nowImpl,
    userAgent,
    paceRequests: true,
    requestSpacingMs: 0,
    onResult,
  });

  const stats = computeLatencyStats(results);
  const run = buildRunRecord(runAt, baseUrl, results);
  const cardRows = buildCardRows(runAt, results);

  const authRecords = await probeAuthPages({
    baseUrl,
    fetchImpl,
    sleepImpl,
    nowImpl,
    userAgent,
  });

  if (outputDir) {
    ensureDir(outputDir);
    writeRunAndCards(outputDir, run, cardRows);
    updateDailySummary(outputDir, run);
    const authRows = authRecords.map((r) => [
      r.runAt,
      r.path,
      r.status == null ? "" : String(r.status),
      r.outcome,
      String(r.elapsedMs),
    ]);
    appendCsv(join(outputDir, "auth.csv"), [...AUTH_HEADERS], authRows);
    appendCsv(
      join(outputDir, "first-value.csv"),
      [...FIRST_VALUE_HEADERS],
      [[
        firstValueResult.runAt,
        firstValueResult.path,
        firstValueResult.status == null ? "" : String(firstValueResult.status),
        firstValueResult.outcome,
        firstValueResult.retryAfter,
        String(firstValueResult.elapsedMs),
      ]],
    );
  }

  const metricLine = formatMetricLine({ runAt, baseUrl, stats });
  const authMetricLine = formatAuthAvailabilityLine({ runAt, baseUrl, records: authRecords });
  const firstValueMetricLine = formatFirstValueLine({
    runAt,
    baseUrl,
    record: firstValueResult,
  });
  return {
    runAt,
    baseUrl,
    results,
    run,
    stats,
    metricLine,
    authResults: authRecords,
    authMetricLine,
    firstValueResult,
    firstValueMetricLine,
  };
}

/**
 * @param {string[]} argv
 * @returns {{ baseUrl: string, outputDir: string, domains: string, json: boolean }}
 */
function parseCliArgs(argv) {
  const parsed = {
    baseUrl: DEFAULT_BASE_URL,
    outputDir: "",
    domains: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      parsed.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--output-dir" && argv[i + 1]) {
      parsed.outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--domains" && argv[i + 1]) {
      parsed.domains = argv[i + 1];
      i += 1;
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

/**
 * Unbuffered stdout so a piped multi-minute probe is not silent until exit.
 * @param {string} line
 */
function emitLine(line) {
  writeSync(1, `${line}\n`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const domains = args.domains
    ? args.domains.split(",").map((d) => d.trim())
    : undefined;

  const output = await runLatencyProbe({
    baseUrl: args.baseUrl,
    domains,
    outputDir: args.outputDir || null,
    onResult: (probe, index, total) => {
      const firstCard =
        probe.firstCardAtMs == null
          ? "n/a"
          : `${probe.firstCardAtMs.toFixed(0)}ms`;
      emitLine(
        `[${String(index).padStart(2)}/${total}] ${probe.domain.padEnd(20)} ${probe.outcome.padEnd(12)} firstCard=${firstCard} bytes=${probe.bodyBytes ?? 0}`,
      );
    },
  });

  emitLine(output.metricLine);
  emitLine(output.authMetricLine);
  emitLine(output.firstValueMetricLine);
  if (args.json) {
    emitLine(JSON.stringify(output, null, 2));
  }
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}