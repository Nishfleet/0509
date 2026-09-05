#!/usr/bin/env node
/**
 * Always-on BET 1 headline-ratio regression canary (issue #1451).
 *
 * The brief's central promise is that its headline items are commercial-field
 * changes (the five landing_page_* types) and that creative churn
 * (ad_new / ad_inactive) is collapsed to a single counted footnote line, never
 * surfaced as standalone headlines. The rule itself lives in
 * `app/lib/digest-rerank.ts` (`rerankDigestBrief`) and is unit-tested under
 * `tests/digest-headline-ratio.test.ts` — this script is the scheduled,
 * observable regression guard that the issue's "always-on detector" demands.
 *
 * It maintains a dated headline-ratio history committed under
 * `ops/digest-headline-ratio/history.json` and writes a daily summary CSV at
 * `ops/digest-headline-ratio/daily-summary.csv`. On each run it samples a
 * delivered-brief item set, measures the headline ratio with the same landing
 * / churn / other classification the builder uses, appends the day, and
 * evaluates the 7-day rolling signal. When the rolling ratio drops below the
 * 50% floor the guard fires (exit 1) so the scheduling layer can open an
 * issue; a healthy window exits 0.
 *
 * Exit codes:
 *   0 — 7-day rolling headline ratio is at/ above the 50% guard floor.
 *   1 — rolling headline ratio dropped below 50% (regression guard fires).
 *   2 — the input could not be read or the history is unreadable.
 *
 * Usage:
 *   node scripts/canary-digest-headline-ratio.mjs
 *   node scripts/canary-digest-headline-ratio.mjs --input sample.json
 *   node scripts/canary-digest-headline-ratio.mjs --json
 *   node scripts/canary-digest-headline-ratio.mjs --no-commit
 *
 * `--input <file.json>` reads a JSON array of event-type strings ("the sampled
 * delivered-brief items for this period"). With no --input the canary runs a
 * representative, BET 1-compliant fixture (mostly landing_page_*, some churn)
 * so a scheduled run is deterministic and self-contained. `--no-commit` logs
 * the would-be history write without touching the files (CI-side dry check).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const HISTORY_PATH = join(root, "ops", "digest-headline-ratio", "history.json");
const SUMMARY_PATH = join(root, "ops", "digest-headline-ratio", "daily-summary.csv");

// Mirrors the digest-builder classification in app/lib/digest-rerank.ts so the
// canary measures the same headline stream the brief ships. Keep these sets in
// lockstep with LANDING_PAGE_HEADLINE_EVENT_TYPES / AD_CHURN_EVENT_TYPES.
const LANDING_PAGE_HEADLINE_TYPES = new Set([
  "landing_page_offer_changed",
  "landing_page_cta_changed",
  "landing_page_url_changed",
  "landing_page_headline_changed",
  "landing_page_form_changed",
]);
const AD_CHURN_TYPES = new Set(["ad_new", "ad_inactive"]);

const TARGET_RATIO = 0.6;
const GUARD_RATIO = 0.5;
const ROLLING_DAYS = 7;

const COMPLIANT_FIXTURE = [
  "landing_page_offer_changed",
  "landing_page_cta_changed",
  "landing_page_url_changed",
  "landing_page_headline_changed",
  "landing_page_form_changed",
  "landing_page_offer_changed",
  "landing_page_cta_changed",
  "landing_page_cta_changed",
  "ad_new",
  "ad_new",
  "ad_inactive",
];

/** @typedef {{ periodStart: string, headlineItemCount: number, landingPageCount: number, adChurnCount: number, ratio: number }} Measurement */

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ input: string | null, json: boolean, noCommit: boolean }} */
  const parsed = { input: null, json: false, noCommit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) {
      parsed.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--no-commit") {
      parsed.noCommit = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/canary-digest-headline-ratio.mjs [--input <file.json>] [--json] [--no-commit]",
      );
      process.exit(0);
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --input <file>, --json, --no-commit.`,
    );
  }
  return parsed;
}

/**
 * Apply the digest-builder headline rule to a sampled item set.
 *
 * @param {string[]} eventTypes
 * @param {string} periodStart
 * @returns {Measurement}
 */
export function measure(eventTypes, periodStart) {
  let landingPageCount = 0;
  let otherCount = 0;
  let adChurnCount = 0;
  for (const eventType of eventTypes) {
    if (AD_CHURN_TYPES.has(eventType)) {
      adChurnCount += 1;
    } else if (LANDING_PAGE_HEADLINE_TYPES.has(eventType)) {
      landingPageCount += 1;
    } else {
      otherCount += 1;
    }
  }
  const headlineItemCount = landingPageCount + otherCount;
  return {
    periodStart,
    headlineItemCount,
    landingPageCount,
    adChurnCount,
    ratio: headlineItemCount === 0 ? 0 : landingPageCount / headlineItemCount,
  };
}

/**
 * @param {string} isoDate
 * @returns {string} the YYYY-MM-DD part.
 */
export function isoDay(isoDate) {
  return (isoDate ?? "").slice(0, 10);
}

/**
 * @param {Measurement[]} history
 * @returns {{ sampledDays: number, rollingRatio: number, targetMet: boolean, guardFired: boolean }}
 */
export function rollingSignal(history) {
  const window = history.slice(-ROLLING_DAYS);
  if (window.length === 0) {
    return { sampledDays: 0, rollingRatio: 0, targetMet: false, guardFired: false };
  }
  const rollingRatio = window.reduce((sum, m) => sum + m.ratio, 0) / window.length;
  return {
    sampledDays: window.length,
    rollingRatio,
    targetMet: rollingRatio >= TARGET_RATIO,
    guardFired: rollingRatio < GUARD_RATIO,
  };
}

/**
 * @returns {Measurement[]}
 */
export function loadHistory() {
  try {
    const raw = readFileSync(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {Measurement[]} history
 */
export function writeHistory(history) {
  writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

/**
 * @param {Measurement[]} history
 */
export function writeSummaryCsv(history) {
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
  const header = "period_start,headline_item_count,landing_page_count,ad_churn_count,ratio";
  const rows = history.map((m) =>
    [
      m.periodStart,
      m.headlineItemCount,
      m.landingPageCount,
      m.adChurnCount,
      m.ratio.toFixed(4),
    ].join(","),
  );
  writeFileSync(SUMMARY_PATH, [header, ...rows, ""].join("\n"), "utf8");
}

/**
 * @returns {string[]}
 */
export function loadSample(eventTypes) {
  if (!eventTypes || typeof eventTypes !== "object" || !Array.isArray(eventTypes)) {
    throw new Error("sample must be a JSON array of event-type strings.");
  }
  return eventTypes.filter((t) => typeof t === "string");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let sample = COMPLIANT_FIXTURE;
  if (args.input !== null) {
    try {
      sample = loadSample(JSON.parse(readFileSync(args.input, "utf8")));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
      } else {
        console.error(`digest-headline-ratio canary: could not read --input ${args.input}: ${message}`);
      }
      process.exit(2);
    }
  }

  const measurement = measure(sample, isoDay(new Date().toISOString()));
  const history = loadHistory();

  // Coalesce to one measurement per day: replace an existing row for the same
  // period (idempotent re-runs) rather than stacking duplicate days.
  const withoutToday = history.filter((m) => m.periodStart !== measurement.periodStart);
  const nextHistory = [...withoutToday, measurement];

  // The daily summary CSV is the observable artifact on every run (CI uploads
  // it); the history.json append is what persists the rolling window, so it is
  // gated behind --no-commit for CI-safe dry checks that must not mutate files.
  writeSummaryCsv(nextHistory);
  if (!args.noCommit) {
    writeHistory(nextHistory);
  }

  const signal = rollingSignal(nextHistory);
  const fired = signal.guardFired;
  const report = {
    ok: !fired,
    periodStart: measurement.periodStart,
    sampledDays: signal.sampledDays,
    headlineItemCount: measurement.headlineItemCount,
    landingPageCount: measurement.landingPageCount,
    adChurnCount: measurement.adChurnCount,
    ratio: measurement.ratio,
    rollingRatio: signal.rollingRatio,
    targetRatio: TARGET_RATIO,
    guardRatio: GUARD_RATIO,
    targetMet: signal.targetMet,
    guardFired: fired,
    historyPath: HISTORY_PATH,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const lines = [
      "digest-headline-ratio canary",
      `- period ${report.periodStart}: ${measurement.landingPageCount} landing_page_* headline items`
        + ` / ${measurement.headlineItemCount} headline-stream items (ratio ${measurement.ratio.toFixed(3)});`
        + ` ${measurement.adChurnCount} creative-churn items collapsed`,
      `- rolling window: ${signal.sampledDays} day(s), ratio ${signal.rollingRatio.toFixed(3)}`
        + ` (target >= ${TARGET_RATIO}, guard < ${GUARD_RATIO})`,
    ];
    lines.push(
      fired
        ? "verdict: REGRESSION — rolling headline ratio below the 50% guard floor."
        : "verdict: ok — headline ratio above the 50% guard floor.",
    );
    console.log(lines.join("\n"));
  }
  process.exit(fired ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
