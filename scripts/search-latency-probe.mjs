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

  if (outputDir) {
    ensureDir(outputDir);
    writeRunAndCards(outputDir, run, cardRows);
    updateDailySummary(outputDir, run);
  }

  const metricLine = formatMetricLine({ runAt, baseUrl, stats });
  return { runAt, baseUrl, results, run, stats, metricLine };
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