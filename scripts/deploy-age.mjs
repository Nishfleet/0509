#!/usr/bin/env node
// The stalled-deploy detector (0509#2975 item 4). Prints exactly one line:
//
//   deploy: last_success_age_h=<n> merges_since=<m> last_failure=<reason>
//
// Wiring: deploy-production.yml tees this line into the step summary on every
// run (success and failure). fleet-ops's judges' measure consumes the same
// script — a stalled deploy must be impossible to miss.
//
// Data sources, in order:
//   1. GitHub Actions API (when a token + repository context exist): newest
//      successful deploy-production run on main = last success; newest
//      completed non-success run = last failure.
//   2. deploy-ledger.jsonl in HEAD's tree: the deploy job's own committed
//      record — survives a wiped runs API and reads offline.
// `merges_since` counts first-parent commits on HEAD since the last deployed
// anchor, resolving a rewrite-stranded anchor by tree hash via the same
// recovery chain the gate uses.
//
// This is a reporter: it always exits 0. A detector that crashes is the
// silent-failure mode this script exists to kill, so every failure folds
// into the line instead.

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

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  if (!response.ok) return null;
  return response.json();
}

/** @returns {Promise<{ sha: string, at: string } | null>} */
async function lastSuccessfulDeploy(token, repository) {
  const payload = await fetchJson(
    `https://api.github.com/repos/${repository}/actions/workflows/deploy-production.yml/runs?branch=main&status=success&per_page=5`,
    token,
  );
  const run = Array.isArray(payload?.workflow_runs)
    ? payload.workflow_runs.find(
        (entry) =>
          entry?.conclusion === "success" &&
          SHA_PATTERN.test(entry?.head_sha ?? "") &&
          Number.isFinite(Date.parse(entry?.updated_at ?? "")),
      )
    : null;
  return run ? { sha: run.head_sha, at: run.updated_at } : null;
}

/** @returns {Promise<string | null>} */
async function lastDeployFailure(token, repository) {
  const payload = await fetchJson(
    `https://api.github.com/repos/${repository}/actions/workflows/deploy-production.yml/runs?branch=main&status=completed&per_page=20`,
    token,
  );
  const run = Array.isArray(payload?.workflow_runs)
    ? payload.workflow_runs.find(
        (entry) =>
          entry?.conclusion &&
          entry.conclusion !== "success" &&
          Number.isInteger(entry?.id),
      )
    : null;
  return run ? `${run.conclusion}@${run.id}` : null;
}

/**
 * @param {string} sha recorded deployed commit, possibly rewrite-stranded
 * @returns {string | null} an in-history anchor for it, or null
 */
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
    [lastSuccess, lastFailure] = await Promise.all([
      lastSuccessfulDeploy(token, repository),
      lastDeployFailure(token, repository),
    ]);
  }
  if (!lastSuccess) {
    // Offline/no-token path: the committed ledger is the deploy record.
    const row = readDeployLedgerRows().at(-1) ?? null;
    if (row) lastSuccess = { sha: row.sha, at: row.deployed_at };
  }

  const failure = lastFailure ?? (token ? "none" : "unknown");
  if (!lastSuccess) {
    return `deploy: last_success_age_h=unknown merges_since=unknown last_failure=${failure}`;
  }
  const ageHours = Math.floor(
    (Date.now() - Date.parse(lastSuccess.at)) / 3_600_000,
  );
  const anchor = anchorFor(lastSuccess.sha);
  let merges = "unknown";
  if (anchor) {
    try {
      merges = git([
        "rev-list",
        "--count",
        "--first-parent",
        `${anchor}..HEAD`,
      ]);
    } catch {
      merges = "unknown";
    }
  }
  return `deploy: last_success_age_h=${Number.isFinite(ageHours) ? ageHours : "unknown"} merges_since=${merges} last_failure=${failure}`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(`${await measure()}\n`);
  } catch (error) {
    process.stdout.write(
      `deploy: last_success_age_h=unknown merges_since=unknown last_failure=detector_error:${error instanceof Error ? error.message : "unknown"}\n`,
    );
  }
}
