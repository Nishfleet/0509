#!/usr/bin/env node
/**
 * Deterministic local/operator aggregator for first-party funnel events
 * (docs/funnel-measurement-spec.md §7).
 *
 * Anonymous funnel events are written as structured JSON log records via
 * app/lib/log.server.ts (`operation: funnel_*`). This script consumes those
 * JSON lines — from `wrangler tail`, a log stream, or a captured file — and
 * prints the spec's daily aggregate counts. It is read-only: no database,
 * no network, no credentials, and it never prints raw event values. Only the
 * allowlisted fields (operation, timestamp, result_count_bucket,
 * error_kind) are read; anything else is ignored.
 *
 * Usage:
 *   npm run funnel:aggregate <log-file>        # from a file
 *   cat logs.jsonl | npm run funnel:aggregate  # from stdin
 *   npm run funnel:aggregate -- --json <file>  # machine-readable aggregate
 *
 * The allowlist mirrors app/lib/funnel-measurement.server.ts. Keep both in
 * sync: any change to the event names, buckets, or error kinds ships twice.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const FUNNEL_OPERATIONS = [
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_signup_start",
];

export const RESULT_COUNT_BUCKETS = ["0", "1-10", "11-50", "51+"];

export const ERROR_KINDS = ["rate_limited", "timeout", "provider_unavailable", "unknown"];

const ISO_DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * Parse one JSON log line. Returns null for empty, non-JSON, or non-object
 * lines so malformed input is skipped without ever entering the output.
 *
 * @param {string} line
 * @returns {Record<string, any> | null}
 */
export function parseLogLine(line) {
  if (typeof line !== "string" || !line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** @returns {Record<string, number>} */
function emptyTotals() {
  /** @type {Record<string, number>} */
  const totals = {};
  for (const operation of FUNNEL_OPERATIONS) {
    totals[operation] = 0;
  }
  return totals;
}

/**
 * @param {readonly string[]} values
 * @returns {Record<string, number>}
 */
function emptyBreakdown(values) {
  /** @type {Record<string, number>} */
  const breakdown = {};
  for (const value of values) {
    breakdown[value] = 0;
  }
  return breakdown;
}

/**
 * Aggregate funnel records into deterministic per-day counts. Only records
 * whose `operation` is in the allowlist count; result buckets and error kinds
 * are counted only when they are in their allowlists, so a malformed or
 * tampered value is ignored, never echoed.
 *
 * @param {Array<string | Record<string, any> | null | undefined>} records
 *   parsed log records (or raw strings, parsed here)
 * @returns {Array<{day: string, totals: Record<string, number>, resultBuckets: Record<string, number>, errorKinds: Record<string, number>}>}
 *   one entry per day, days sorted ascending
 */
export function aggregateFunnelLogs(records) {
  const days = new Map();

  for (const raw of records) {
    const record = typeof raw === "string" ? parseLogLine(raw) : raw;
    if (!record || typeof record !== "object") {
      continue;
    }
    const operation = record.operation;
    if (typeof operation !== "string" || !FUNNEL_OPERATIONS.includes(operation)) {
      continue;
    }
    const timestamp = record.timestamp;
    if (typeof timestamp !== "string" || !ISO_DAY_PREFIX.test(timestamp)) {
      continue;
    }
    if (Number.isNaN(Date.parse(timestamp))) {
      continue;
    }
    const day = timestamp.slice(0, 10);
    if (!days.has(day)) {
      days.set(day, {
        day,
        totals: emptyTotals(),
        resultBuckets: emptyBreakdown(RESULT_COUNT_BUCKETS),
        errorKinds: emptyBreakdown(ERROR_KINDS),
      });
    }
    const entry = days.get(day);
    entry.totals[operation] += 1;

    if (operation === "funnel_search_preview_result") {
      const bucket = record.details?.result_count_bucket;
      if (RESULT_COUNT_BUCKETS.includes(bucket)) {
        entry.resultBuckets[bucket] += 1;
      }
    }
    if (operation === "funnel_search_preview_error") {
      const kind = record.details?.error_kind;
      if (ERROR_KINDS.includes(kind)) {
        entry.errorKinds[kind] += 1;
      }
    }
  }

  return Array.from(days.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Render the aggregate as a deterministic text report. Counts only; no raw
 * event values ever appear.
 *
 * @param {Array<{day: string, totals: Record<string, number>, resultBuckets: Record<string, number>, errorKinds: Record<string, number>}>} aggregate
 * @returns {string}
 */
export function renderFunnelReport(aggregate) {
  const lines = [
    "Funnel daily aggregates — scripts/funnel-aggregate.mjs (read-only; no raw values)",
    "",
  ];
  for (const entry of aggregate) {
    lines.push(entry.day);
    for (const operation of FUNNEL_OPERATIONS) {
      lines.push(`  ${operation.padEnd(32)}${String(entry.totals[operation]).padStart(6)}`);
      if (operation === "funnel_search_preview_result") {
        const buckets = RESULT_COUNT_BUCKETS.map(
          (bucket) => `${bucket}=${entry.resultBuckets[bucket]}`,
        ).join(", ");
        lines.push(`    result_count_bucket: ${buckets}`);
      }
      if (operation === "funnel_search_preview_error") {
        const kinds = ERROR_KINDS.map((kind) => `${kind}=${entry.errorKinds[kind]}`).join(", ");
        lines.push(`    error_kind: ${kinds}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * @param {import("node:stream").Readable} stream
 * @returns {Promise<string[]>}
 */
async function readAllLines(stream) {
  const lines = [];
  const reader = createInterface({ input: stream });
  for await (const line of reader) {
    lines.push(line);
  }
  return lines;
}

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv) {
  const positional = argv.slice(2).filter((arg) => arg !== "--json");
  const asJson = argv.includes("--json");
  const source = positional[0];
  const lines =
    source && source !== "-"
      ? await readAllLines(createReadStream(source, { encoding: "utf8" }))
      : await readAllLines(process.stdin);
  const aggregate = aggregateFunnelLogs(lines);
  const output = asJson ? JSON.stringify(aggregate, null, 2) : renderFunnelReport(aggregate);
  process.stdout.write(`${output}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
