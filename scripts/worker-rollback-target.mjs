const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

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
