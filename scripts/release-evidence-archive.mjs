#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifactFiles } from "./verify-deploy-readiness.mjs";
import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import { validateWorkerRollbackEvidence } from "./worker-rollback-target.mjs";

const SAFE_ARCHIVE = /^test-results\/production-release-evidence-[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*\.tar\.gz$/u;
const SAFE_ENTRY = /^test-results\/[A-Za-z0-9._/-]{1,220}$/u;
const ALLOWED_EVIDENCE = [
  /^test-results\/deploy-readiness-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/gate-b-manifest-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/gate-b-artifacts\/[A-Za-z0-9._/-]+$/u,
  /^test-results\/wrangler-deploy-output-[A-Za-z0-9._-]+\.jsonl$/u,
  /^test-results\/worker-rollback-target-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/gate-c-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/production-soak-[A-Za-z0-9._-]+\.json$/u,
];
// The production deploy pipeline writes the gate-B / launch-readiness manifest
// AND the deploy-readiness manifest to a single file:
// `test-results/deploy-readiness-<nonce>.json`. `deploy-production-plan.mjs`
// sets `E2E_RELEASE_MANIFEST_PATH` to that path and passes the same path to
// `gate-c-soak start --manifest`, so the soak journal's `gateBManifestPath`
// points at the deploy-readiness file. There is NO standalone
// `gate-b-manifest-*.json` in a real deploy (that name is only a local-run
// default in run-local-release-proof.mjs when E2E_RELEASE_MANIFEST_PATH is
// unset). Requiring a separate gate-b-manifest file therefore made
// `hasCompleteEvidenceSet` unsatisfiable on the first real run
// (release_evidence_set_incomplete). The gate-B manifest is still fully
// archived — as the required deploy-readiness manifest — and still hash-bound
// via the journal reference check in assertJournalBoundEvidence, so this does
// not weaken the evidence set. `gate-b-manifest-*.json` stays in
// ALLOWED_EVIDENCE (archived if a local run ever emits one) but is not
// required.
const REQUIRED_EVIDENCE = [
  /^test-results\/deploy-readiness-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/gate-b-artifacts\/[A-Za-z0-9._/-]+$/u,
  /^test-results\/wrangler-deploy-output-[A-Za-z0-9._-]+\.jsonl$/u,
  /^test-results\/worker-rollback-target-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/gate-c-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/production-soak-[A-Za-z0-9._-]+\.json$/u,
];

/** @param {string[]} paths */
function hasCompleteEvidenceSet(paths) {
  return REQUIRED_EVIDENCE.every((pattern) => paths.some((path) => pattern.test(path)));
}

/** @param {string} root @param {string} entry */
function sha256Entry(root, entry) {
  return createHash("sha256").update(readFileSync(resolve(root, entry))).digest("hex");
}

/** @param {string[]} paths @param {string} root */
function assertJournalBoundEvidence(paths, root) {
  const journals = paths.filter((path) => /^test-results\/production-soak-[A-Za-z0-9._-]+\.json$/u.test(path));
  if (journals.length !== 1) throw new Error("release_evidence_journal_count_invalid");
  let journal;
  try {
    journal = JSON.parse(readFileSync(resolve(root, journals[0]), "utf8"));
  } catch {
    throw new Error("release_evidence_journal_invalid");
  }
  if (
    !journal || typeof journal !== "object" || Array.isArray(journal) ||
    journal.schemaVersion !== 1 || journal.kind !== "gate-c-exact-worker-scheduled-soak" ||
    !["running", "passed"].includes(journal.status)
  ) throw new Error("release_evidence_journal_invalid");
  const referenced = [
    [journal.candidate?.gateBManifestPath, journal.candidate?.gateBManifestSha256],
    [journal.deployment?.wranglerOutputPath, journal.deployment?.wranglerOutputSha256],
    [journal.deployment?.immediateGateCPath, journal.deployment?.immediateGateCSha256],
    // Rollback evidence is now journal-bound (path + sha256) at write time, so a
    // forged or duplicated worker-rollback-target file fails closed here rather
    // than being trusted on existence alone.
    [journal.deployment?.workerRollbackTargetPath, journal.deployment?.workerRollbackTargetSha256],
  ];
  if (journal.status === "passed") {
    referenced.push([journal.final?.finalGateCPath, journal.final?.finalGateCSha256]);
  }
  for (const [path, expectedHash] of referenced) {
    if (
      typeof path !== "string" || typeof expectedHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(expectedHash)
    ) throw new Error("release_evidence_journal_reference_invalid");
    const entry = assertAllowedEvidencePath(path);
    if (!paths.includes(entry) || sha256Entry(root, entry) !== expectedHash) {
      throw new Error("release_evidence_journal_reference_invalid");
    }
  }
  // Exactly one rollback-target file, and it must be the journal-bound one — a
  // second (or unbound) rollback file is rejected.
  const rollbackFiles = paths.filter((path) => ROLLBACK_TARGET_EVIDENCE.test(path));
  if (
    rollbackFiles.length !== 1 ||
    rollbackFiles[0] !== assertAllowedEvidencePath(journal.deployment.workerRollbackTargetPath)
  ) {
    throw new Error("release_evidence_rollback_target_binding_invalid");
  }
  return journal;
}

const ROLLBACK_TARGET_EVIDENCE = /^test-results\/worker-rollback-target-[A-Za-z0-9._-]+\.json$/u;
const MANIFEST_EVIDENCE = [
  /^test-results\/deploy-readiness-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/gate-b-manifest-[A-Za-z0-9._-]+\.json$/u,
];
const GATE_B_ARTIFACT_EVIDENCE = /^test-results\/gate-b-artifacts\/[A-Za-z0-9._/-]+$/u;

/** @param {string} name @returns {string} archive-membership form (test-results/gate-b-artifacts/...) */
function declaredArtifactEntry(name) {
  const stripped = String(name).replace(/^\.\//u, "").replace(/^test-results\//u, "");
  const entry = assertAllowedEvidencePath(`test-results/${stripped}`);
  if (!GATE_B_ARTIFACT_EVIDENCE.test(entry)) throw new Error("release_evidence_declared_artifact_invalid");
  return entry;
}

/**
 * Deep integrity beyond the journal's hash-bound references:
 *   (a) EVERY manifest in the evidence set (the authoritative deploy-readiness
 *       manifest AND every cross-browser deploy-readiness-<project> / local
 *       gate-b-manifest auxiliary) has its declared Gate-B artifacts validated
 *       by path/bytes/sha256 (validateArtifactFiles). The journal-bound manifest
 *       must be one of them, and the manifest itself is hash-bound to the
 *       journal, closing the chain;
 *   (b) the UNION of every manifest's declared artifacts must EQUAL the archive
 *       membership of gate-b-artifacts files exactly — so no undeclared
 *       (tamperable) artifact rides along, and no declared artifact is omitted
 *       from the archive (which would make it unrestorable); and
 *   (c) the journal-bound worker-rollback-target is validated against the
 *       deployed worker version (validateWorkerRollbackEvidence).
 * @param {any} journal @param {string[]} paths @param {string} root
 */
function assertReleaseArtifactIntegrity(journal, paths, root) {
  const boundManifest = assertAllowedEvidencePath(journal.candidate.gateBManifestPath);
  const manifestEntries = paths.filter((path) => MANIFEST_EVIDENCE.some((pattern) => pattern.test(path)));
  if (!manifestEntries.includes(boundManifest)) {
    throw new Error("release_evidence_bound_manifest_missing");
  }

  const declared = new Set();
  for (const manifestEntry of manifestEntries) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(root, manifestEntry), "utf8"));
    } catch {
      throw new Error("release_evidence_manifest_unreadable");
    }
    if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.entries)) {
      throw new Error("release_evidence_manifest_artifacts_missing");
    }
    if (validateArtifactFiles(manifest, root).length > 0) {
      throw new Error("release_evidence_artifact_integrity");
    }
    for (const artifact of manifest.entries.flatMap((/** @type {any} */ entry) => entry?.artifacts ?? [])) {
      declared.add(declaredArtifactEntry(artifact?.name));
    }
  }

  // Union of declared artifacts must EQUAL the archived gate-b-artifacts set.
  const archived = new Set(paths.filter((path) => GATE_B_ARTIFACT_EVIDENCE.test(path)));
  if (
    declared.size !== archived.size ||
    [...declared].some((entry) => !archived.has(entry)) ||
    [...archived].some((entry) => !declared.has(entry))
  ) {
    throw new Error("release_evidence_artifact_membership_mismatch");
  }

  // Journal-bound rollback target, validated against the deployed worker version.
  const rollbackEntry = assertAllowedEvidencePath(journal.deployment.workerRollbackTargetPath);
  const wranglerEntry = assertAllowedEvidencePath(journal.deployment.wranglerOutputPath);
  let rollbackEvidence;
  let deployedVersionId;
  try {
    rollbackEvidence = JSON.parse(readFileSync(resolve(root, rollbackEntry), "utf8"));
    deployedVersionId = readDeployedWorkerVersionId(readFileSync(resolve(root, wranglerEntry), "utf8"));
  } catch {
    throw new Error("release_evidence_rollback_target_unreadable");
  }
  if (!validateWorkerRollbackEvidence(rollbackEvidence, { deployedVersionId }).ok) {
    throw new Error("release_evidence_rollback_target_integrity");
  }
}

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

