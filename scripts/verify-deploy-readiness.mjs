#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINGERPRINT_PATTERN,
  MANIFEST_SCHEMA_VERSION,
  validateReleaseArtifacts,
  validateReleaseCoverage,
  resolveOutputPath,
} from "./playwright-release-manifest-reporter.mjs";
import { ALL_RELEASE_JOURNEYS } from "../e2e/helpers/release-scope.mjs";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

/** @param {string[]} argv @returns {{ manifest: string; base: string }} */
function parseArgs(argv) {
  /** @type {{ manifest: string | null; base: string | null }} */
  const parsed = { manifest: null, base: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest" && argv[index + 1]) {
      parsed.manifest = argv[++index];
      continue;
    }
    if (argument === "--base" && argv[index + 1]) {
      parsed.base = argv[++index];
      continue;
    }
    throw new Error("invalid_deploy_readiness_arguments");
  }
  if (!parsed.manifest || !parsed.base) throw new Error("missing_deploy_readiness_arguments");
  return { manifest: parsed.manifest, base: parsed.base };
}

/** @param {string} root @param {string} base @returns {any} */
function currentCandidate(root, base) {
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [resolve(root, "scripts/customer-readiness-candidate.mjs"), "--base", base],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (error) {
    output = error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
      ? error.stdout
      : "";
  }
  try {
    return JSON.parse(output.trim());
  } catch {
    return { ok: false, blockers: ["candidate_identity_unavailable"] };
  }
}

/** @param {string} root @param {string} candidate */
function pathInside(root, candidate) {
  const path = resolve(root, candidate);
  const relativePath = relative(root, path);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
    ? path
    : null;
}

/** @param {any} manifest @param {string} root */
export function validateArtifactFiles(manifest, root) {
  const issues = [];
  const testResultsRoot = resolve(root, "test-results");
  let realOutputRoot;
  try {
    realOutputRoot = realpathSync(testResultsRoot);
  } catch {
    return ["artifact_output_root_unavailable"];
  }
  const seen = new Set();
  for (const artifact of manifest.entries.flatMap((/** @type {any} */ entry) => entry.artifacts ?? [])) {
    if (typeof artifact?.name !== "string" || seen.has(artifact.name)) {
      issues.push("artifact_file_duplicate_or_invalid");
      continue;
    }
    seen.add(artifact.name);
    const filePath = pathInside(testResultsRoot, artifact.name.replace(/^test-results\//u, ""));
    if (!filePath) {
      issues.push("artifact_file_path");
      continue;
    }
    try {
      const stat = lstatSync(filePath);
      const realFile = realpathSync(filePath);
      const relativeRealFile = relative(realOutputRoot, realFile);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        relativeRealFile === "" ||
        relativeRealFile === ".." ||
        relativeRealFile.startsWith(`..${sep}`) ||
        isAbsolute(relativeRealFile)
      ) {
        issues.push("artifact_file_type_or_scope");
        continue;
      }
      const body = readFileSync(filePath);
      if (
        body.byteLength !== artifact.bytes ||
        createHash("sha256").update(body).digest("hex") !== artifact.sha256
      ) {
        issues.push("artifact_file_integrity");
      }
    } catch {
      issues.push("artifact_file_unavailable");
    }
  }
  return [...new Set(issues)].sort();
}

/** @param {{ manifest: any; candidate: any; root?: string }} input */
export function validateDeployReadiness({ manifest, candidate, root = process.cwd() }) {
  const issues = [];
  if (!manifest || typeof manifest !== "object") return { ok: false, issues: ["manifest_invalid"] };
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) issues.push("manifest_schema");
  if (manifest.status !== "passed" || manifest.strict !== true) issues.push("manifest_not_strict_pass");
  if (Array.isArray(manifest.strictIssues) && manifest.strictIssues.length > 0) issues.push("manifest_strict_issues");
  if (!FINGERPRINT_PATTERN.test(manifest.candidateFingerprint ?? "")) issues.push("manifest_fingerprint");
  if (manifest.environment !== "local") issues.push("manifest_environment");
  if (!candidate?.ok || candidate?.status?.hasChanges !== false) issues.push("candidate_not_clean");
  if (candidate?.branch !== "main") issues.push("candidate_not_protected_main");
  if (manifest.candidateFingerprint !== candidate?.fingerprint) issues.push("candidate_fingerprint_mismatch");
  if (candidate?.baseCommit !== candidate?.headCommit) issues.push("candidate_base_not_head");

  issues.push(...validateReleaseCoverage(manifest.entries, ALL_RELEASE_JOURNEYS));
  issues.push(...validateReleaseArtifacts(manifest.entries));
  for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
    if (
      entry.status !== "passed" ||
      entry.retry !== 0 ||
      entry.firstAttempt?.status !== "passed" ||
      entry.firstAttempt?.passed !== true ||
      entry.firstAttempt?.retry !== 0
    ) issues.push("entry_not_first_attempt_pass");
  }

  const postflight = manifest.postflight;
  if (
    !postflight ||
    JSON.stringify(postflight.journeys) !== JSON.stringify(ALL_RELEASE_JOURNEYS) ||
    postflight.isolatedPersistenceRemoved !== true
  ) issues.push("postflight_scope_or_cleanup");
  const config = postflight?.launchConfig;
  if (
    !SHA256_HEX.test(config?.identity ?? "") ||
    !SHA256_HEX.test(config?.wranglerWorktreeSha256 ?? "") ||
    config?.wranglerWorktreeSha256 !== candidate?.wrangler?.worktreeSha256 ||
    config?.productionSearchRolloutMode !== "v2" ||
    config?.providerNetworkDeny !== true ||
    config?.browserProject !== "local-release" ||
    config?.retries !== 0 ||
    config?.workers !== 1
  ) issues.push("postflight_config_identity");
  const restore = postflight?.scratchRestore;
  if (
    restore?.integrity !== "ok" ||
    restore?.foreignKeyViolations !== 0 ||
    restore?.exactRowCounts !== true ||
    restore?.dodoLinkagePreserved !== true ||
    restore?.scratchDatabaseRemoved !== true ||
    !SHA256_HEX.test(restore?.sourceDumpSha256 ?? "") ||
    !SHA256_HEX.test(restore?.transformedSqlSha256 ?? "")
  ) issues.push("postflight_restore");
  if (!postflight?.releaseState || !postflight?.fixtureState) issues.push("postflight_state_missing");
  if (Array.isArray(manifest.entries)) issues.push(...validateArtifactFiles(manifest, root));

  return { ok: issues.length === 0, issues: [...new Set(issues)].sort() };
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = resolveOutputPath({ outputPath: args.manifest });
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("deploy_readiness_manifest_unavailable");
  }
  const candidate = currentCandidate(root, args.base);
  const verdict = validateDeployReadiness({ manifest, candidate, root });
  process.stdout.write(`${JSON.stringify({ ok: verdict.ok, candidateFingerprint: verdict.ok ? candidate.fingerprint : null, issues: verdict.issues })}\n`);
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, candidateFingerprint: null, issues: [error instanceof Error ? error.message : "deploy_readiness_unavailable"] })}\n`);
    process.exitCode = 1;
  }
}
