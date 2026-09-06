#!/usr/bin/env node
// d1-budget: reads=300 writes=0 runs_per_day=4
/**
 * Live regression guard for issue #1327: the proof-capture screenshot success
 * rate ("saves the screenshots" is the product's headline proof promise).
 *
 * Three prior fixes (#957, #1103, #1181) hardened the CAPTURE path so watcher
 * proof captures fail closed without a persisted screenshot, yet the headline
 * number stayed ~18%. Root cause (verified live 2026-09-04): the aggregate was
 * measured over ALL status='succeeded' rows, a population dominated by
 * `kind='launch_readiness_real_capture'` rows — internal launch-gate captures
 * of 0509.io itself whose proof artifacts are DELIBERATELY deleted after the
 * gate passes (their keys are nulled by the launch-canary artifact cleanup,
 * see app/lib/data/launch-canary-cleanup.server.ts →
 * app/lib/proof-artifact-retention.server.ts `clearOwnerProofArtifactReference`).
 * Those rows carry screenshotCorroborates=true (the screenshot WAS captured)
 * but a NULL screenshot_artifact_key by design. Over the last 14 days they were
 * 90/112 (80%) of succeeded rows, all shot=0 — permanently pinning the
 * aggregate number no matter how the capture path is fixed.
 *
 * This canary therefore measures the REAL watcher population (`kind IS NULL` —
 * the population that embodies the customer promise) as its verdict, and
 * reports the launch-canary and aggregate buckets as diagnostics so the gap is
 * always explained rather than silently swallowed. It FAILS (exit 1) the first
 * time the real-population rate drops below the alert threshold on any window
 * with at least MIN_SAMPLE succeeded captures, and can auto-file a GitHub
 * issue carrying the rate, the sample size, and a link to the capture-path
 * code.
 *
 * Exit codes:
 *   0 — verdict passed (real-population screenshot rate >= threshold), OR the
 *       sample in the window is too small to judge (SKIP — reported every run
 *       so it cannot silently drift).
 *   1 — real-population screenshot rate < threshold with a sufficient sample.
 *   2 — wrangler/d1 query could not run.
 *
 * The canary reads only — no DDL, no DML. It runs against `--remote`
 * (production D1) by default. Use `--local` to dry-run against the `wrangler
 * dev` D1 fixture. The query is constant and idempotent.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATABASE_NAME = "0509";
const DEFAULT_WINDOW_HOURS = 48;
const DEFAULT_ALERT_THRESHOLD_PCT = 80.0;
const DEFAULT_MIN_SAMPLE = 20;

/** Launch-gate captures whose artifacts cleanup strips after the gate runs. */
const CANARY_KIND = "launch_readiness_real_capture";

/** The capture-path code the guard is protecting (issue acceptance 3c). */
const CAPTURE_PATH_REF =
  "app/lib/browser-run.server.ts (persistBrowserArtifacts) + app/lib/monitoring.server.ts (requireScreenshot:true)";
const CANARY_CLEANUP_REF =
  "app/lib/data/launch-canary-cleanup.server.ts → app/lib/proof-artifact-retention.server.ts (clearOwnerProofArtifactReference)";

/** Stable marker so the auto-filed issue is greppable and de-duplicable. */
const ISSUE_BODY_MARKER = "screenshot-rate-guard-incident";

/**
 * @param {string[]} argv
 * @returns {{local: boolean, json: boolean, windowHours: number, threshold: number, minSample: number, fileIssue: boolean, dryRun: boolean}}
 */
