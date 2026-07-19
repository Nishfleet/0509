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
const REQUIRED_EVIDENCE = [
  /^test-results\/deploy-readiness-[A-Za-z0-9._-]+\.json$/u,
  /^test-results\/gate-b-manifest-[A-Za-z0-9._-]+\.json$/u,
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
  assertJournalBoundEvidence(paths, process.cwd());
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
    assertJournalBoundEvidence(extracted, temporaryRoot);
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
