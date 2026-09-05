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
 * Each run samples the last 24h of DELIVERED digest items from production D1
 * (`digest_item` rows whose `delivery_attempt` reached status 'sent'),
 * classifies every persisted item with the same landing / churn / other split
 * the digest builder uses, measures the day's headline ratio, appends it to a
 * dated history, writes a daily summary CSV, and evaluates the 7-day rolling
 * signal. When the rolling ratio drops below the 50% guard floor the guard
 * fires: exit 1 and, with `--file-issue`, a deduplicated GitHub issue pinging
 * #972 (issue-filing follows `scripts/canary-demo-brand-timeline.mjs`).
 *
 * Scheduling runs on the VPS systemd rail (`ops/digest-headline-ratio-guard/`),
 * the same rail as the liveness probe, the screenshot-rate guard, and the
 * demo-brand-timeline guard — a GitHub scheduled workflow would be a
 * gate-owned path edit, which the issue's acceptance criteria forbid.
 *
 * State lives under $DIGEST_HEADLINE_STATE_DIR (default
 * `~/.local/state/0509-digest-headline-ratio/`): `history.json` keeps the
 * dated measurements and `daily-summary.csv` is rewritten every run. The state
 * dir is deliberately outside the repo checkout so daily writes never dirty
 * the tree. History is appended only for real sampled days (the default
 * remote mode); `--input`/`--local` runs measure and report without writing
 * history unless `--record` is passed, so fixtures cannot poison the rolling
 * window.
 *
 * Exit codes:
 *   0 — 7-day rolling headline ratio is at/above the 50% guard floor, or the
 *       window delivered no digest items (a quiet day is not a regression;
 *       delivery silence is a different guard's job).
 *   1 — rolling headline ratio dropped below 50% (regression guard fires).
 *   2 — the sample could not be produced (wrangler/D1 error, unreadable
 *       --input) or the history file is corrupt.
 *
 * Usage:
 *   node scripts/canary-digest-headline-ratio.mjs                  # remote D1 sample
 *   node scripts/canary-digest-headline-ratio.mjs --local          # local (miniflare) D1
 *   node scripts/canary-digest-headline-ratio.mjs --input day.json # fixture: JSON array of event types
 *   node scripts/canary-digest-headline-ratio.mjs --json --no-commit
 *   node scripts/canary-digest-headline-ratio.mjs --file-issue     # file on guard fire (scheduled mode)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE_DIR =
  process.env.DIGEST_HEADLINE_STATE_DIR ??
  join(homedir(), ".local", "state", "0509-digest-headline-ratio");
const HISTORY_PATH = join(STATE_DIR, "history.json");
const SUMMARY_PATH = join(STATE_DIR, "daily-summary.csv");
const DATABASE_NAME = "0509";
const REPO = "Nishfleet/0509";
const ISSUE_BODY_MARKER = "digest-headline-ratio-guard";
const ISSUE_TITLE = "DIGEST HEADLINE RATIO GUARD: rolling ratio below 50%";

// Mirrors the digest-builder classification in app/lib/digest-rerank.ts so the
// canary measures the same headline stream the brief ships. The parity test in
// tests/digest-headline-ratio.test.ts pins this mirror against the real
// rerankDigestBrief so the two cannot silently drift.
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
const DEFAULT_SAMPLE_HOURS = 24;

/** @typedef {{ periodStart: string, headlineItemCount: number, landingPageCount: number, adChurnCount: number, otherCount: number, totalItemCount: number, ratio: number }} Measurement */

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const parsed = {
    input: /** @type {string | null} */ (null),
    local: false,
    json: false,
    noCommit: false,
    record: false,
    fileIssue: false,
    dryRun: false,
    sampleHours: DEFAULT_SAMPLE_HOURS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) {
      parsed.input = argv[i + 1];
      i += 1;
    } else if (arg === "--local") {
      parsed.local = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--no-commit") {
      parsed.noCommit = true;
    } else if (arg === "--record") {
      parsed.record = true;
    } else if (arg === "--file-issue") {
      parsed.fileIssue = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--sample-hours" && argv[i + 1]) {
      const hours = Number(argv[i + 1]);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error("--sample-hours must be a positive number.");
      }
      parsed.sampleHours = hours;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/canary-digest-headline-ratio.mjs [--local|--input <file.json>] [--sample-hours <n>] [--json] [--no-commit] [--record] [--file-issue] [--dry-run]",
      );
      process.exit(0);
    } else {
      throw new Error(
        `Unknown argument: ${arg}. Supported: --input <file>, --local, --sample-hours <n>, --json, --no-commit, --record, --file-issue, --dry-run.`,
      );
    }
  }
  if (parsed.input !== null && parsed.local) {
    throw new Error("--input and --local are mutually exclusive.");
  }
  return parsed;
}