/** @param {string} path */
function normalizedEntry(path) {
  return path.replace(/^\.\//u, "").replace(/\/$/u, "");
}

/** @param {string} path */
function assertAllowedEvidencePath(path) {
  const entry = normalizedEntry(path);
  if (
    !SAFE_ENTRY.test(entry) || entry.includes("..") || entry.includes("//") ||
    !ALLOWED_EVIDENCE.some((pattern) => pattern.test(entry)) ||
    entry.includes("d1-remote-restore-evidence")
  ) throw new Error("unsafe_release_evidence_entry");
  return entry;
}

/** @param {string} path */
function assertSafeArchivePath(path) {
  if (typeof path !== "string" || !SAFE_ARCHIVE.test(path) || path.includes("..")) {
    throw new Error("unsafe_release_evidence_archive_path");
  }
  return path;
}

/** @param {string} root @returns {string[]} */
function walkFiles(root) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error("unsafe_release_evidence_symlink");
    if (stats.isDirectory()) files.push(...walkFiles(path));
    else if (stats.isFile()) files.push(path);
    else throw new Error("unsafe_release_evidence_file_type");
  }
  return files;
}

/** @returns {string[]} */
export function discoverReleaseEvidencePaths() {
  const root = resolve("test-results");
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error("release_evidence_root_missing");
  }
  return walkFiles(root)
    .map((path) => relative(process.cwd(), path))
    .filter((path) => ALLOWED_EVIDENCE.some((pattern) => pattern.test(path)))
    .map(assertAllowedEvidencePath)
    .sort();
}

