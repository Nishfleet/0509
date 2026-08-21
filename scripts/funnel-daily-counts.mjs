#!/usr/bin/env node
/**
 * Operator aggregate counts for anonymous funnel measurement records.
 *
 * Reads NDJSON log lines from stdin (for example:
 *   wrangler tail --format json | node scripts/funnel-daily-counts.mjs
 * or a Cloudflare Logpush export piped the same way) and prints only bounded
 * daily aggregate counts for `funnel_*` operations. It never prints raw
 * records and never reads credentials or configuration.
 *
 * The funnel events themselves are disabled by default (see
 * docs/funnel-measurement-spec.md and app/lib/funnel-measurement.server.ts);
 * this script only summarizes records that already exist in the log stream.
 */

import { createInterface } from "node:readline";
import { stdin } from "node:process";

const ALLOWED_DETAIL_KEYS = new Set([
  "event_id",
  "route",
  "account_scope",
  "result_count_bucket",
  "error_kind",
]);

const OPERATIONS = new Set([
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_signup_start",
]);

function parseRecord(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function dayOf(record) {
  const timestamp = record.timestamp;
  if (typeof timestamp !== "string") {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp);
  return match ? match[1] : null;
}

const counts = new Map();
let unparseableLines = 0;
let nonFunnelRecords = 0;
let recordsWithUnexpectedDetailKeys = 0;

const rl = createInterface({ input: stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  const record = parseRecord(trimmed);
  if (!record || typeof record !== "object") {
    unparseableLines += 1;
    return;
  }
  const operation = record.operation;
  if (typeof operation !== "string" || !OPERATIONS.has(operation)) {
    nonFunnelRecords += 1;
    return;
  }

  const details = record.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const key of Object.keys(details)) {
      if (!ALLOWED_DETAIL_KEYS.has(key)) {
        recordsWithUnexpectedDetailKeys += 1;
        break;
      }
    }
  }

  const day = dayOf(record);
  if (!day) {
    return;
  }
  const key = `${day}\u0000${operation}`;
  const cell = counts.get(key) ?? { count: 0, buckets: {}, errorKinds: {} };
  cell.count += 1;
  if (typeof details?.result_count_bucket === "string") {
    cell.buckets[details.result_count_bucket] = (cell.buckets[details.result_count_bucket] ?? 0) + 1;
  }
  if (typeof details?.error_kind === "string") {
    cell.errorKinds[details.error_kind] = (cell.errorKinds[details.error_kind] ?? 0) + 1;
  }
  counts.set(key, cell);
});

rl.on("close", () => {
  const days = [...counts.keys()]
    .map((key) => key.split("\u0000")[0])
    .filter((day, index, all) => all.indexOf(day) === index)
    .sort();
  for (const day of days) {
    for (const operation of [...OPERATIONS].sort()) {
      const cell = counts.get(`${day}\u0000${operation}`);
      if (!cell) {
        continue;
      }
      const bucketSummary = Object.keys(cell.buckets).length
        ? ` (${Object.entries(cell.buckets).sort().map(([bucket, count]) => `${bucket}:${count}`).join(", ")})`
        : "";
      const errorSummary = Object.keys(cell.errorKinds).length
        ? ` (${Object.entries(cell.errorKinds).sort().map(([kind, count]) => `${kind}:${count}`).join(", ")})`
        : "";
      console.log(`${day} ${operation} ${cell.count}${bucketSummary || errorSummary ? `${bucketSummary}${errorSummary}` : ""}`);
    }
  }
  if (recordsWithUnexpectedDetailKeys > 0) {
    console.error(
      `warning: ${recordsWithUnexpectedDetailKeys} funnel record(s) carried detail keys outside the field allowlist — check the emitter and the spec.`,
    );
  }
  if (unparseableLines > 0) {
    console.error(`warning: ${unparseableLines} unparseable line(s) skipped.`);
  }
  if (nonFunnelRecords > 0) {
    console.error(`info: ${nonFunnelRecords} non-funnel record(s) skipped.`);
  }
});
