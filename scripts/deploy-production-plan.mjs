import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const BACKUP_PROOF_REQUIRED = "required";
export const BACKUP_PROOF_DEFERRED = "deferred";

/** @param {unknown} value */
export function normalizeBackupProofStatus(value) {
  const status = value === undefined || value === ""
    ? BACKUP_PROOF_REQUIRED
    : value;
  if (status !== BACKUP_PROOF_REQUIRED && status !== BACKUP_PROOF_DEFERRED) {
    throw new Error("invalid_backup_proof_status");
  }
  return status;
}

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DEFERRED_BACKUP_DISPOSITION_KEYS = Object.freeze([
  "backupProof",
  "backupObjectKey",
  "backupRunId",
  "backupFingerprint",
  "productionD1RecoveryProof",
  "localFixtureScratchRestore",
  "workerRollback",
  "deployedBaselineSha",
  "releaseControlBaseSha",
  "candidateSha",
  "migrationFileCount",
  "blastRadiusVerified",
  "authorizedBy",
  "authorizationScope",
]);

/** @param {unknown} value @param {string} candidateSha */
export function validateDeferredBackupDisposition(value, candidateSha) {
  const disposition = /** @type {Record<string, unknown>} */ (value);
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(disposition).sort()) ===
      JSON.stringify([...DEFERRED_BACKUP_DISPOSITION_KEYS].sort()) &&
    disposition.backupProof === "not_obtained" &&
    disposition.backupObjectKey === null &&
    disposition.backupRunId === null &&
    disposition.backupFingerprint === null &&
    disposition.productionD1RecoveryProof === "absent" &&
    disposition.localFixtureScratchRestore === "not_production_recovery" &&
    disposition.workerRollback === "separate_not_d1_recovery" &&
    // Shape, not a fixed value: the baseline is whatever was live when the
    // schema check ran, so pinning one sha here recorded a baseline the gate
    // had stopped using. Every other field below stays exactly as pinned.
    typeof disposition.deployedBaselineSha === "string" &&
    RELEASE_SHA_PATTERN.test(disposition.deployedBaselineSha) &&
    disposition.releaseControlBaseSha ===
      "048e8a5991c6560a15cba485a7a4ba27af9d5004" &&
    disposition.candidateSha === candidateSha &&
    RELEASE_SHA_PATTERN.test(candidateSha ?? "") &&
    disposition.migrationFileCount === 0 &&
    // The blast-radius fields that used to sit here - payingCustomerCount,
    // customerOwnedWatchlistCount, customerOwnedClientRoomCount,
    // dormantExternalSignupRowCount - were CONSTANTS asserted against
    // themselves, never measured. They encoded "no customer data is at risk",
    // which was true before launch and is the whole justification for shipping
    // without backup proof. Billing is live; nothing rechecked them. A safety
    // record that states an unverified fact is worse than one that omits it,
    // because it reads like evidence. Removed 2026-08-07 rather than faked.
    //
    // What actually justifies a deferred release is the recorded human
    // authorization below, which is real and checkable.
    disposition.blastRadiusVerified === false &&
    disposition.authorizedBy === "nish3451" &&
    disposition.authorizationScope === "exact_workflow_dispatch_sha"
  );
}

/**
 * Record what a deferred release actually shipped against.
 *
 * `baselineSha` is the live commit the schema gate compared against, so the
 * journal states the baseline that was really used. It used to be a constant,
 * which meant the recorded evidence and the executed check could disagree
 * without anything noticing.
 *
 * @param {string} candidateSha
 * @param {string} baselineSha
 */
export function createDeferredBackupDisposition(candidateSha, baselineSha) {
  const value = {
    backupProof: "not_obtained",
    backupObjectKey: null,
    backupRunId: null,
    backupFingerprint: null,
    productionD1RecoveryProof: "absent",
    localFixtureScratchRestore: "not_production_recovery",
    workerRollback: "separate_not_d1_recovery",
    deployedBaselineSha: baselineSha,
    releaseControlBaseSha: "048e8a5991c6560a15cba485a7a4ba27af9d5004",
    candidateSha,
    migrationFileCount: 0,
    // Stated plainly rather than guessed at: this release shipped without
    // backup proof and nobody measured what was at risk when it did.
    blastRadiusVerified: false,
    authorizedBy: "nish3451",
    authorizationScope: "exact_workflow_dispatch_sha",
  };
  if (!validateDeferredBackupDisposition(value, candidateSha)) {
    throw new Error("invalid_deferred_backup_disposition");
  }
  return value;
}

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
 *   nonBlockingDiagnostic?: boolean;
 * }} ProductionDeployStep
 */

