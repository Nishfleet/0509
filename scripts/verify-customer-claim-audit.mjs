#!/usr/bin/env node
// BET 10 part 3 (#977): run every mapped query/test in the customer-claim
// audit table. Fails closed if a non-Nish-reserved claim is not pass, if a
// mapped test file is missing, or if the mapped vitest run is red.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const AUDIT_PATH = resolve(root, "docs/customer-claim-audit-table.json");
const TEST_PATH_RE = /\b(tests\/[A-Za-z0-9._/-]+\.test\.tsx?)\b/g;
const LIVE_D1_SQL = [
  "SELECT",
  "(SELECT COUNT(*) FROM proof_capture WHERE status='succeeded') AS succeeded_total,",
  "(SELECT COUNT(*) FROM proof_capture WHERE status='succeeded' AND screenshot_artifact_key IS NOT NULL AND length(screenshot_artifact_key) > 0) AS succeeded_with_screenshot,",
  "(SELECT COUNT(*) FROM proof_capture WHERE status='succeeded' AND created_at >= datetime('now','-48 hours')) AS succeeded_48h,",
  "(SELECT COUNT(*) FROM proof_capture WHERE status='succeeded' AND created_at >= datetime('now','-48 hours') AND screenshot_artifact_key IS NOT NULL AND length(screenshot_artifact_key) > 0) AS succeeded_48h_with_screenshot,",
  "(SELECT COUNT(*) FROM landing_page_snapshot) AS snapshot_rows;",
].join(" ");

/** @param {string} text */
export function extractMappedTestFiles(text) {
  return [...text.matchAll(TEST_PATH_RE)].map((match) => match[1]);
}

function fail(message) {
  console.error(`verify-customer-claim-audit: ${message}`);
  process.exit(1);
}

function loadAudit() {
  const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8"));
  if (!Array.isArray(audit.claims) || audit.claims.length === 0) {
    fail("audit table has no claims");
  }
  return audit;
}

function assertClaimsPass(audit) {
  const failing = [];
  for (const claim of audit.claims) {
    if (claim.nishReserved) continue;
    if (claim.currentResult !== "pass") {
      failing.push(`${claim.claimId}=${claim.currentResult}`);
    }
  }
  if (failing.length > 0) {
    fail(`non-Nish-reserved claims must pass: ${failing.join(", ")}`);
  }
}

function collectMappedTests(audit) {
  const files = new Set();
  for (const claim of audit.claims) {
    if (claim.nishReserved) continue;
    const named = extractMappedTestFiles(String(claim.liveQueryOrTest ?? ""));
    if (named.length === 0) {
      fail(`${claim.claimId} liveQueryOrTest names no tests/*.test.ts file`);
    }
    for (const filePath of named) {
      const abs = resolve(root, filePath);
      if (!existsSync(abs)) fail(`${claim.claimId} missing ${filePath}`);
      files.add(filePath);
    }
  }
  return [...files].sort();
}

function runMappedTests(files) {
  const args = [
    resolve(root, "scripts/ci-vitest-run.sh"),
    "--",
    "vitest",
    "run",
    "--configLoader",
    "runner",
    "--project",
    "node",
    ...files,
  ];
  const result = spawnSync("bash", args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${resolve(root, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`mapped tests failed with exit ${result.status ?? 1}`);
  }
}

function parseWranglerJson(stdout) {
  const start = stdout.search(/[\[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

function runLiveD1() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!apiToken) {
    console.log("SKIP: live D1 query — wrangler credentials are not in this environment");
    return "skip";
  }
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "0509", "--remote", "--json", "--command", LIVE_D1_SQL],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    fail(`live D1 query failed (wrangler exit ${result.status ?? 1})`);
  }
  const parsed = parseWranglerJson(result.stdout ?? "");
  const row = Array.isArray(parsed) ? parsed[0]?.results?.[0] : parsed?.results?.[0];
  if (!row) fail("live D1 query returned no row");
  console.log(
    `live D1: succeeded=${row.succeeded_total} with_screenshot=${row.succeeded_with_screenshot} ` +
      `48h=${row.succeeded_48h} 48h_with_screenshot=${row.succeeded_48h_with_screenshot} ` +
      `landing_page_snapshot=${row.snapshot_rows}`,
  );
  return "ran";
}

function main() {
  const audit = loadAudit();
  assertClaimsPass(audit);
  const mappedTests = collectMappedTests(audit);
  console.log(`mapped tests: ${mappedTests.length} files`);
  runMappedTests(mappedTests);
  const d1 = runLiveD1();
  console.log(`verify-customer-claim-audit: ok claims=pass mapped=${mappedTests.length} d1=${d1}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
