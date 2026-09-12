const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

import { parseDeployLedgerRows } from "./deploy-ledger.mjs";

/** @param {unknown} input */
export function parseWorkerDeploymentStatus(input) {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("worker_deployment_status_invalid_json");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("worker_deployment_status_invalid");
  }
  const status = /** @type {Record<string, unknown>} */ (value);
  const deploymentId = typeof status.id === "string" ? status.id.trim() : "";
  const versions = Array.isArray(status.versions) ? status.versions : [];
  if (!SAFE_IDENTIFIER_PATTERN.test(deploymentId) || versions.length !== 1) {
    throw new Error("worker_rollback_target_ambiguous");
  }
  const version = versions[0];
  if (!version || typeof version !== "object" || Array.isArray(version)) {
    throw new Error("worker_rollback_target_ambiguous");
  }
  const versionRecord = /** @type {Record<string, unknown>} */ (version);
  const versionId = typeof versionRecord.version_id === "string"
    ? versionRecord.version_id.trim()
    : "";
  if (!SAFE_IDENTIFIER_PATTERN.test(versionId) || Number(versionRecord.percentage) !== 100) {
    throw new Error("worker_rollback_target_ambiguous");
  }
  return { deploymentId, versionId, percentage: 100 };
}

/** @param {unknown} evidence @param {{ deployedVersionId?: string }} [expected] */
export function validateWorkerRollbackEvidence(evidence, expected = {}) {
  const issues = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { ok: false, issues: ["worker_rollback_evidence_missing"] };
  }
  const value = /** @type {Record<string, unknown>} */ (evidence);
  if (value.schemaVersion !== 1) issues.push("worker_rollback_evidence_schema");
  if (!SAFE_IDENTIFIER_PATTERN.test(typeof value.deploymentId === "string" ? value.deploymentId : "")) {
    issues.push("worker_rollback_deployment_id");
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(typeof value.versionId === "string" ? value.versionId : "")) {
    issues.push("worker_rollback_version_id");
  }
  if (value.percentage !== 100) issues.push("worker_rollback_not_stable");
  const capturedAt = typeof value.capturedAt === "string" ? Date.parse(value.capturedAt) : Number.NaN;
  if (!Number.isFinite(capturedAt)) issues.push("worker_rollback_captured_at");
  if (value.source !== "wrangler deployments status --json") issues.push("worker_rollback_source");
  if (expected.deployedVersionId && value.versionId === expected.deployedVersionId) {
    issues.push("worker_rollback_target_matches_new_version");
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Last GREEN deployed Worker version from the on-main deploy ledger
 * (deploy-ledger.jsonl, one JSONL row {sha, tree, deployed_at, version_id}
 * appended by scripts/commit-deploy-ledger.sh after every SUCCESSFUL deploy).
 *
 * The rollback must target a version that provably ran green, not the
 * pre-deploy 100% capture: run 34679399412 (2026-09-12) rolled back to
 * evidence version aa2fefb2 — the 100% deployment 30 seconds earlier — and
 * Cloudflare answered `Version not found`, leaving the fresh (failing) Worker
 * live with no rollback (issue #3190). The ledger's newest row that carries a
 * usable version_id is the last GREEN version; `null` means "the ledger
 * yields no target" and the caller keeps the captured evidence target.
 * @param {string | null | undefined} contents raw deploy-ledger.jsonl contents
 * @returns {string | null}
 */
export function readLastGreenLedgerVersionId(contents) {
  if (typeof contents !== "string") return null;
  // Reuse the ledger's own row parser (scripts/deploy-ledger.mjs): it already
  // validates the {sha, tree, deployed_at, version_id} schema and skips junk
  // lines, so this module adds only the rollback-target decision — the
  // newest row that carries a SAFE-identifier version_id.
  const rows = parseDeployLedgerRows(contents);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const versionId = rows[index].version_id;
    if (typeof versionId === "string" && SAFE_IDENTIFIER_PATTERN.test(versionId)) {
      return versionId;
    }
  }
  return null;
}

/** @param {string} versionId @param {string | null | undefined} [deployedVersionId] */
export function buildWorkerRollbackCommand(versionId, deployedVersionId) {
  if (!SAFE_IDENTIFIER_PATTERN.test(versionId)) {
    throw new Error("worker_rollback_version_invalid");
  }
  const deployedVersionKnown = deployedVersionId !== null && deployedVersionId !== undefined;
  if (deployedVersionKnown && !SAFE_IDENTIFIER_PATTERN.test(deployedVersionId)) {
    throw new Error("worker_rollback_version_invalid");
  }
  if (deployedVersionKnown && versionId === deployedVersionId) {
    throw new Error("worker_rollback_target_matches_new_version");
  }
  return {
    command: "wrangler",
    args: [
      "rollback",
      versionId,
      "--name",
      "0509",
      "--message",
      deployedVersionKnown
        ? `rollback failed release ${deployedVersionId}`
        : "rollback ambiguous deploy attempt",
      "--yes",
    ],
  };
}

/**
 * 2026-09-12: the recorded pre-deploy version can be EVICTED from Cloudflare's
 * version history before a rollback runs (run 34679399412: "Version not found:
 * aa2fefb2" — 99 of the worker's last 100 versions were preview-assert uploads).
 * Choose a target that exists: the wanted version if listed, else the newest
 * real deploy (not a preview upload, not the version being rolled back).
 * @param {Array<{ id?: string, metadata?: { created_on?: string }, annotations?: Record<string, unknown> }>} versions
 * @param {string} wantedVersionId
 * @param {string | null | undefined} deployedVersionId
 */
export function chooseExistingRollbackTarget(versions, wantedVersionId, deployedVersionId) {
  if (!Array.isArray(versions)) throw new Error("worker_versions_list_invalid");
  const ids = versions.map((v) => (v && typeof v.id === "string" ? v.id : null));
  if (ids.includes(wantedVersionId)) return { versionId: wantedVersionId, reason: "recorded_target_present" };
  const candidates = versions
    .filter((v) => v && typeof v.id === "string" && SAFE_IDENTIFIER_PATTERN.test(v.id))
    .filter((v) => v.id !== deployedVersionId)
    .filter((v) => !String(v.annotations?.["workers/message"] ?? "").startsWith("preview-assert"))
    .sort((a, b) => String(b.metadata?.created_on ?? "").localeCompare(String(a.metadata?.created_on ?? "")));
  if (candidates.length === 0) throw new Error("worker_rollback_target_missing");
  return { versionId: candidates[0].id, reason: "recorded_target_evicted_newest_real_deploy" };
}
