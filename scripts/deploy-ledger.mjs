#!/usr/bin/env node
// deploy-ledger.jsonl — the append-only production deploy record committed on
// main by deploy-production.yml after every successful deploy (0509#2975),
// the anchor chain's last-resort source. Read out of HEAD's own tree, so it
// survives a wiped runs API; each row carries the deployed commit's TREE
// hash so a rewrite-stranded head still resolves to its in-history twin.
// Row schema (one JSON object per line, newest last):
//   {"sha":<40-hex commit>, "tree":<40-hex tree>, "deployed_at":<ISO-8601>,
//    "version_id":<Worker version id or null>}

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";

export const DEPLOY_LEDGER_PATH = "deploy-ledger.jsonl";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/u;

/**
 * Parse ledger text into validated rows, oldest first. Malformed lines are
 * skipped: one corrupt line must not poison every future deploy's anchor.
 * @param {unknown} text
 */
export function parseDeployLedgerRows(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/u)) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !SHA_PATTERN.test(row.sha) ||
      (row.tree !== null && !SHA_PATTERN.test(row.tree ?? "")) ||
      typeof row.deployed_at !== "string" ||
      !Number.isFinite(Date.parse(row.deployed_at)) ||
      (row.version_id !== null && typeof row.version_id !== "string")
    ) {
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

/** @param {{ sha: string, tree: string, deployedAt?: string, versionId?: string | null }} input */
export function buildDeployLedgerRow({
  sha,
  tree,
  deployedAt = new Date().toISOString(),
  versionId = null,
}) {
  if (!SHA_PATTERN.test(sha ?? "")) throw new Error("deploy_ledger_sha_invalid");
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
  if (process.argv[2] !== "row") {
    throw new Error("deploy_ledger_arguments_missing");
  }
  const sha = readArg("--sha") ?? process.env.PINNED_SHA ?? "";
  const tree =
    readArg("--tree") ??
    process.env.LEDGER_TREE ??
    execFileSync("git", ["rev-parse", "--verify", `${sha}^{tree}`], {
      encoding: "utf8",
    }).trim();
  // version_id is informational: an unreadable wrangler output must not
  // block the row — the anchor chain only needs sha+tree.
  let versionId =
    readArg("--version-id") ?? process.env.LEDGER_VERSION_ID ?? null;
  const wranglerOut =
    readArg("--wrangler-output") ?? process.env.LEDGER_WRANGLER_OUTPUT;
  if (!versionId && wranglerOut) {
    try {
      versionId = readDeployedWorkerVersionId(
        readFileSync(resolve(wranglerOut), "utf8"),
      );
    } catch {
      versionId = null;
    }
  }
  const row = buildDeployLedgerRow({
    sha,
    tree,
    deployedAt: readArg("--at") ?? new Date().toISOString(),
    versionId,
  });
  process.stdout.write(`${JSON.stringify(row)}\n`);
  return 0;
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