/**
 * The last-24h delivered-digest item mix. `digest_item` rows are the persisted
 * cohort of a digest run; `delivery_attempt` with status 'sent' marks a run
 * that actually reached the customer. EXISTS (not a join) so a run delivered
 * on more than one channel never double-counts its items.
 *
 * @param {string} cutoffIso ISO timestamp lower bound (exclusive boundary of
 *   the sampling window) — computed in JS because `datetime('now')` emits
 *   `YYYY-MM-DD HH:MM:SS` while this codebase stores `toISOString()` values;
 *   lexicographic comparison only works when both sides share the ISO shape.
 */
export function buildSampleQuery(cutoffIso) {
  return `SELECT di.event_type AS event_type, COUNT(*) AS n
FROM digest_item di
WHERE EXISTS (
  SELECT 1
  FROM delivery_attempt da
  WHERE da.digest_run_id = di.digest_run_id
    AND da.status = 'sent'
    AND da.lane = 'customer'
    AND COALESCE(da.sent_at, da.created_at) >= '${cutoffIso}'
)
GROUP BY di.event_type;`;
}

/**
 * @param {string} output raw `wrangler d1 execute --json` stdout
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
 * Expand `{event_type, n}` aggregate rows back into a flat event-type list so
 * `measure` sees exactly the persisted item mix.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string[]}
 */
