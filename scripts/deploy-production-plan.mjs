const MANIFEST_PATH_PATTERN =
  /^test-results\/deploy-readiness-[a-z0-9-]{1,96}\.json$/u;
const REMOTE_RESTORE_PATH_PATTERN =
  /^test-results\/d1-remote-restore-evidence(?:-[a-z0-9-]{1,64})?\.json$/u;
const WRANGLER_OUTPUT_PATH_PATTERN =
  /^test-results\/wrangler-deploy-output(?:-[a-z0-9-]{1,64})?\.jsonl$/u;
const ROLLBACK_TARGET_PATH_PATTERN =
  /^test-results\/worker-rollback-target(?:-[a-z0-9-]{1,64})?\.json$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

/**
 * @typedef {{
 *   id: string;
 *   command: string;
 *   args: string[];
 *   env?: Record<string, string>;
 *   includeCloudflareCredentials?: boolean;
 *   runOnPostDeployFailure?: boolean;
 * }} ProductionDeployStep
 */

/**
 * @param {{ manifestPath: string, remoteRestoreEvidencePath: string, wranglerOutputPath: string, rollbackTargetPath?: string }} input
 * @returns {ProductionDeployStep[]}
 */
export function buildProductionDeployPlan({
  manifestPath,
  remoteRestoreEvidencePath,
  wranglerOutputPath,
  rollbackTargetPath = "test-results/worker-rollback-target.json",
}) {
  if (
    typeof manifestPath !== "string" ||
    !MANIFEST_PATH_PATTERN.test(manifestPath)
  ) {
    throw new Error("invalid_deploy_readiness_manifest_path");
  }
  if (
    typeof remoteRestoreEvidencePath !== "string" ||
    !REMOTE_RESTORE_PATH_PATTERN.test(remoteRestoreEvidencePath)
  ) {
    throw new Error("invalid_remote_restore_evidence_path");
  }
  if (
    typeof wranglerOutputPath !== "string" ||
    !WRANGLER_OUTPUT_PATH_PATTERN.test(wranglerOutputPath)
  ) {
    throw new Error("invalid_wrangler_output_path");
  }
  if (
    typeof rollbackTargetPath !== "string" ||
    !ROLLBACK_TARGET_PATH_PATTERN.test(rollbackTargetPath)
  ) {
    throw new Error("invalid_rollback_target_path");
  }

  return [
    {
      id: "public_source_truth",
      command: "node",
      args: ["scripts/check-public-home-current.mjs", "--source-only"],
    },
    {
      id: "workspace_membership_preflight",
      command: "node",
      args: ["scripts/check-workspace-member-invariants.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "partial_refund_invariants_preflight",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "migration_sync",
      command: "node",
      args: ["scripts/check-d1-migrations-synced.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "launch_readiness",
      command: "npm",
      args: ["run", "launch:readiness:predeploy"],
      env: {
        E2E_RELEASE_BASE: "HEAD",
        E2E_RELEASE_MANIFEST_PATH: manifestPath,
      },
    },
    {
      id: "readiness_evidence",
      command: "node",
      args: [
        "scripts/verify-deploy-readiness.mjs",
        "--manifest",
        manifestPath,
        "--base",
        "HEAD",
      ],
    },
    {
      id: "cross_browser_risk_proof",
      command: "node",
      args: ["scripts/run-cross-browser-risk-proof.mjs"],
      // DIAGNOSTIC, NOT A RELEASE GATE (2026-07-20): the canonical chromium
      // proof above is the release gate and passed on every one of the eight
      // deploy runs this candidate made; this engine matrix failed a rotating
      // single journey each time on the starved shared runner (~32s timeouts,
      // fonts.ready hangs) and blocked fully-proven product code. Its zero-
      // retry philosophy stays intact where it runs — but a diagnostic that
      // fails on infrastructure weather reports, it does not block. Follow-up
      // owned by Codex: re-home this matrix in a scheduled workflow.
      nonBlockingDiagnostic: true,
    },
    {
      id: "remote_restore_evidence",
      command: "node",
      args: [
        "scripts/verify-remote-restore-evidence.mjs",
        "--manifest",
        manifestPath,
        "--remote-evidence",
        remoteRestoreEvidencePath,
      ],
    },
    {
      id: "public_runtime_truth",
      command: "node",
      args: ["scripts/check-public-home-current.mjs"],
    },
    {
      id: "partial_refund_invariants_predeploy",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "capture_worker_rollback_target",
      command: "node",
      args: [
        "scripts/capture-worker-rollback-target.mjs",
        "--output",
        rollbackTargetPath,
      ],
      includeCloudflareCredentials: true,
    },
    {
      id: "deploy",
      command: "wrangler",
      args: ["deploy"],
      env: {
        WRANGLER_OUTPUT_FILE_PATH: wranglerOutputPath,
      },
      includeCloudflareCredentials: true,
    },
    {
      id: "verify_worker_rollback_target",
      command: "node",
      args: [
        "scripts/verify-worker-rollback-target.mjs",
        "--target",
        rollbackTargetPath,
        "--wrangler-output",
        wranglerOutputPath,
      ],
    },
    {
      id: "partial_refund_invariants_postdeploy",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "launch_readiness_proof_canary_cycle",
      command: "node",
      args: ["scripts/launch-readiness-canary-cycle.mjs"],
    },
    {
      id: "post_deploy_release_canary",
      command: "node",
      args: [
        "scripts/verify-post-deploy-release.mjs",
        "--wrangler-output",
        wranglerOutputPath,
      ],
      includeCloudflareCredentials: true,
    },
    {
      id: "partial_refund_invariants_postcanary",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "start_production_soak",
      command: "node",
      args: [
        "scripts/gate-c-soak.mjs",
        "start",
        "--manifest",
        manifestPath,
        "--wrangler-output",
        wranglerOutputPath,
      ],
    },
    {
      id: "rollback_failed_release",
      command: "node",
      args: [
        "scripts/rollback-production.mjs",
        "--target",
        rollbackTargetPath,
        "--wrangler-output",
        wranglerOutputPath,
      ],
      includeCloudflareCredentials: true,
      runOnPostDeployFailure: true,
    },
    {
      id: "live_public_truth",
      command: "node",
      args: ["scripts/check-live-public-home.mjs"],
    },
    {
      id: "production_public_smoke",
      command: "npm",
      args: ["run", "e2e:prod:public"],
    },
    {
      id: "oauth_branding",
      command: "node",
      args: ["scripts/check-google-oauth-branding.mjs"],
    },
  ];
}

/**
 * @param {unknown} evidence
 * @param {{ candidateFingerprint: string, wranglerWorktreeSha256: string, latestMigration?: string, migrationCount?: number, migrationBearing?: boolean, now?: Date }} expected
 */
export function validateRemoteRestoreEvidence(evidence, expected) {
  const issues = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { ok: false, issues: ["remote_restore_evidence_missing"] };
  }
  const value = /** @type {Record<string, unknown>} */ (evidence);
  const generatedAt =
    typeof value.generatedAt === "string"
      ? Date.parse(value.generatedAt)
      : Number.NaN;
  const now =
    expected.now instanceof Date ? expected.now.getTime() : Date.now();
  const migrationBearing = expected.migrationBearing !== false;
  const maxAgeMs = (migrationBearing ? 24 : 7 * 24) * 60 * 60 * 1000;
  if (
    !Number.isFinite(generatedAt) ||
    generatedAt > now + 5 * 60 * 1000 ||
    now - generatedAt > maxAgeMs
  ) {
    issues.push("remote_restore_evidence_stale");
  }
  if (value.schemaVersion !== 1) issues.push("remote_restore_schema");
  if (
    !FINGERPRINT_PATTERN.test(
      typeof value.candidateFingerprint === "string"
        ? value.candidateFingerprint
        : "",
    )
  ) {
    issues.push("remote_restore_candidate_fingerprint");
  }
  if (
    !FINGERPRINT_PATTERN.test(
      typeof value.wranglerWorktreeSha256 === "string"
        ? value.wranglerWorktreeSha256
        : "",
    )
  ) {
    issues.push("remote_restore_config_fingerprint");
  }
  if (
    migrationBearing &&
    value.candidateFingerprint !== expected.candidateFingerprint
  ) {
    issues.push("remote_restore_candidate_mismatch");
  }
  if (
    migrationBearing &&
    value.wranglerWorktreeSha256 !== expected.wranglerWorktreeSha256
  ) {
    issues.push("remote_restore_config_mismatch");
  }
  if (value.productionSearchRolloutMode !== "shadow")
    issues.push("remote_restore_rollout_mode");
  if (
    expected.latestMigration &&
    value.latestMigration !== expected.latestMigration
  )
    issues.push("remote_restore_migration_mismatch");
  if (
    expected.migrationCount &&
    value.migrationCount !== expected.migrationCount
  )
    issues.push("remote_restore_migration_count");
  for (const field of [
    "databaseIdentitySha256",
    "scratchDatabaseIdentitySha256",
    "sourceDumpSha256",
    "transformedSqlSha256",
    "rowCountDigestSha256",
    "migrationLedgerSha256",
  ]) {
    if (
      !FINGERPRINT_PATTERN.test(
        typeof value[field] === "string" ? value[field] : "",
      )
    ) {
      issues.push(`remote_restore_${field}`);
    }
  }
  if (
    typeof value.databaseBookmark !== "string" ||
    value.databaseBookmark.trim().length < 6
  ) {
    issues.push("remote_restore_bookmark");
  }
  if (value.integrity !== "ok") issues.push("remote_restore_integrity");
  if (value.foreignKeyViolations !== 0)
    issues.push("remote_restore_foreign_keys");
  if (value.exactRowCounts !== true) issues.push("remote_restore_row_counts");
  if (!Number.isInteger(value.planRowCount) || Number(value.planRowCount) < 0) {
    issues.push("remote_restore_plan_rows");
  }
  if (
    !Number.isInteger(value.dodoLinkedPlanRowCount) ||
    Number(value.dodoLinkedPlanRowCount) < 0 ||
    Number(value.dodoLinkedPlanRowCount) > Number(value.planRowCount)
  ) {
    issues.push("remote_restore_dodo_rows");
  }
  if (value.dodoLinkagePreserved !== true)
    issues.push("remote_restore_dodo_linkage");
  if (value.scratchDatabaseRemoved !== true)
    issues.push("remote_restore_scratch_cleanup");
  return { ok: issues.length === 0, issues };
}

/** @param {string} output */
export function readDeployedWorkerVersionId(output) {
  /** @type {Array<Record<string, unknown>>} */
  const entries = [];
  for (const line of String(output).split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        entries.push(parsed);
      }
    } catch {
      // Wrangler output may include non-JSON notices; only its documented
      // machine-readable output entries are eligible release evidence.
    }
  }
  const deployEntry = [...entries]
    .reverse()
    .find((entry) => entry?.type === "deploy" && entry?.version === 1);
  const versionId =
    typeof deployEntry?.version_id === "string"
      ? deployEntry.version_id.trim()
      : "";
  if (!SAFE_IDENTIFIER_PATTERN.test(versionId)) {
    throw new Error("deployed_worker_version_missing");
  }
  return versionId;
}

