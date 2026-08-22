#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const DOMAIN = "0509-customer-readiness-candidate:v1";
const SOURCE_TREE_DOMAIN = "0509-customer-readiness-source-tree:v1";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_COMMIT_SHA = /^[0-9a-f]{40}$/i;
const D1_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function parseArgs(args) {
  const parsed = {
    base: null,
    expectFingerprint: null,
    deployedVersion: null,
    deployedConfigFingerprint: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base" && args[index + 1]) {
      parsed.base = args[++index];
      continue;
    }
    if (arg === "--expect-fingerprint" && args[index + 1]) {
      parsed.expectFingerprint = args[++index];
      continue;
    }
    if (arg === "--deployed-version" && args[index + 1]) {
      parsed.deployedVersion = args[++index];
      continue;
    }
    if (arg === "--deployed-config-fingerprint" && args[index + 1]) {
      parsed.deployedConfigFingerprint = args[++index];
      continue;
    }
    throw new Error("invalid_arguments");
  }

  if (!parsed.base) {
    throw new Error("missing_base");
  }
  if (parsed.expectFingerprint !== null && !SHA256_HEX.test(parsed.expectFingerprint)) {
    throw new Error("invalid_expected_fingerprint");
  }
  if (parsed.deployedConfigFingerprint !== null && !SHA256_HEX.test(parsed.deployedConfigFingerprint)) {
    throw new Error("invalid_deployed_config_fingerprint");
  }
  if (parsed.deployedVersion !== null && !isBoundedId(parsed.deployedVersion)) {
    throw new Error("invalid_deployed_version");
  }

  return parsed;
}

function isBoundedId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value && !(/[\u0000-\u001f\u007f\s]/u.test(value));
}

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: options.encoding ?? "buffer",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
  });
}

function gitText(cwd, args) {
  return git(cwd, args, { encoding: "utf8" }).trim();
}

function optionalGitText(cwd, args, fallback) {
  try {
    return gitText(cwd, args) || fallback;
  } catch {
    return fallback;
  }
}

function frame(hash, label, value) {
  const labelBytes = Buffer.from(label, "utf8");
  const valueBytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeUInt32BE(labelBytes.byteLength, 0);
  length.writeUInt32BE(valueBytes.byteLength, 4);
  hash.update(length);
  hash.update(labelBytes);
  hash.update(valueBytes);
}

function hashFrames(domain, records) {
  const hash = createHash("sha256");
  hash.update(Buffer.from(domain, "utf8"));
  hash.update(Buffer.from([0]));
  for (const [label, value] of records) {
    frame(hash, label, value);
  }
  return hash.digest("hex");
}

function parseStatus(statusBytes) {
  const records = statusBytes.toString("utf8").split("\0").filter(Boolean);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const record of records) {
    if (!/^[ MADRCU?!]{2} /.test(record)) continue;
    const stagedCode = record[0];
    const unstagedCode = record[1];
    if (stagedCode === "?") {
      untracked += 1;
      continue;
    }
    if (stagedCode !== " ") staged += 1;
    if (unstagedCode !== " ") unstaged += 1;
  }
  return { staged, unstaged, untracked };
}

function listUntrackedRegularFiles(cwd) {
  const output = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = splitNul(output).sort(Buffer.compare);
  const files = [];
  for (const relativePath of paths) {
    const absolutePath = resolve(cwd, relativePath.toString("utf8"));
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch {
      throw new Error("untracked_entry_unavailable");
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("untracked_entry_not_regular");
    }
    files.push({ path: relativePath, bytes: readFileSync(absolutePath) });
  }
  return files;
}

function listSourceFiles(cwd, untrackedFiles) {
  const trackedPaths = splitNul(git(cwd, ["ls-files", "-z"]));
  const untrackedPathKeys = new Set(untrackedFiles.map((file) => file.path.toString("hex")));
  const paths = [...trackedPaths, ...untrackedFiles.map((file) => file.path)].sort(Buffer.compare);
  const files = [];
  for (const relativePath of paths) {
    const isUntracked = untrackedPathKeys.has(relativePath.toString("hex"));
    const absolutePath = resolve(cwd, relativePath.toString("utf8"));
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch {
      if (!isUntracked) continue;
      throw new Error("source_entry_unavailable");
    }
    if (stats.isSymbolicLink()) {
      if (isUntracked) throw new Error("untracked_entry_not_regular");
      files.push({
        path: relativePath,
        kind: "symlink",
        executable: false,
        bytes: Buffer.from(readlinkSync(absolutePath), "utf8"),
      });
      continue;
    }
    if (!stats.isFile()) throw new Error("source_entry_not_regular");
    files.push({
      path: relativePath,
      kind: "file",
      executable: (stats.mode & 0o111) !== 0,
      bytes: readFileSync(absolutePath),
    });
  }
  return files;
}