export function eventTypesFromCountRows(rows) {
  const eventTypes = [];
  for (const row of rows) {
    const eventType = typeof row.event_type === "string" ? row.event_type : "";
    const n = Number(row.n ?? row.count ?? 0);
    if (!eventType || !Number.isFinite(n) || n <= 0) continue;
    for (let i = 0; i < n; i += 1) eventTypes.push(eventType);
  }
  return eventTypes;
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
    otherCount,
    totalItemCount: eventTypes.length,
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
 * The 7-day rolling regression-guard signal over dated daily measurements.
 * A day whose delivered digests carried zero headline-stream items (all churn,
 * or no items at all) is kept out of the rolling mean: silence and all-churn
 * days are a delivery/coverage question, not a headline-mix regression.
 *
 * @param {Measurement[]} history
 * @returns {{ sampledDays: number, rollingRatio: number, targetMet: boolean, guardFired: boolean }}
 */
export function rollingSignal(history) {
  const window = history
    .filter((m) => m.headlineItemCount > 0)
    .slice(-ROLLING_DAYS);
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
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

/**
 * @param {Measurement[]} history
 */
export function writeSummaryCsv(history) {
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
  const header =
    "period_start,headline_item_count,landing_page_count,ad_churn_count,other_count,total_item_count,ratio";
  const rows = history.map((m) =>
    [
      m.periodStart,
      m.headlineItemCount,
      m.landingPageCount,
      m.adChurnCount,
      m.otherCount ?? 0,
      m.totalItemCount ?? m.headlineItemCount + m.adChurnCount,
      m.ratio.toFixed(4),
    ].join(","),
  );
  writeFileSync(SUMMARY_PATH, [header, ...rows, ""].join("\n"), "utf8");
}

/**
 * @param {unknown} parsed
 * @returns {string[]}
 */
export function loadSample(parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error("sample must be a JSON array of event-type strings.");
  }
  return parsed.filter((t) => typeof t === "string");
}

/**
 * @param {{ measurement: Measurement, signal: ReturnType<typeof rollingSignal>, checkedAt: string, cutoffIso: string }} input
 * @returns {string}
 */
export function buildIssueBody({ measurement, signal, checkedAt, cutoffIso }) {
  const lines = [];
  lines.push("## Digest headline-ratio regression guard fired (issue #1451)");
  lines.push("");
  lines.push(
    "The 7-day rolling headline ratio of delivered daily digests dropped below the 50% guard floor.",
  );
  lines.push("");
  lines.push(`- **checked at:** ${checkedAt}`);
  lines.push(`- **sample window:** last 24h of delivered digest items (since ${cutoffIso})`);
  lines.push(
    `- **today:** ${measurement.landingPageCount} landing_page_* / ${measurement.headlineItemCount} headline-stream items` +
      ` (ratio ${measurement.ratio.toFixed(3)}); ${measurement.adChurnCount} creative-churn items collapsed`,
  );
  lines.push(
    `- **rolling:** ${signal.sampledDays} measured day(s), ratio ${signal.rollingRatio.toFixed(3)}` +
      ` (target >= ${TARGET_RATIO}, guard < ${GUARD_RATIO})`,
  );
  lines.push("");
  lines.push(
    "Guard rule: at least 60% of brief headline items must be `landing_page_*` events; " +
      "`ad_new` / `ad_inactive` collapse into a single counted footnote and never headline. " +
      "The digest builder's headline rule lives in `app/lib/digest-rerank.ts` (`rerankDigestBrief`); " +
      "the guard is `scripts/canary-digest-headline-ratio.mjs` scheduled by `ops/digest-headline-ratio-guard/`.",
  );
  lines.push("");
  lines.push(
    "A merge is regressing the central BET 1 promise. Investigate the digest builder / " +
      "change-intelligence before more deliveries. See #972.",
  );
  lines.push("");
  lines.push(
    `${ISSUE_BODY_MARKER}: true, rollingRatio: ${signal.rollingRatio.toFixed(4)}, period: ${measurement.periodStart}`,
  );
  return lines.join("\n");
}

/** @param {{ body: string, title: string, repo: string }} input @returns {string[]} */
export function buildGhIssueCommand({ body, title, repo }) {
  return ["issue", "create", "-R", repo, "--title", title, "--body", body];
}

/** @param {{ repo: string }} input @returns {{ existing: boolean }} */
export function findExistingOpenIncident({ repo }) {
  try {
    const result = spawnSync(
      "gh",
      [
        "issue", "list", "-R", repo,
        "--search", `${ISSUE_BODY_MARKER} in:body`,
        "--state", "open",
        "--json", "number", "--limit", "5",
      ],
      { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.status !== 0) return { existing: false };
    const parsed = JSON.parse(result.stdout || "[]");
    return { existing: Array.isArray(parsed) && parsed.length > 0 };
  } catch {
    return { existing: false };
  }
}

/**
 * Sample the last `hours` of delivered digest items from D1 via wrangler.
 * @param {{ local: boolean, hours: number }} input
 * @returns {{ eventTypes: string[], cutoffIso: string, error: string | null }}
 */
function sampleDeliveredDigestItems({ local, hours }) {
  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const result = spawnSync(
    "npx",
    [
      "wrangler", "d1", "execute", DATABASE_NAME,
      local ? "--local" : "--remote",
      "--json",
      "--command", buildSampleQuery(cutoffIso),
    ],
    { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
  );
  if (result.error) {
    return {
      eventTypes: [],
      cutoffIso,
      error: result.error instanceof Error ? result.error.message : String(result.error),
    };
  }
  if (result.status !== 0) {
    return {
      eventTypes: [],
      cutoffIso,
      error: (result.stderr || result.stdout || "").trim() || "wrangler d1 execute failed",
    };
  }
  return { eventTypes: eventTypesFromCountRows(rowsFromWranglerJson(result.stdout ?? "")), cutoffIso, error: null };
}

/**
 * @param {{ sampled: boolean, sampleHours: number, cutoffIso: string | null, periodStart: string, landingPageCount: number, headlineItemCount: number, ratio: number, adChurnCount: number, sampledDays: number, rollingRatio: number, guardFired: boolean }} report
 * @param {boolean} json
 */
function emitReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines = ["digest-headline-ratio canary"];
  if (!report.sampled) {
    lines.push(
      `- sample window ${report.sampleHours}h (since ${report.cutoffIso}): no delivered digest items;` +
        " nothing to measure today",
    );
  } else {
    lines.push(
      `- period ${report.periodStart}: ${report.landingPageCount} landing_page_* headline items` +
        ` / ${report.headlineItemCount} headline-stream items (ratio ${report.ratio.toFixed(3)});` +
        ` ${report.adChurnCount} creative-churn items collapsed`,
    );
  }
  lines.push(
    `- rolling window: ${report.sampledDays} measured day(s), ratio ${report.rollingRatio.toFixed(3)}` +
      ` (target >= ${TARGET_RATIO}, guard < ${GUARD_RATIO})`,
  );
  lines.push(
    report.guardFired
      ? "verdict: REGRESSION — rolling headline ratio below the 50% guard floor."
      : "verdict: ok — headline ratio at/above the 50% guard floor.",
  );
  console.log(lines.join("\n"));
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`digest-headline-ratio canary: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const checkedAt = new Date().toISOString();
  let eventTypes;
  let cutoffIso = null;
  let sampledFromProd = false;
  if (args.input !== null) {
    try {
      eventTypes = loadSample(JSON.parse(readFileSync(args.input, "utf8")));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
      } else {
        console.error(`digest-headline-ratio canary: could not read --input ${args.input}: ${message}`);
      }
      process.exit(2);
    }
  } else {
    const sample = sampleDeliveredDigestItems({ local: args.local, hours: args.sampleHours });
    if (sample.error !== null) {
      const message = sample.error;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: message, mode: args.local ? "local" : "remote" }, null, 2));
      } else {
        console.error(`digest-headline-ratio canary: ${message}`);
      }
      process.exit(2);
    }
    eventTypes = sample.eventTypes;
    cutoffIso = sample.cutoffIso;
    sampledFromProd = !args.local;
  }

  const measurement = measure(eventTypes, isoDay(checkedAt));
  // A day with zero delivered digest items is not a 0-ratio day — nothing was
  // delivered, so there is no headline mix to judge. It is still written to the
  // summary CSV so quiet days stay observable.
  const measured = measurement.totalItemCount > 0;
  const history = loadHistory();
  const withoutToday = history.filter((m) => m.periodStart !== measurement.periodStart);
  const nextHistory = measured ? [...withoutToday, measurement] : withoutToday;

  // The daily summary CSV is the observable artifact on every run. History is
  // what the rolling window is computed from, so it only grows on real sampled
  // runs (remote default) or explicit --record; fixture/local runs never
  // poison it unless asked, and --no-commit suppresses every write.
  if (!args.noCommit) {
    writeSummaryCsv(nextHistory);
    if ((sampledFromProd || args.record) && measured) {
      writeHistory(nextHistory);
    }
  }

  const signal = rollingSignal(nextHistory);
  const fired = signal.guardFired;
  const report = {
    ok: !fired,
    checkedAt,
    cutoffIso,
    sampleHours: args.sampleHours,
    sampled: measured,
    periodStart: measurement.periodStart,
    headlineItemCount: measurement.headlineItemCount,
    landingPageCount: measurement.landingPageCount,
    adChurnCount: measurement.adChurnCount,
    otherCount: measurement.otherCount,
    totalItemCount: measurement.totalItemCount,
    ratio: measurement.ratio,
    sampledDays: signal.sampledDays,
    rollingRatio: signal.rollingRatio,
    targetRatio: TARGET_RATIO,
    guardRatio: GUARD_RATIO,
    targetMet: signal.targetMet,
    guardFired: fired,
    historyPath: HISTORY_PATH,
    summaryPath: SUMMARY_PATH,
  };
  emitReport(report, args.json);

  if (fired && args.fileIssue) {
    const body = buildIssueBody({ measurement, signal, checkedAt, cutoffIso: cutoffIso ?? checkedAt });
    const command = buildGhIssueCommand({ body, title: ISSUE_TITLE, repo: REPO });
    if (args.dryRun) {
      console.log(`[dry-run] would run: gh ${command.map((c) => JSON.stringify(c)).join(" ")}`);
    } else {
      const existing = findExistingOpenIncident({ repo: REPO });
      if (existing.existing) {
        console.log(
          "auto-file skipped: an open digest-headline-ratio-guard incident already exists (dedupe).",
        );
        process.exit(1);
      }
      const createResult = spawnSync("gh", command, {
        cwd: root,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      if (createResult.status !== 0) {
        // A guard that could not file its issue fails loud, not silent.
        console.error(
          `digest-headline-ratio canary: gh issue create failed: ${(createResult.stderr || createResult.stdout || "").trim()}`,
        );
        process.exit(2);
      }
      console.log(`auto-filed regression issue: ${(createResult.stdout || "").trim()}`);
    }
  }

  process.exit(fired ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