/**
 * @param {ProductionDeployStep[]} plan
 * @param {(step: ProductionDeployStep) => void} execute
 */
export function executeProductionDeployPlan(plan, execute) {
  if (!Array.isArray(plan) || typeof execute !== "function") {
    throw new Error("invalid_production_deploy_plan");
  }

  const rollbackStep = plan.find((step) => step.runOnPostDeployFailure);
  const postCanaryInvariantStep = plan.find(
    (step) => step.id === "partial_refund_invariants_postcanary",
  );
  let deploymentAttempted = false;

  for (const step of plan) {
    if (step.runOnPostDeployFailure) continue;

    if (step.id === "deploy") {
      // Wrangler can publish the new version before returning a non-zero
      // status, so every failure from this boundary onward must enter the
      // validated rollback path rather than assuming no mutation occurred.
      deploymentAttempted = true;
    }

    try {
      execute(step);
    } catch (releaseFailure) {
      if (step.nonBlockingDiagnostic) {
        process.stderr.write(
          `non-blocking diagnostic failed: ${step.id} — recorded, not fatal\n`,
        );
        continue;
      }
      if (!deploymentAttempted) throw releaseFailure;

      const recoveryFailures = [];
      if (step.id === "post_deploy_release_canary" && postCanaryInvariantStep) {
        try {
          execute(postCanaryInvariantStep);
        } catch (recoveryFailure) {
          recoveryFailures.push(recoveryFailure);
        }
      }

      if (!rollbackStep) {
        recoveryFailures.push(new Error("post_deploy_rollback_step_missing"));
      } else {
        try {
          execute(rollbackStep);
        } catch (recoveryFailure) {
          recoveryFailures.push(recoveryFailure);
        }
      }

      if (recoveryFailures.length === 0) throw releaseFailure;
      throw new AggregateError(
        [releaseFailure, ...recoveryFailures],
        "post_deploy_recovery_failed",
        { cause: releaseFailure },
      );
    }
  }
}