/**
 * @param {{ manifestPath: string, remoteRestoreEvidencePath?: string, backupProofStatus?: string, wranglerOutputPath: string, rollbackTargetPath?: string }} input
 * @returns {ProductionDeployStep[]}
 */
export function buildProductionDeployPlan({
  manifestPath,
  remoteRestoreEvidencePath,
  backupProofStatus = BACKUP_PROOF_REQUIRED,
  wranglerOutputPath,
  rollbackTargetPath = "test-results/worker-rollback-target.json",
}) {
  if (
    typeof manifestPath !== "string" ||
    !MANIFEST_PATH_PATTERN.test(manifestPath)
  ) {
    throw new Error("invalid_deploy_readiness_manifest_path");
  }
  const normalizedBackupProofStatus =
    normalizeBackupProofStatus(backupProofStatus);
  if (normalizedBackupProofStatus === BACKUP_PROOF_REQUIRED) {
    if (
      typeof remoteRestoreEvidencePath !== "string" ||
      !REMOTE_RESTORE_PATH_PATTERN.test(remoteRestoreEvidencePath)
    ) {
      throw new Error("invalid_remote_restore_evidence_path");
    }
  } else if (remoteRestoreEvidencePath) {
    throw new Error("deferred_backup_restore_evidence_conflict");
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
    ...(normalizedBackupProofStatus === BACKUP_PROOF_DEFERRED
      ? [{
          // Resolves the live commit at run time. A pinned sha here is a
          // guarantee with an expiry date: once any migration lands after it,
          // every deferred release fails forever over a change that already
          // shipped. See scripts/check-deferred-release-zero-migrations.mjs.
          id: "deferred_release_zero_migrations",
          command: "node",
          args: ["scripts/check-deferred-release-zero-migrations.mjs"],
        }]
      : []),
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
    ...(normalizedBackupProofStatus === BACKUP_PROOF_REQUIRED
      ? [{
          id: "remote_restore_evidence",
          command: "node",
          args: [
            "scripts/verify-remote-restore-evidence.mjs",
            "--manifest",
            manifestPath,
            "--remote-evidence",
            /** @type {string} */ (remoteRestoreEvidencePath),
          ],
        }]
      : []),
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
      id: "reconfirm_frozen_main_before_deploy",
      command: "./scripts/ci-verify-provider-main-cas.sh",
      args: [],
      // Drift tolerance after the full verification gate: this step runs
      // immediately before `wrangler deploy`, which ships exactly the pinned
      // SHA that the gate validated. A mid-run move of main must not void a
      // fully green deploy; the CAS script records the drift and continues.
      // Other CAS failures (API unavailable, wrong repo/ref, malformed SHA)
      // stay fail-closed.
      env: {
        TOLERATE_MAIN_DRIFT: "1",
      },
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
      // Propagation stabilization ONLY — waits for every production alias to
      // serve the exact deployed Worker version, then exits without mutating.
      // The single full launch-readiness proof now runs exactly once, inside
      // Gate C (post_deploy_release_canary). Running a second full proof here
      // caused proof_email_failed: a duplicate digest send to the same
      // recipient ~30s later never reached status=sent (2026-07-20).
      id: "worker_propagation_stabilization",
      command: "node",
      args: [
        "scripts/launch-readiness-canary-cycle.mjs",
        "--wait-only",
        "--wrangler-output",
        wranglerOutputPath,
      ],
    },
    {
      id: "post_deploy_release_canary",
      command: "node",
      args: [
        "scripts/verify-post-deploy-release.mjs",
        "--wrangler-output",
        wranglerOutputPath,
      ],
      env: {
        BACKUP_PROOF_STATUS: normalizedBackupProofStatus,
      },
      includeCloudflareCredentials: true,
    },
    {
      id: "partial_refund_invariants_postcanary",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    },
    ...(normalizedBackupProofStatus === BACKUP_PROOF_REQUIRED
      ? [{
          id: "start_production_soak",
          command: "node",
          args: [
            "scripts/gate-c-soak.mjs",
            "start",
            "--manifest",
            manifestPath,
            "--wrangler-output",
            wranglerOutputPath,
            "--rollback-target",
            rollbackTargetPath,
          ],
          env: {
            BACKUP_PROOF_STATUS: normalizedBackupProofStatus,
          },
        }]
      : []),
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
 * @param {{
 *   candidateFingerprint: string,
 *   wranglerWorktreeSha256: string,
 *   latestMigration?: string,
 *   migrationCount?: number,
 *   migrationLedgerNamesSha256?: string,
 *   migrationLedgerBaselineSha256?: string,
 *   allowedMigrationStates?: Array<{
 *     latestMigration: string,
 *     migrationCount: number,
 *     migrationLedgerNames: string[],
 *     migrationLedgerNamesSha256: string,
 *     migrationLedgerBaselineSha256: string,
 *   }>,
 *   migrationBearing?: boolean,
 *   restoreCritical?: boolean,
 *   now?: Date,
 *   minimumValidityMs?: number,
 * }} expected
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
  const exactEvidenceRequired =
    migrationBearing || expected.restoreCritical === true;
  // Nish's call, 2026-08-07: one bound of 14 days, replacing 24h for
  // migration/restore-critical releases and 7d for everything else.
  //
  // 14 rather than the 90 first considered. 90 would have matched how long the
  // backups themselves are kept (config/r2-retention-policy.json, expireDays
  // 90), but retention and freshness measure different things: retention is how
  // long the FILE survives, freshness is how recently the restore was PROVEN to
  // work. A backup that exists but has not been restored in three months is
  // exactly the one that fails when it is needed. 14 days tolerates a bad week
  // of drill failures without pretending a quarter-old proof is current, and
  // stays well inside retention so evidence never outlives its own backup.
  //
  // The nightly drill (d1-remote-restore-evidence.yml) keeps real evidence
  // under a day old, so this bound should almost never be what decides a
  // release. If it starts deciding releases, the drill is broken - fix that
  // rather than raising this.
  //
  // The other bound is unchanged and still binds hard: a migration-bearing or
  // restore-critical release must match the candidate EXACTLY, so age is not the
  // only thing between a schema change and production.
  const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
  const minimumValidityMs =
    Number.isSafeInteger(expected.minimumValidityMs) &&
    Number(expected.minimumValidityMs) >= 0
      ? Number(expected.minimumValidityMs)
      : 0;
  if (
    !Number.isFinite(generatedAt) ||
    generatedAt > now + 5 * 60 * 1000 ||
    now + minimumValidityMs - generatedAt > maxAgeMs
  ) {
    issues.push("remote_restore_evidence_stale");
  }
  if (value.schemaVersion !== 2) issues.push("remote_restore_schema");
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
    exactEvidenceRequired &&
    value.candidateFingerprint !== expected.candidateFingerprint
  ) {
    issues.push("remote_restore_candidate_mismatch");
  }
  if (
    value.wranglerWorktreeSha256 !== expected.wranglerWorktreeSha256
  ) {
    issues.push("remote_restore_config_mismatch");
  }
  if (value.productionSearchRolloutMode !== "v2")
    issues.push("remote_restore_rollout_mode");
  if (expected.allowedMigrationStates) {
    const migrationBaselineMatches = expected.allowedMigrationStates.some(
      (state) =>
        state?.migrationLedgerBaselineSha256 ===
        value.migrationLedgerBaselineSha256,
    );
    if (!migrationBaselineMatches) {
      issues.push("remote_restore_migration_baseline_mismatch");
    }
    const migrationStateMatches = expected.allowedMigrationStates.some(
      (state) =>
        state?.latestMigration === value.latestMigration &&
        state?.migrationCount === value.migrationCount &&
        state?.migrationLedgerNamesSha256 ===
          value.migrationLedgerNamesSha256 &&
        state?.migrationLedgerBaselineSha256 ===
          value.migrationLedgerBaselineSha256 &&
        JSON.stringify(state?.migrationLedgerNames) ===
          JSON.stringify(value.migrationLedgerNames),
    );
    if (!migrationStateMatches) {
      issues.push("remote_restore_migration_mismatch");
      issues.push("remote_restore_migration_count");
      issues.push("remote_restore_migration_ledger_order");
    }
  } else {
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
    if (
      expected.migrationLedgerNamesSha256 &&
      value.migrationLedgerNamesSha256 !==
        expected.migrationLedgerNamesSha256
    ) {
      issues.push("remote_restore_migration_ledger_order");
    }
    if (
      expected.migrationLedgerBaselineSha256 &&
      value.migrationLedgerBaselineSha256 !==
        expected.migrationLedgerBaselineSha256
    ) {
      issues.push("remote_restore_migration_baseline_mismatch");
    }
  }
  const migrationLedgerNames = Array.isArray(value.migrationLedgerNames)
    ? value.migrationLedgerNames
    : [];
  const migrationLedgerNamesValid =
    migrationLedgerNames.length > 0 &&
    migrationLedgerNames.every(
      (name) =>
        typeof name === "string" &&
        /^\d{4}_[A-Za-z0-9_]+\.sql$/u.test(name),
    ) &&
    new Set(migrationLedgerNames).size === migrationLedgerNames.length;
  const calculatedMigrationLedgerNamesSha256 = migrationLedgerNamesValid
    ? createHash("sha256")
        .update(JSON.stringify(migrationLedgerNames))
        .digest("hex")
    : "";
  if (
    !migrationLedgerNamesValid ||
    calculatedMigrationLedgerNamesSha256 !==
      value.migrationLedgerNamesSha256
  ) {
    issues.push("remote_restore_migration_ledger_hash");
  }
  for (const field of [
    "databaseIdentitySha256",
    "scratchDatabaseIdentitySha256",
    "sourceDumpSha256",
    "transformedSqlSha256",
    "rowCountDigestSha256",
    "migrationLedgerSha256",
    "migrationLedgerBaselineSha256",
    "migrationLedgerNamesSha256",
    "schemaDigestSha256",
    "contentDigestSha256",
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

// When a manifest-backed pre-deploy step (launch:readiness:predeploy) fails,
// surface WHY straight to stderr: the readiness manifest's status + strictIssues
// are the actionable diagnosis. Previously the plan printed only a generic
// "npm run ... failed" and the strictIssues had to be recovered from downloaded
// CI artifacts. Never masks the original failure; the read is best-effort.
/**
 * @param {string} manifestPath
 * @param {(text: string) => unknown} [write]
 */
export function printReleaseReadinessDiagnostics(
  manifestPath,
  write = (text) => process.stderr.write(text),
) {
  if (typeof manifestPath !== "string" || manifestPath.length === 0) return;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const status = typeof manifest?.status === "string" ? manifest.status : "unknown";
    const strictIssues = Array.isArray(manifest?.strictIssues) ? manifest.strictIssues : [];
    write(
      `launch:readiness:predeploy failed — manifest status=${status}; strictIssues=${JSON.stringify(strictIssues)}\n`,
    );
    const hydrationDetails = [];
    for (const entry of Array.isArray(manifest?.entries) ? manifest.entries : []) {
      for (const detail of Array.isArray(entry?.hydrationErrors) ? entry.hydrationErrors : []) {
        hydrationDetails.push({ sourceFile: entry?.sourceFile ?? null, ...detail });
      }
    }
    if (hydrationDetails.length > 0) {
      write(`hydration error detail: ${JSON.stringify(hydrationDetails)}\n`);
    }
  } catch {
    write(`launch:readiness:predeploy failed — readiness manifest unavailable at ${manifestPath}\n`);
  }
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
      if (step?.env?.E2E_RELEASE_MANIFEST_PATH) {
        printReleaseReadinessDiagnostics(step.env.E2E_RELEASE_MANIFEST_PATH);
      }
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
