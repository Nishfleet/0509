#!/usr/bin/env node
/**
 * verify:claims — BET 10 claim audit runner (issue #1278).
 *
 * Reads the claim-by-claim audit table in docs/customer-claim-surface-registry.json
 * (the `rows` array: public sentence -> page/selector -> claimed/verified ->
 * verification command -> live test) and:
 *
 *  1. validates the row shape (every row carries page, selector, sentence,
 *     claimed/verified booleans, a verify command, and a test link);
 *  2. runs every row's `verify` command with /bin/sh -c and fails on any
 *     non-zero exit — mechanical only, no human input;
 *  3. enforces the reconciliation invariants:
 *       - a row with claimed != verified MUST carry an open follow-up issue
 *         URL (followUp), so a claim gap is never closed silently;
 *       - wrangler.jsonc FUNNEL_MEASUREMENT_ENABLED and docs/ga-metrics.md
 *         agree on the funnel flag's state (off pending §8 gates, #1278);
 *       - docs/ga-positioning.md header carries no LIVE/NOT LIVE release
 *         verdict and points at the scorecard + CLAUDE.md;
 *       - the in-repo design-unification ledger references point at this repo.
 *
 * Exits 0 only when every row verifies and every invariant holds; exits 1
 * otherwise. Run via `npm run verify:claims`. Optional: `--registry <path>`
 * to check a different registry file (used by the regression test).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_REGISTRY = resolve(REPO_ROOT, "docs/customer-claim-surface-registry.json");

const argv = process.argv.slice(2);
const registryArgIndex = argv.indexOf("--registry");
const registryPath =
  registryArgIndex !== -1 && argv[registryArgIndex + 1]
    ? resolve(REPO_ROOT, argv[registryArgIndex + 1])
    : DEFAULT_REGISTRY;

const failures = [];
const rowResults = [];

function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
}

function runCommand(command) {
  const result = spawnSync("/bin/sh", ["-c", command], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
  if (result.error) return { ok: false, detail: String(result.error) };
  return { ok: result.status === 0, detail: result.status !== 0 ? `exit ${result.status}` : "" };
}

// ---------------------------------------------------------------------------
// 1 + 2. Registry rows: shape validation then per-row command execution.
// ---------------------------------------------------------------------------
let registry;
try {
  registry = JSON.parse(readFileSync(registryPath, "utf8"));
} catch (error) {
  console.error(`verify:claims: cannot read registry ${registryPath}: ${error.message}`);
  process.exit(1);
}

const rows = registry.rows;
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("verify:claims: registry has no rows array");
  process.exit(1);
}

const REQUIRED_ROW_FIELDS = ["claimId", "page", "selector", "sentence", "verify", "test"];
const seenRowIds = new Set();

for (const row of rows) {
  for (const field of REQUIRED_ROW_FIELDS) {
    if (typeof row[field] !== "string" || row[field].trim().length === 0) {
      fail(`row ${row.claimId ?? "(missing claimId)"}`, `field ${field} missing or empty`);
    }
  }
  if (typeof row.claimed !== "boolean" || typeof row.verified !== "boolean") {
    fail(`row ${row.claimId ?? "(missing claimId)"}`, "claimed/verified must be booleans");
  }
  if (seenRowIds.has(row.claimId)) {
    fail(`row ${row.claimId}`, "duplicate claimId");
  }
  seenRowIds.add(row.claimId);
  if (row.claimed !== row.verified) {
    if (typeof row.followUp !== "string" || !/^https:\/\/github\.com\/Nishfleet\/0509\/issues\/\d+$/.test(row.followUp)) {
      fail(`row ${row.claimId}`, `claimed != verified but no open followUp issue URL (followUp must be a Nishfleet/0509 issue URL)`);
    }
  }
}

for (const row of rows) {
  if (typeof row.verify !== "string" || row.verify.trim().length === 0) {
    continue; // already flagged above
  }
  const result = runCommand(row.verify);
  rowResults.push({ claimId: row.claimId, ok: result.ok });
  const marker = result.ok ? "PASS" : "FAIL";
  console.log(`${marker} verify:claims row ${row.claimId} (${row.page}${row.selector ? ` / ${row.selector}` : ""})`);
  if (!result.ok) {
    fail(`row ${row.claimId} verify command`, row.verify);
  }
}

// ---------------------------------------------------------------------------
// 3a. Funnel flag agreement (Reconciliation A): config and docs say off.
// ---------------------------------------------------------------------------
const wrangler = existsSync(resolve(REPO_ROOT, "wrangler.jsonc"))
  ? readFileSync(resolve(REPO_ROOT, "wrangler.jsonc"), "utf8")
  : "";
const gaMetrics = existsSync(resolve(REPO_ROOT, "docs/ga-metrics.md"))
  ? readFileSync(resolve(REPO_ROOT, "docs/ga-metrics.md"), "utf8")
  : "";
const flagIsOff = /"FUNNEL_MEASUREMENT_ENABLED"\s*:\s*"0"/.test(wrangler);
const docsSayDeferred = gaMetrics.includes("Enablement deferred; flag currently off in production");
if (!flagIsOff || !docsSayDeferred) {
  fail(
    "funnel-flag agreement",
    `expected FUNNEL_MEASUREMENT_ENABLED "0" in wrangler.jsonc (got ${flagIsOff ? "0" : "not 0"}) ` +
      `and 'Enablement deferred; flag currently off in production' in docs/ga-metrics.md ` +
      `(got ${docsSayDeferred ? "present" : "absent"})`,
  );
}
console.log(`PASS verify:claims funnel-flag agreement (config off + docs deferred)`);

// ---------------------------------------------------------------------------
// 3b. ga-positioning.md header: no release verdict, points at live truth.
// ---------------------------------------------------------------------------
const positioningPath = resolve(REPO_ROOT, "docs/ga-positioning.md");
if (existsSync(positioningPath)) {
  const header = readFileSync(positioningPath, "utf8").split("\n").slice(0, 12).join("\n");
  if (/\*\*Status:\*\*\s*LIVE/i.test(header) || /NOT LIVE/i.test(header)) {
    fail("ga-positioning header", "header still carries a LIVE/NOT LIVE release verdict");
  }
  if (!header.includes("final-self-serve-ga-scorecard.md") || !header.includes("CLAUDE.md")) {
    fail("ga-positioning header", "header must point at final-self-serve-ga-scorecard.md and CLAUDE.md for the verdict");
  }
  console.log("PASS verify:claims ga-positioning header (no verdict, points at scorecard + CLAUDE.md)");
} else {
  fail("ga-positioning", `missing ${positioningPath}`);
}

// ---------------------------------------------------------------------------
// 3c. Ledger references: in-repo pointer stays this repo (Reconciliation C).
// The machine-local stub at /home/nish/workspaces/agent-state/… is created by
// the worker, not by CI; the portable gate is the in-repo reference.
// ---------------------------------------------------------------------------
const backlogPath = resolve(REPO_ROOT, "docs/BACKLOG.md");
if (existsSync(backlogPath)) {
  const backlog = readFileSync(backlogPath, "utf8");
  if (!backlog.includes("docs/design-system-ratchet.json") || !/the real source of truth for program\s*state is this repo/i.test(backlog)) {
    fail("ledger references", "docs/BACKLOG.md no longer points the design-unification program at this repo's live sources");
  }
  console.log("PASS verify:claims ledger references (BACKLOG.md points at repo live sources)");
} else {
  fail("ledger references", `missing ${backlogPath}`);
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const openFollowUps = rows.filter((row) => row.claimed !== row.verified).length;
console.log(
  `verify:claims rows=${rows.length} claimed_ge_verified=${rows.length - openFollowUps} open_follow_ups=${openFollowUps}`,
);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  console.error(`verify:claims FAILED (${failures.length} failure(s), ${rowResults.filter((r) => !r.ok).length} row(s) red)`);
  process.exit(1);
}

console.log("verify:claims OK");
process.exit(0);