export function parseArgs(argv) {
  /** @type {{local: boolean, json: boolean, windowHours: number, threshold: number, minSample: number, fileIssue: boolean, dryRun: boolean}} */
  const parsed = {
    local: false,
    json: false,
    windowHours: DEFAULT_WINDOW_HOURS,
    threshold: DEFAULT_ALERT_THRESHOLD_PCT,
    minSample: DEFAULT_MIN_SAMPLE,
    fileIssue: false,
    dryRun: false,
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
    if (arg === "--file-issue") {
      parsed.fileIssue = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
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
    if (arg === "--threshold" && argv[index + 1]) {
      const value = Number.parseFloat(argv[index + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 100) {
        parsed.threshold = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--min-sample" && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.minSample = value;
      }
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --local, --json, --file-issue, --dry-run, --window-hours <int>, --threshold <0..100>, --min-sample <int>.`,
    );
  }
  return parsed;
}

/** One row per project kind so the canary can tell real watcher captures from
 * cleanup-stripped launch-gate captures. Integer-concatenated window (no SQL
 * interpolation), mirroring canary-proof-budget-skip-surface.
 * @param {number} windowHours */
export function buildScreenshotRateQuery(windowHours) {
  return `
    SELECT
      json_extract(capture_metadata_json, '$.kind') AS kind,
      COUNT(*) AS total,
      SUM(CASE WHEN screenshot_artifact_key IS NOT NULL AND TRIM(screenshot_artifact_key) != '' THEN 1 ELSE 0 END) AS with_shot
    FROM proof_capture
    WHERE status = 'succeeded'
      AND created_at > datetime('now', '-' || ${Math.floor(windowHours)} || ' hours')
    GROUP BY json_extract(capture_metadata_json, '$.kind');
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
 * @returns {{real: {kind: string | null, total: number, withShot: number, pct: number}, canary: {kind: string | null, total: number, withShot: number, pct: number}, all: {total: number, withShot: number, pct: number}}}
 */
export function mapScreenshotRateRows(rows) {
  let realTotal = 0;
  let realWithShot = 0;
  let canaryTotal = 0;
  let canaryWithShot = 0;
  for (const row of rows) {
    const kind = typeof row.kind === "string" ? row.kind : null;
    const total = Number(row.total ?? 0);
    const withShot = Number(row.with_shot ?? 0);
    if (kind === CANARY_KIND) {
      canaryTotal += total;
      canaryWithShot += withShot;
    } else {
      realTotal += total;
      realWithShot += withShot;
    }
  }
  /** @param {number} withShot @param {number} total */
  const pct = (withShot, total) =>
    total > 0 ? Math.round((1000 * withShot) / total) / 10 : 0;
  const real = {
    kind: null,
    total: realTotal,
    withShot: realWithShot,
    pct: pct(realWithShot, realTotal),
  };
  const canary = {
    kind: CANARY_KIND,
    total: canaryTotal,
    withShot: canaryWithShot,
    pct: pct(canaryWithShot, canaryTotal),
  };
  const allTotal = realTotal + canaryTotal;
  return {
    real,
    canary,
    all: {
      total: allTotal,
      withShot: realWithShot + canaryWithShot,
      pct: pct(realWithShot + canaryWithShot, allTotal),
    },
  };
}

/**
 * @param {{real: {total: number, withShot: number, pct: number}, canary: {total: number, withShot: number, pct: number}, all: {total: number, withShot: number, pct: number}, windowHours: number, threshold: number, minSample: number}} input
 * @returns {{verdict: "pass" | "fail" | "skip", failures: string[], skips: string[]}}
 */
export function validateScreenshotRate(input) {
  const { real, windowHours, threshold, minSample } = input;
  const failures = [];
  const skips = [];
  if (real.total === 0) {
    skips.push(
      `no real succeeded proof captures in the last ${windowHours}h (n=0); nothing to judge — reported so silence cannot drift.`,
    );
  } else if (real.total < minSample) {
    skips.push(
      `real-success sample too small to judge: n=${real.total} (< min-sample ${minSample}) in the last ${windowHours}h.`,
    );
  } else if (real.pct < threshold) {
    failures.push(
      `proof screenshot success rate dropped below ${threshold}% over the last ${windowHours}h: ${real.pct}% (${real.withShot}/${real.total} succeeded captures with a screenshot key).`,
    );
  }
  return {
    verdict: failures.length > 0 ? "fail" : skips.length > 0 ? "skip" : "pass",
    failures,
    skips,
  };
}

/** Acceptance 3c: the auto-filed ticket must carry rate, sample size, and a
 * link to the capture-path code.
 * @param {{real: {kind: string | null, total: number, withShot: number, pct: number}, canary: {kind: string | null, total: number, withShot: number, pct: number}, all: {total: number, withShot: number, pct: number}, windowHours: number, threshold: number, minSample: number, checkedAt: string}} input
 * @returns {string} */
export function buildIssueBody(input) {
  const { real, canary, all, windowHours, threshold, minSample, checkedAt } = input;
  const lines = [];
  lines.push(`## Proof screenshot success rate regression (issue #1327 guard)`);
  lines.push("");
  lines.push(`The watcher proof-capture screenshot rate dropped below ${threshold}%.`);
  lines.push("");
  lines.push(`- **rate (real watcher captures):** ${real.pct}%`);
  lines.push(`- **sample size:** ${real.withShot}/${real.total} succeeded captures carried a screenshot key in the last ${windowHours}h`);
  lines.push(`- **window:** last ${windowHours}h (checked ${checkedAt})`);
  lines.push(`- **min sample to judge:** ${minSample}`);
  lines.push("");
  lines.push(`### Population breakdown`);
  lines.push(`- watcher captures (\`kind IS NULL\`): ${real.withShot}/${real.total} with a screenshot key (${real.pct}%)`);
  lines.push(`- launch-gate captures (\`kind='${CANARY_KIND}'\`): ${canary.withShot}/${canary.total} with a screenshot key (${canary.pct}%) — keys are deleted by launch-canary cleanup by design, so they are diagnostic only, never a regression signal`);
  lines.push(`- aggregate (all succeeded): ${all.withShot}/${all.total} with a screenshot key (${all.pct}%)`);
  lines.push("");
  lines.push(`### Capture-path code`);
  lines.push(`The guard protects the persisted-screenshot contract in \`${CAPTURE_PATH_REF}\`.`);
  lines.push(`Launch-gate captures are stripped by \`${CANARY_CLEANUP_REF}\`.`);
  lines.push("");
  lines.push(`> run by \`scripts/canary-proof-screenshot-rate.mjs\` (fleet worker, scheduled by \`ops/screenshot-rate-guard/\`).`);
  lines.push("");
  lines.push(`${ISSUE_BODY_MARKER}: true, window_hours: ${windowHours}, rate: ${real.pct}, n: ${real.total}`);
  return lines.join("\n");
}

/** The exact `gh issue create` argv the canary would run to file the incident.
 * @param {{body: string, title: string, repo: string}} input
 * @returns {string[]} */
export function buildGhIssueCommand({ body, title, repo }) {
  return ["issue", "create", "-R", repo, "--title", title, "--body", body];
}

/**
 * @typedef {{
 *   local: boolean,
 *   windowHours: number,
 *   threshold: number,
 *   minSample: number,
 *   checkedAt: string,
 *   real: {kind: string | null, total: number, withShot: number, pct: number},
 *   canary: {kind: string | null, total: number, withShot: number, pct: number},
 *   all: {total: number, withShot: number, pct: number},
 *   validation: {verdict: "pass" | "fail" | "skip", failures: string[], skips: string[]},
 * }} ScreenshotRateReportInput
 */

/**
 * @typedef {{
 *   verdict: "pass" | "fail" | "skip",
 *   ok: boolean,
 *   local: boolean,
 *   windowHours: number,
 *   threshold: number,
 *   minSample: number,
 *   database: string,
 *   checkedAt: string,
 *   real: {kind: string | null, total: number, withShot: number, pct: number},
 *   canary: {kind: string | null, total: number, withShot: number, pct: number},
 *   all: {total: number, withShot: number, pct: number},
 *   failures: string[],
 *   skips: string[],
 *   capturePathRef: string,
 *   canaryCleanupRef: string,
 * }} ScreenshotRateReport
 */

/**
 * @param {ScreenshotRateReportInput} input
 * @returns {ScreenshotRateReport}
 */
function summarize(input) {
  const { real, canary, all, windowHours, threshold, minSample, local } = input;
  return {
    verdict: input.validation.verdict,
    local,
    windowHours,
    threshold,
    minSample,
    database: DATABASE_NAME,
    checkedAt: input.checkedAt,
    real: {
      kind: real.kind,
      total: real.total,
      withShot: real.withShot,
      pct: real.pct,
    },
    canary: {
      kind: canary.kind,
      total: canary.total,
      withShot: canary.withShot,
      pct: canary.pct,
    },
    all: {
      total: all.total,
      withShot: all.withShot,
      pct: all.pct,
    },
    failures: input.validation.failures,
    skips: input.validation.skips,
    capturePathRef: CAPTURE_PATH_REF,
    canaryCleanupRef: CANARY_CLEANUP_REF,
    ok: input.validation.verdict !== "fail",
  };
}

/** @param {ScreenshotRateReportInput} input */
function renderHumanReport(input) {
  const s = summarize(input);
  const lines = [];
  lines.push(
    `proof-screenshot-rate canary (mode=${s.local ? "local" : "remote"}, window=${s.windowHours}h, threshold=${s.threshold}%, minSample=${s.minSample} at ${s.checkedAt})`,
  );
  lines.push(
    `- watcher captures (kind IS NULL): ${s.real.withShot}/${s.real.total} with a screenshot key (${s.real.pct}%) — VERDICT POPULATION`,
  );
  lines.push(
    `- launch-gate captures (${CANARY_KIND}): ${s.canary.withShot}/${s.canary.total} with a screenshot key (${s.canary.pct}%) — keys stripped by cleanup, diagnostic only`,
  );
  lines.push(`- aggregate (all succeeded): ${s.all.withShot}/${s.all.total} with a screenshot key (${s.all.pct}%)`);
  if (s.verdict === "pass") {
    lines.push(`verdict: ok — ${s.real.pct}% >= ${s.threshold}% (n=${s.real.total}).`);
  } else if (s.verdict === "skip") {
    lines.push(`verdict: skip — ${s.skips.join(" ")}`);
  } else {
    lines.push(`verdict: FAILED —`);
    for (const failure of s.failures) {
      lines.push(`- ${failure}`);
    }
  }
  lines.push(`capture path: ${CAPTURE_PATH_REF}`);
  return lines.join("\n");
}

/**
 * @param {{repo: string}} input
 * @returns {{existing: boolean, command: string[] | null}} existing=true when an
 * open incident already exists (dedupe), else the gh create argv (or the stdin
 * sql wire when dry-run is handled by the caller).
 */
export function findExistingOpenIncident({ repo }) {
  try {
    const result = spawnSync("gh", ["issue", "list", "-R", repo, "--search", `${ISSUE_BODY_MARKER} in:body`, "--state", "open", "--json", "number", "--limit", "5"], {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) return { existing: false, command: null };
    const parsed = JSON.parse(result.stdout || "[]");
    return { existing: Array.isArray(parsed) && parsed.length > 0, command: null };
  } catch {
    return { existing: false, command: null };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkedAt = new Date().toISOString();
  const query = buildScreenshotRateQuery(args.windowHours);
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
      console.error(`proof-screenshot-rate canary: ${message}`);
    }
    process.exit(2);
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: message, mode: args.local ? "local" : "remote", windowHours: args.windowHours }, null, 2));
    } else {
      console.error(`proof-screenshot-rate canary: wrangler d1 execute failed${message ? `: ${message}` : ""}`);
    }
    process.exit(2);
  }

  const rows = rowsFromWranglerJson(result.stdout ?? "");
  const buckets = mapScreenshotRateRows(rows);
  const validation = validateScreenshotRate({
    real: buckets.real,
    canary: buckets.canary,
    all: buckets.all,
    windowHours: args.windowHours,
    threshold: args.threshold,
    minSample: args.minSample,
  });

  const input = {
    real: buckets.real,
    canary: buckets.canary,
    all: buckets.all,
    windowHours: args.windowHours,
    threshold: args.threshold,
    minSample: args.minSample,
    checkedAt,
    validation,
    local: args.local,
  };

  const report = summarize(input);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHumanReport(input));
  }

  if (
    validation.verdict === "fail" &&
    args.fileIssue
  ) {
    const repo = "Nishfleet/0509";
    const title = `Proof screenshot success rate regression: ${buckets.real.pct}% (${buckets.real.withShot}/${buckets.real.total}) over last ${args.windowHours}h`;
    const body = buildIssueBody(input);
    const command = buildGhIssueCommand({ body, title, repo });
    if (args.dryRun) {
      console.log(`[dry-run] would run: gh ${command.map((c) => JSON.stringify(c)).join(" ")}`);
    } else {
      const existing = findExistingOpenIncident({ repo });
      if (existing.existing) {
        console.log("auto-file skipped: an open screenshot-rate-guard incident already exists (dedupe).");
        process.exit(1);
      }
      const createResult = spawnSync("gh", command, {
        cwd: root,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      if (createResult.status !== 0) {
        const message = (createResult.stderr || createResult.stdout || "").trim();
        console.log(`auto-file failed${message ? `: ${message}` : ""}`);
        process.exit(1);
      }
      console.log(`auto-filed: ${(createResult.stdout ?? "").trim()}`);
    }
  }

  process.exit(validation.verdict === "fail" ? 1 : 0);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}