function splitNul(bytes) {
  const values = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 0) continue;
    if (index > start) values.push(bytes.subarray(start, index));
    start = index + 1;
  }
  return values;
}

function stripJsoncComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        output += character;
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        output += "  ";
        index += 1;
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (!inString && character === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index += 1;
      continue;
    }
    if (!inString && character === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index += 1;
      continue;
    }
    output += character;
    if (character === '"' && !escaped) inString = !inString;
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function readCommittedWrangler(cwd, head) {
  const bytes = git(cwd, ["show", `${head}:wrangler.jsonc`]);
  return readWranglerBytes(bytes);
}

function readWorktreeWrangler(cwd) {
  let bytes;
  try {
    bytes = readFileSync(resolve(cwd, "wrangler.jsonc"));
  } catch {
    throw new Error("wrangler_config_unavailable");
  }
  return readWranglerBytes(bytes);
}

function readWranglerBytes(bytes) {
  let config;
  try {
    config = JSON.parse(stripJsoncComments(bytes.toString("utf8")));
  } catch {
    throw new Error("wrangler_config_invalid");
  }
  const d1Matches = Array.isArray(config?.d1_databases)
    ? config.d1_databases.filter(
        (database) =>
          database?.binding === "DB" &&
          database?.database_name === "0509" &&
          D1_UUID.test(database?.database_id ?? ""),
      )
    : [];
  return {
    bytes,
    mode: config?.vars?.SEARCH_ROLLOUT_MODE,
    d1Database:
      d1Matches.length === 1
        ? {
            binding: d1Matches[0].binding,
            name: d1Matches[0].database_name,
            uuid: d1Matches[0].database_id,
          }
        : null,
  };
}

function hashSourceTree(sourceFiles) {
  const records = [];
  for (const file of sourceFiles) {
    records.push(
      ["path", file.path],
      ["kind", file.kind],
      ["executable", file.executable ? "1" : "0"],
      ["bytes", file.bytes],
    );
  }
  return hashFrames(SOURCE_TREE_DOMAIN, records);
}

function hashUntracked(untrackedFiles) {
  const records = [];
  for (const file of untrackedFiles) {
    records.push(["path", file.path], ["bytes", file.bytes]);
  }
  return hashFrames(`${DOMAIN}:untracked`, records);
}

