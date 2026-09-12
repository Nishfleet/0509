#!/usr/bin/env node
// The stalled-deploy detector (0509#2975 item 4). Prints exactly one line:
//   deploy: last_success_age_h=<n> merges_since=<m> last_failure=<reason> live_edge_cache=<HIT|MISS|UNREACHABLE|skipped>
// into the deploy-production step summary on every run (success AND
// failure); the fleet-ops judges' measure consumes the same script.
// Sources: the Actions runs API when a token exists, else deploy-ledger.jsonl
// in HEAD's tree. Always exits 0 — a detector that crashes is the silent
// failure this script exists to kill, so errors fold into the line instead.
//
// live_edge_cache: the second-request x-0509-edge-cache: HIT probe from
// scripts/check-live-public-home.mjs (issue #2950). The deploy workflow's
// own `live_public_truth` post-deploy step runs that script and gates the
// release on it, but that step only emits its verdict on a successful
// deploy execution. This detector surfaces the same probe — cheaply, no
// retry budget, fold-into-line on failure — on EVERY deploy run, including
// runs that failed at an earlier gate and never reached live_public_truth.
// A `MISS` line on a green-deploy success story means the edge cache
// reconciliation regressed between when the gate ran and now; an
// `UNREACHABLE` line on repeated runs means the live probe budget itself
// is broken. Issue #3224 made this part of the chain-level detector
// surface, complementing the fleet-ops FleetProductionStale alert
// (fleet-ops#5785).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  reachableFromHead,
  resolveRewrittenRecordedHead,
  readDeployLedgerRows,
} from "./verify-remote-restore-evidence.mjs";

const REPOSITORY = "Nishfleet/0509";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;

/** @typedef {{ head_sha?: string, updated_at?: string, conclusion?: string | null, id?: number }} WorkflowRunEntry */

/**
 * @param {string} token
 * @param {string} repository
 * @param {string} status
 * @param {(entry: WorkflowRunEntry) => boolean} keep
 */
async function newestRun(token, repository, status, keep) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/deploy-production.yml/runs?branch=main&status=${status}&per_page=20`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload?.workflow_runs)
      ? (payload.workflow_runs.find(keep) ?? null)
      : null;
  } catch {
    return null;
  }
}

/** @param {string} sha recorded deployed commit, possibly rewrite-stranded */
function anchorFor(sha) {
  if (reachableFromHead(sha)) return sha;
  return resolveRewrittenRecordedHead(sha, { warn: () => {} });
}

async function measure() {
  const repository = process.env.GITHUB_REPOSITORY?.trim() || REPOSITORY;
  const token =
    process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";

  /** @type {{ sha: string, at: string } | null} */
  let lastSuccess = null;
  /** @type {string | null} */
  let lastFailure = null;
  if (token) {
    const successRun = await newestRun(token, repository, "success", (e) =>
      SHA_PATTERN.test(e?.head_sha ?? "") &&
      Number.isFinite(Date.parse(e?.updated_at ?? "")));
    if (successRun) {
      lastSuccess = { sha: successRun.head_sha, at: successRun.updated_at };
    }
    const failedRun = await newestRun(token, repository, "completed", (e) =>
      typeof e?.conclusion === "string" &&
      e.conclusion !== "success" &&
      Number.isInteger(e?.id));
    if (failedRun) {
      lastFailure = `${failedRun.conclusion}@${failedRun.id}`;
    }
  }
  if (!lastSuccess) {
    // Offline/no-token path: the committed ledger is the deploy record.
    const row = readDeployLedgerRows().at(-1) ?? null;
    if (row) lastSuccess = { sha: row.sha, at: row.deployed_at };
  }

  const failure = lastFailure ?? (token ? "none" : "unknown");
  if (!lastSuccess) {
    return `deploy: last_success_age_h=unknown merges_since=unknown last_failure=${failure} live_edge_cache=${await probeLiveEdgeCache()}`;
  }
  const ageHours = Math.floor(
    (Date.now() - Date.parse(lastSuccess.at)) / 3_600_000,
  );
  const anchor = anchorFor(lastSuccess.sha);
  let merges = "unknown";
  if (anchor) {
    try {
      merges = execFileSync(
        "git",
        ["rev-list", "--count", "--first-parent", `${anchor}..HEAD`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      merges = "unknown";
    }
  }
  return `deploy: last_success_age_h=${Number.isFinite(ageHours) ? ageHours : "unknown"} merges_since=${merges} last_failure=${failure} live_edge_cache=${await probeLiveEdgeCache()}`;
}

// probeLiveEdgeCache: second-request x-0509-edge-cache probe.
// Returns one of:
//   HIT         — second anonymous GET to / carries x-0509-edge-cache: HIT (PR #3054 shipped)
//   MISS        — second GET did NOT carry the HIT stamp (a stale build, or the deploy never reached prod)
//   UNREACHABLE — the probe itself could not connect to / timeout / DNS failure
//   skipped     — PUBLIC_HOME_URL disabled the probe (set to an empty string)
//
// Two anonymous GETs of the homepage. The first warms; the second proves
// the edge variant is in place. Each probe is bounded to 10s; the whole
// probe is bounded to 25s in the worst case. Always exits 0 — the result
// string folds into the measure line above. Never throws.
async function probeLiveEdgeCache() {
  const url = process.env.PUBLIC_HOME_URL;
  if (url === "") return "skipped";
  const target = url ?? "https://0509.io/";
  /** @param {string} path @returns {Promise<Response>} */
  const head = (path) =>
    fetch(new URL(path, target), {
      headers: { "user-agent": "0509-deploy-age-detector/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
  try {
    const first = await head("/");
    await first.text();
    const second = await head("/");
    await second.text();
    const stamp = second.headers.get("x-0509-edge-cache");
    return stamp === "HIT" ? "HIT" : "MISS";
  } catch {
    return "UNREACHABLE";
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(`${await measure()}\n`);
  } catch (error) {
    // Last-resort fallback: emit a line the parser can still read. The
    // measure function above already folds probe failures into `live_edge_cache=UNREACHABLE`;
    // this branch only fires on a real exception (e.g. execFileSync failure).
    process.stdout.write(
      `deploy: last_success_age_h=unknown merges_since=unknown last_failure=detector_error:${error instanceof Error ? error.message : "unknown"} live_edge_cache=skipped\n`,
    );
  }
}
