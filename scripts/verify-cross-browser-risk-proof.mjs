#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINGERPRINT_PATTERN,
  MANIFEST_SCHEMA_VERSION,
  resolveOutputPath,
  validateReleaseArtifacts,
  validateReleaseCoverage,
} from "./playwright-release-manifest-reporter.mjs";
import { validateArtifactFiles } from "./verify-deploy-readiness.mjs";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

/** @type {Readonly<Record<string, readonly number[]>>} */
export const REQUIRED_CROSS_BROWSER_RISK_SCOPES = Object.freeze({
  "local-release-firefox": Object.freeze([5]),
  "local-release-webkit": Object.freeze([1, 2, 5]),
  "local-release-mobile-safari": Object.freeze([1]),
  "local-release-mobile-chrome": Object.freeze([1]),
});

export const CROSS_BROWSER_MANIFEST_PATHS = Object.freeze(
  Object.fromEntries(Object.keys(REQUIRED_CROSS_BROWSER_RISK_SCOPES).map((project) => [
    project,
    `test-results/deploy-readiness-${project}.json`,
  ])),
);

/** @param {string[]} argv */
function parseArgs(argv) {
  let base = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base" && argv[index + 1]) {
      if (base !== null) throw new Error("invalid_cross_browser_proof_arguments");
      base = argv[++index];
      continue;
    }
    throw new Error("invalid_cross_browser_proof_arguments");
  }
  if (!base) throw new Error("missing_cross_browser_proof_base");
  return { base };
}

/** @param {string} root @param {string} base */
function currentCandidate(root, base) {
  let output = "";
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

/**
 * @param {{ manifest: any; project: string; journeys: readonly number[]; candidate: any; root?: string; validateFiles?: boolean }} input
 */
export function validateCrossBrowserRiskManifest({
  manifest,
  project,
  journeys,
  candidate,
  root = process.cwd(),
  validateFiles = true,
}) {
  const issues = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, issues: ["manifest_invalid"] };
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) issues.push("manifest_schema");
  if (manifest.status !== "passed" || manifest.strict !== true) issues.push("manifest_not_strict_pass");
  if (Array.isArray(manifest.strictIssues) && manifest.strictIssues.length > 0) issues.push("manifest_strict_issues");
  if (!FINGERPRINT_PATTERN.test(manifest.candidateFingerprint ?? "")) issues.push("manifest_fingerprint");
  if (manifest.environment !== "local") issues.push("manifest_environment");
  if (!candidate?.ok || candidate?.status?.hasChanges !== false) issues.push("candidate_not_clean");
  if (candidate?.baseCommit !== candidate?.headCommit) issues.push("candidate_base_not_head");
  if (manifest.candidateFingerprint !== candidate?.fingerprint) issues.push("candidate_fingerprint_mismatch");

  issues.push(...validateReleaseCoverage(manifest.entries, [...journeys]));
  issues.push(...validateReleaseArtifacts(Array.isArray(manifest.entries) ? manifest.entries : []));
  for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
    if (
      entry.project !== project ||
      entry.status !== "passed" ||
      entry.retry !== 0 ||
      entry.firstAttempt?.status !== "passed" ||
      entry.firstAttempt?.passed !== true ||
      entry.firstAttempt?.retry !== 0
    ) issues.push("entry_project_or_first_attempt");
  }

  const postflight = manifest.postflight;
  if (
    !postflight ||
    JSON.stringify(postflight.journeys) !== JSON.stringify([...journeys]) ||
    postflight.isolatedPersistenceRemoved !== true
  ) issues.push("postflight_scope_or_cleanup");
  const config = postflight?.launchConfig;
  if (
    !SHA256_HEX.test(config?.identity ?? "") ||
    !SHA256_HEX.test(config?.wranglerWorktreeSha256 ?? "") ||
    config?.wranglerWorktreeSha256 !== candidate?.wrangler?.worktreeSha256 ||
    config?.productionSearchRolloutMode !== "v2" ||
    config?.localProofSearchRolloutMode !== "v2" ||
    config?.providerNetworkDeny !== true ||
    config?.authProvider !== "better-auth" ||
    config?.browserProject !== project ||
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
  if (validateFiles && Array.isArray(manifest.entries)) issues.push(...validateArtifactFiles(manifest, root));

  const uniqueIssues = [...new Set(issues)].sort();
  return { ok: uniqueIssues.length === 0, issues: uniqueIssues };
}

/** @param {{ manifests: Record<string, any>; candidate: any; root?: string; validateFiles?: boolean }} input */
export function validateCrossBrowserRiskProof({ manifests, candidate, root = process.cwd(), validateFiles = true }) {
  const issues = [];
  for (const [project, journeys] of Object.entries(REQUIRED_CROSS_BROWSER_RISK_SCOPES)) {
    const verdict = validateCrossBrowserRiskManifest({
      manifest: manifests?.[project],
      project,
      journeys,
      candidate,
      root,
      validateFiles,
    });
    issues.push(...verdict.issues.map((issue) => `${project}:${issue}`));
  }
  return { ok: issues.length === 0, issues };
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const { base } = parseArgs(process.argv.slice(2));
  const candidate = currentCandidate(root, base);
  /** @type {Record<string, any>} */
  const manifests = {};
  for (const [project, path] of Object.entries(CROSS_BROWSER_MANIFEST_PATHS)) {
    try {
      manifests[project] = JSON.parse(readFileSync(resolveOutputPath({ outputPath: path }), "utf8"));
    } catch {
      manifests[project] = null;
    }
  }
  const verdict = validateCrossBrowserRiskProof({ manifests, candidate, root });
  process.stdout.write(`${JSON.stringify({
    ok: verdict.ok,
    candidateFingerprint: verdict.ok ? candidate.fingerprint : null,
    issues: verdict.issues,
  })}\n`);
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      candidateFingerprint: null,
      issues: [error instanceof Error ? error.message : "cross_browser_proof_unavailable"],
    })}\n`);
    process.exitCode = 1;
  }
}
