#!/usr/bin/env node
// deploy-ledger.jsonl — the append-only production deploy record committed on
// main by deploy-production.yml after every successful deploy.
//
// Why it exists (0509#2975): the deploy gate's last-successful-deploy chain
// anchors on the head SHA of the newest green deploy-production run, which the
// GitHub runs API reports. A main history rewrite leaves that recorded head
// unreachable, and a repository rename zeroes the run history outright — both
// observed live. This file survives both: it is read out of HEAD's own tree,
// and each row carries the deployed commit's TREE hash, so a rewritten head
// still resolves to its in-history equivalent.
//
// Row schema (one JSON object per line, newest last):
//   {"sha":<40-hex deployed commit>, "tree":<40-hex tree of that commit>,
//    "deployed_at":<ISO-8601>, "version_id":<Worker version id or null>}

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";

export const DEPLOY_LEDGER_PATH = "deploy-ledger.jsonl";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/u;

/**
 * Parse ledger text into validated rows. Malformed lines are skipped: a single
 * corrupt line must not poison every future deploy's anchor resolution. Rows
 * are returned in file order (oldest first).
 *
 * @param {unknown} text
 * @returns {Array<{ sha: string, tree: string | null, deployed_at: string, version_id: string | null }>}
 */
export function parseDeployLedgerRows(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (!SHA_PATTERN.test(row.sha)) continue;
    if (row.tree !== null && !SHA_PATTERN.test(row.tree ?? "")) continue;
    if (
      typeof row.deployed_at !== "string" ||
      !Number.isFinite(Date.parse(row.deployed_at))
    ) {
      continue;
    }
    if (row.version_id !== null && typeof row.version_id !== "string") {
      continue;
    }
    rows.push({
      sha: row.sha,
      tree: row.tree ?? null,
      deployed_at: row.deployed_at,
      version_id: row.version_id ?? null,
    });
  }
  return rows;
}

/**
 * @param {{ sha: string, tree: string, deployedAt?: string, versionId?: string | null }} input
 */
export function buildDeployLedgerRow({
  sha,
  tree,
  deployedAt = new Date().toISOString(),
  versionId = null,
}) {
  if (!SHA_PATTERN.test(sha ?? "")) {
    throw new Error("deploy_ledger_sha_invalid");
  }
  if (!SHA_PATTERN.test(tree ?? "")) {
    throw new Error("deploy_ledger_tree_invalid");
  }
  if (!Number.isFinite(Date.parse(deployedAt))) {
    throw new Error("deploy_ledger_deployed_at_invalid");
  }
  if (versionId !== null && !SAFE_VERSION_PATTERN.test(versionId)) {
    throw new Error("deploy_ledger_version_id_invalid");
  }
  return { sha, tree, deployed_at: deployedAt, version_id: versionId };
}

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const command = process.argv[2];
  if (command === "row") {
    const sha = readArg("--sha") ?? process.env.PINNED_SHA ?? "";
    const tree =
      readArg("--tree") ??
      process.env.LEDGER_TREE ??
      execFileSync("git", ["rev-parse", "--verify", `${sha}^{tree}`], {
        encoding: "utf8",
      }).trim();
    const versionId =
      readArg("--version-id") ?? process.env.LEDGER_VERSION_ID ?? null;
    const row = buildDeployLedgerRow({
      sha,
      tree,
      deployedAt: readArg("--at") ?? new Date().toISOString(),
      versionId: versionId || null,
    });
    process.stdout.write(`${JSON.stringify(row)}\n`);
    return 0;
  }
  if (command === "version-id") {
    const path = readArg("--wrangler-output") ?? process.argv[3];
    if (!path) throw new Error("deploy_ledger_arguments_missing");
    try {
      process.stdout.write(
        `${readDeployedWorkerVersionId(readFileSync(resolve(path), "utf8"))}\n`,
      );
    } catch {
      // A missing or unparsable wrangler output must not block the ledger
      // row: sha+tree is what the anchor chain needs; version_id is
      // informational. Emit empty so the caller records null.
      process.stdout.write("\n");
    }
    return 0;
  }
  throw new Error("deploy_ledger_arguments_missing");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main() ?? 0;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "deploy_ledger_failed"}\n`,
    );
    process.exitCode = 2;
  }
}