function hashValue(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeRolloutMode(mode) {
  return mode === "v2" ? "v2" : "non_v2_or_missing";
}

function resolveCandidateBranch(cwd, head) {
  const symbolicBranch = optionalGitText(
    cwd,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    null,
  );
  if (symbolicBranch !== null) return symbolicBranch;

  const remoteMain = optionalGitText(
    cwd,
    [
      "rev-parse",
      "--verify",
      "--end-of-options",
      "refs/remotes/origin/main^{commit}",
    ],
    null,
  );
  return remoteMain === head ? "main" : "detached";
}

function parseGitHubOriginSlug(cwd) {
  const originUrl = optionalGitText(cwd, ["remote", "get-url", "origin"], "");
  const match = originUrl.match(
    /^(?:https?:\/\/|ssh:\/\/)?(?:git@)?github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  );
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

// Second protected-main identity proof for detached checkouts (the shape
// every actions/checkout of a pinned SHA produces): ask the provider whether
// this exact commit is contained in the remote's refs/heads/main. The local
// equality fast path in resolveCandidateBranch cannot decide this on a
// runner, where refs/remotes/origin/main is only refreshed by unrelated
// workflows sharing the workspace and the deploy checkout deliberately does
// not fetch. The verdict comes from the provider response - never from an
// environment variable; GITHUB_TOKEN only authenticates the request.
async function providerMainContainsHead(cwd, head) {
  const slug = parseGitHubOriginSlug(cwd);
  if (!slug || !GIT_COMMIT_SHA.test(head)) {
    return { proved: false, reason: "provider_slug_unavailable" };
  }
  const apiBase = (
    process.env.GITHUB_API_URL || "https://api.github.com"
  ).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiBase)) {
    return { proved: false, reason: "provider_api_base_invalid" };
  }
  const headers = { accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  let payload;
  try {
    response = await fetch(`${apiBase}/repos/${slug}/compare/${head}...main`, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { proved: false, reason: "provider_compare_unavailable" };
  }
  if (!response.ok) {
    return {
      proved: false,
      reason: `provider_compare_http_${response.status}`,
    };
  }
  try {
    payload = await response.json();
  } catch {
    return { proved: false, reason: "provider_compare_unavailable" };
  }
  const status = typeof payload?.status === "string" ? payload.status : "";
  const baseCommit =
    typeof payload?.base_commit?.sha === "string"
      ? payload.base_commit.sha.toLowerCase()
      : "";
  if ((status === "ahead" || status === "identical") && baseCommit === head.toLowerCase()) {
    return {
      proved: true,
      source: "provider_compare",
      repository: slug,
      status,
    };
  }
  return {
    proved: false,
    reason: `provider_compare_${status || "invalid"}`,
    ...(status ? { status } : {}),
  };
}

async function createReport(cwd, args) {
  const head = gitText(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const base = gitText(cwd, ["rev-parse", "--verify", "--end-of-options", `${args.base}^{commit}`]);
  let branch = resolveCandidateBranch(cwd, head);
  let branchProof = null;
  if (branch === "detached") {
    const proof = await providerMainContainsHead(cwd, head);
    branchProof = proof;
    if (proof.proved) branch = "main";
  }
  const trackedDiff = git(cwd, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", base, "--"]);
  const trackedFiles = splitNul(git(cwd, ["diff", "--name-only", "-z", "--no-renames", base, "--"]));
  const status = parseStatus(git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  const untrackedFiles = listUntrackedRegularFiles(cwd);
  const sourceFiles = listSourceFiles(cwd, untrackedFiles);
  const committedWrangler = readCommittedWrangler(cwd, head);
  const worktreeWrangler = readWorktreeWrangler(cwd);
  const trackedDiffHash = createHash("sha256").update(trackedDiff).digest("hex");
  const candidateFingerprint = hashSourceTree(sourceFiles);
  const sourceBytes = sourceFiles.reduce((total, file) => total + file.bytes.byteLength, 0);
  const untrackedBytes = untrackedFiles.reduce((total, file) => total + file.bytes.byteLength, 0);
  const fingerprintMatchesExpected = args.expectFingerprint === null || args.expectFingerprint === candidateFingerprint;
  const deployedEvidenceProvided = args.deployedVersion !== null || args.deployedConfigFingerprint !== null;
  const deployedIdentity = {
    classification:
      args.deployedVersion !== null && args.deployedConfigFingerprint !== null
        ? "explicit_evidence"
        : "external_proof_required",
    versionProvided: args.deployedVersion !== null,
    configFingerprintProvided: args.deployedConfigFingerprint !== null,
    versionHash: args.deployedVersion === null ? null : hashValue(args.deployedVersion),
    configFingerprint: args.deployedConfigFingerprint,
  };
  const committedModeIsV2 = committedWrangler.mode === "v2";
  const worktreeModeIsV2 = worktreeWrangler.mode === "v2";
  const blockers = [];
  if (!committedModeIsV2 || !worktreeModeIsV2) blockers.push("search_rollout_mode_not_v2");
  if (!fingerprintMatchesExpected) blockers.push("candidate_fingerprint_mismatch");
  return {
    ok: blockers.length === 0,
    blockers,
    baseCommit: base,
    headCommit: head,
    branch,
    branchProof,
    fingerprint: candidateFingerprint,
    expectedFingerprint: args.expectFingerprint,
    fingerprintMatchesExpected,
    sourceTree: {
      files: sourceFiles.length,
      bytes: sourceBytes,
      sha256: candidateFingerprint,
    },
    trackedDiff: {
      filesChanged: trackedFiles.length,
      bytes: trackedDiff.byteLength,
      sha256: trackedDiffHash,
    },
    untracked: {
      count: untrackedFiles.length,
      bytes: untrackedBytes,
      sha256: hashUntracked(untrackedFiles),
    },
    status: {
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked,
      stagedExists: status.staged > 0,
      unstagedExists: status.unstaged > 0,
      untrackedExists: status.untracked > 0,
      hasChanges: status.staged > 0 || status.unstaged > 0 || status.untracked > 0,
    },
    wrangler: {
      searchRolloutMode: safeRolloutMode(committedWrangler.mode),
      searchRolloutModeSha256: typeof committedWrangler.mode === "string" ? hashValue(committedWrangler.mode) : null,
      sha256: createHash("sha256").update(committedWrangler.bytes).digest("hex"),
      worktreeSearchRolloutMode: safeRolloutMode(worktreeWrangler.mode),
      worktreeSearchRolloutModeSha256:
        typeof worktreeWrangler.mode === "string" ? hashValue(worktreeWrangler.mode) : null,
      worktreeSha256: createHash("sha256").update(worktreeWrangler.bytes).digest("hex"),
      d1Database: committedWrangler.d1Database,
      worktreeD1Database: worktreeWrangler.d1Database,
    },
    deployedIdentity: {
      ...deployedIdentity,
      evidenceProvided: deployedEvidenceProvided,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const report = await createReport(cwd, args);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

try {
  await main();
} catch {
  process.stdout.write(`${JSON.stringify({ ok: false, blockers: ["candidate_identity_unavailable"] })}\n`);
  process.exitCode = 1;
}