/** @param {{ archivePath: string, evidencePaths: string[] }} input */
export function createReleaseEvidenceArchive({ archivePath, evidencePaths }) {
  const safeArchive = assertSafeArchivePath(archivePath);
  if (existsSync(safeArchive)) throw new Error("release_evidence_archive_exists");
  const paths = [...new Set(evidencePaths.map(assertAllowedEvidencePath))].sort();
  if (paths.length === 0) throw new Error("release_evidence_set_empty");
  if (!hasCompleteEvidenceSet(paths)) {
    throw new Error("release_evidence_set_incomplete");
  }
  for (const path of paths) {
    const stats = lstatSync(resolve(path));
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("unsafe_release_evidence_file");
  }
  const journal = assertJournalBoundEvidence(paths, process.cwd());
  assertReleaseArtifactIntegrity(journal, paths, process.cwd());
  execFileSync("tar", ["-czf", safeArchive, "--", ...paths], { stdio: "pipe" });
  chmodSync(safeArchive, 0o600);
  return { archivePath: safeArchive, entries: paths };
}

/** @param {string} archivePath @returns {string[]} */
function archiveEntries(archivePath) {
  return execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
    .split("\n")
    .map(normalizedEntry)
    .filter(Boolean)
    .map(assertAllowedEvidencePath);
}

/** @param {{ archivePath: string }} input */
export function restoreReleaseEvidenceArchive({ archivePath }) {
  const safeArchive = assertSafeArchivePath(archivePath);
  const archiveStats = lstatSync(resolve(safeArchive));
  if (!archiveStats.isFile() || archiveStats.isSymbolicLink()) {
    throw new Error("unsafe_release_evidence_archive_file");
  }
  const listed = archiveEntries(safeArchive);
  if (listed.length === 0 || new Set(listed).size !== listed.length || !hasCompleteEvidenceSet(listed)) {
    throw new Error("invalid_release_evidence_archive_entries");
  }
  mkdirSync(resolve("test-results"), { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(resolve("test-results", ".release-evidence-restore-"));
  /** @type {string[]} */
  const created = [];
  try {
    execFileSync("tar", ["-xzf", resolve(safeArchive), "-C", temporaryRoot], { stdio: "pipe" });
    const extracted = walkFiles(temporaryRoot)
      .map((path) => assertAllowedEvidencePath(relative(temporaryRoot, path)))
      .sort();
    if (JSON.stringify(extracted) !== JSON.stringify([...listed].sort())) {
      throw new Error("release_evidence_archive_manifest_mismatch");
    }
    const journal = assertJournalBoundEvidence(extracted, temporaryRoot);
    assertReleaseArtifactIntegrity(journal, extracted, temporaryRoot);
    for (const entry of extracted) {
      const source = resolve(temporaryRoot, entry);
      const destination = resolve(entry);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
      chmodSync(destination, 0o600);
      created.push(destination);
    }
    return { archivePath: safeArchive, entries: extracted };
  } catch (error) {
    for (const path of created.reverse()) rmSync(path, { force: true });
    throw error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "create") {
    const archivePath = readArg("--output");
    if (!archivePath) throw new Error("release_evidence_archive_output_missing");
    process.stdout.write(`${JSON.stringify(createReleaseEvidenceArchive({
      archivePath,
      evidencePaths: discoverReleaseEvidencePaths(),
    }))}\n`);
  } else if (command === "restore") {
    const archivePath = readArg("--archive");
    if (!archivePath) throw new Error("release_evidence_archive_input_missing");
    process.stdout.write(`${JSON.stringify(restoreReleaseEvidenceArchive({ archivePath }))}\n`);
  } else {
    throw new Error("release_evidence_archive_command_invalid");
  }
}
