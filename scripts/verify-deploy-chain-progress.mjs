#!/usr/bin/env node
// The deploy-chain progress detector (0509#2975, reopened accept item):
// proves the deploy-latest chain still lands under the fleet's merge
// cadence, and names the two ways it could silently stop.
//
// Deploy-latest semantics on main (deploy-production.yml concurrency):
// one running deploy + at most one pending deploy per push; a newer push
// cancels the superseded PENDING run and takes its place, while the
// running deploy always finishes. So `conclusion: cancelled` is benign
// ONLY when the run never started a job. The two breach classes:
//
//   midflight_kill — a cancelled run that had started jobs. A deploy
//     in flight was killed: the failure the judge feared ("a deploy that
//     takes longer than the merge gap is cancelled before it finishes").
//   starved — nothing is live (no queued/in_progress run) and the newest
//     observed run was cancelled, or no run in the window ever reached a
//     terminal state: merges landed but the chain stopped attempting.
//
// Prints exactly one line:
//   deploy_chain: verdict=<ok|breach|unknown> runs=<n> superseded_pending=<n> unprobed_cancelled=<n> midflight_kills=<id,..|none> live=<n> last_terminal=<conclusion>@<id|none> detail=<code,..|->
// into the deploy-production step summary on every run (success AND
// failure); the fleet-ops judges' measure can consume the same line.
// Sources: the Actions runs API when a token exists. Always exits 0 — a
// detector that crashes is the silent failure this script exists to
// kill, so errors fold into the line instead.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const REPOSITORY = "Nishfleet/0509";
const WORKFLOW = "deploy-production.yml";
const RUNS_PAGE_SIZE = 30;
const LIVE_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);

/** @typedef {{ id?: number, status?: string | null, conclusion?: string | null, created_at?: string, head_sha?: string, jobs_started?: number | null }} DeployRunEntry */

/**
 * Pure assessor over a newest-first run list. `jobs_started` matters only
 * for cancelled runs (the fetcher fills it); a cancelled run with
 * jobs_started > 0 was killed mid-flight.
 * @param {DeployRunEntry[]} runs newest first
 */
export function assessDeployChain(runs) {
  /** @type {string[]} */
  const issues = [];
  /** @type {number[]} */
  const midflightKills = [];
  let supersededPending = 0;
  let unprobedCancelled = 0;
  let live = 0;
  /** @type {DeployRunEntry | null} */
  let lastTerminal = null;
  for (const run of runs) {
    if (typeof run.status === "string" && LIVE_STATUSES.has(run.status)) {
      live += 1;
      continue;
    }
    if (run.conclusion === "cancelled") {
      if (run.jobs_started == null) {
        // The jobs probe failed — inconclusive, not a confirmed
        // supersession. Counted so the gap is visible on the line.
        unprobedCancelled += 1;
      } else if (run.jobs_started > 0) {
        midflightKills.push(run.id ?? -1);
      } else {
        supersededPending += 1;
      }
      continue;
    }
    if (typeof run.conclusion === "string" && !lastTerminal) {
      lastTerminal = run;
    }
  }
  if (midflightKills.length > 0) {
    issues.push(
      `midflight_kill: cancelled run(s) had started jobs: ${midflightKills.join(",")}`,
    );
  }
  const newest = runs[0] ?? null;
  if (
    midflightKills.length === 0 &&
    runs.length > 0 &&
    live === 0 &&
    newest?.conclusion === "cancelled"
  ) {
    issues.push(
      "starved: newest observed run was superseded-cancelled and no live run follows it",
    );
  }
  if (
    midflightKills.length === 0 &&
    runs.length > 0 &&
    live === 0 &&
    !lastTerminal
  ) {
    issues.push(
      "starved: every run in the window was cancelled before starting; the chain never ran",
    );
  }
  return {
    verdict: issues.length > 0 ? "breach" : "ok",
    issues,
    runs: runs.length,
    supersededPending,
    unprobedCancelled,
    midflightKills,
    live,
    lastTerminal,
  };
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {string} path
 */
async function apiGet(token, repository, path) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
      },
    },
  );
  if (!response.ok) return null;
  return response.json();
}

/**
 * Count jobs a run actually had — 0 means the run was superseded while
 * still pending (benign deploy-latest); >0 means it was killed mid-flight.
 * @param {string} token
 * @param {string} repository
 * @param {number} runId
 */
async function jobsStarted(token, repository, runId) {
  const payload = await apiGet(
    token,
    repository,
    `/actions/runs/${runId}/jobs?per_page=100&filter=all`,
  );
  if (!payload || !Array.isArray(payload.jobs)) return null;
  return payload.jobs.length;
}

async function measure() {
  const repository = process.env.GITHUB_REPOSITORY?.trim() || REPOSITORY;
  const token =
    process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
  if (!token) {
    return "deploy_chain: verdict=unknown runs=0 superseded_pending=0 unprobed_cancelled=0 midflight_kills=none live=0 last_terminal=none detail=no_token";
  }
  const payload = await apiGet(
    token,
    repository,
    `/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=${RUNS_PAGE_SIZE}`,
  );
  /** @type {DeployRunEntry[]} */
  const raw = Array.isArray(payload?.workflow_runs)
    ? payload.workflow_runs
    : [];
  if (raw.length === 0) {
    return "deploy_chain: verdict=unknown runs=0 superseded_pending=0 unprobed_cancelled=0 midflight_kills=none live=0 last_terminal=none detail=no_runs";
  }
  /** @type {DeployRunEntry[]} */
  const runs = [];
  for (const run of raw) {
    /** @type {DeployRunEntry} */
    const entry = {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      head_sha: run.head_sha,
      jobs_started: null,
    };
    if (run.conclusion === "cancelled" && Number.isInteger(run.id)) {
      entry.jobs_started = await jobsStarted(
        token,
        repository,
        /** @type {number} */ (run.id),
      );
    }
    runs.push(entry);
  }
  const result = assessDeployChain(runs);
  const kills = result.midflightKills.length
    ? result.midflightKills.join(",")
    : "none";
  const lastTerminal = result.lastTerminal
    ? `${result.lastTerminal.conclusion}@${result.lastTerminal.id}`
    : "none";
  // detail carries the issue class codes (space-free, key=value safe);
  // the kill ids already have their own field.
  const detail = result.issues.length
    ? result.issues.map((issue) => issue.split(":")[0]).join("+")
    : "-";
  return `deploy_chain: verdict=${result.verdict} runs=${result.runs} superseded_pending=${result.supersededPending} unprobed_cancelled=${result.unprobedCancelled} midflight_kills=${kills} live=${result.live} last_terminal=${lastTerminal} detail=${detail}`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(`${await measure()}\n`);
  } catch (error) {
    const detail = (
      error instanceof Error ? error.message : "unknown"
    ).replace(/[^a-zA-Z0-9_.-]+/gu, "_");
    process.stdout.write(
      `deploy_chain: verdict=unknown runs=0 superseded_pending=0 unprobed_cancelled=0 midflight_kills=none live=0 last_terminal=none detail=detector_error:${detail}\n`,
    );
  }
}
