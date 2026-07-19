import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const deployPlanModule = await import("../scripts/deploy-production-plan.mjs");
const { buildProductionDeployPlan, executeProductionDeployPlan } = deployPlanModule;
const { validateDeployReadiness } = await import("../scripts/verify-deploy-readiness.mjs");
const { RELEASE_COVERAGE_MATRIX, expectedReleaseArtifacts } = await import(
  "../scripts/playwright-release-manifest-reporter.mjs"
);

const fingerprint = "a".repeat(64);
const wranglerHash = "b".repeat(64);
const serverIdentity = "local-0123456789abcdef0123456789abcdef";
const roots: string[] = [];
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const aria = Buffer.from('- main "0509":\n  - heading "Proof"\n', "utf8");
const remoteRestoreEvidencePath = "test-results/d1-remote-restore-evidence.json";
const wranglerOutputPath = "test-results/wrangler-deploy-output.jsonl";

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function finalUrl(expected: any, viewport: string) {
  if (expected.exact) return expected.exact;
  const query = expected.search
    ? new URLSearchParams(expected.search).toString()
    : expected.searchKeys.map((key: string) => `${key}=e2e-${viewport}`).join("&");
  return `${expected.pathname}?${query}`;
}

function passingEvidence() {
  const root = mkdtempSync(join(tmpdir(), "0509-deploy-readiness-"));
  roots.push(root);
  const artifactRoot = resolve(root, "test-results/gate-b-artifacts", fingerprint, serverIdentity);
  mkdirSync(artifactRoot, { recursive: true });
  const entries = Object.values(RELEASE_COVERAGE_MATRIX as Record<number, readonly any[]>)
    .flat()
    .map((expected: any) => {
      const entry: any = {
        sourceFile: expected.sourceFile,
        browser: "chromium",
        project: "local-release",
        persona: expected.persona,
        scenario: expected.scenario,
        viewport: expected.viewport,
        finalUrl: finalUrl(expected.finalUrl, expected.viewport),
        status: "passed",
        retry: 0,
        firstAttempt: { status: "passed", passed: true, retry: 0 },
      };
      entry.artifacts = expectedReleaseArtifacts(entry).map((artifact: any) => {
        const body = artifact.kind === "screenshot" ? png : aria;
        const path = join(artifactRoot, artifact.attachmentName);
        writeFileSync(path, body);
        return {
          kind: artifact.kind,
          state: artifact.state,
          name: `gate-b-artifacts/${fingerprint}/${serverIdentity}/${artifact.attachmentName}`,
          contentType: artifact.contentType,
          bytes: body.byteLength,
          sha256: createHash("sha256").update(body).digest("hex"),
        };
      });
      return entry;
    });
  const manifest = {
    schemaVersion: 3,
    candidateFingerprint: fingerprint,
    environment: "local",
    runOrigin: "http://127.0.0.1:43127",
    serverIdentity,
    status: "passed",
    strict: true,
    entries,
    postflight: {
      journeys: [1, 2, 3, 4, 5, 6],
      releaseState: { count: 1 },
      fixtureState: { count: 1 },
      launchConfig: {
        identity: "c".repeat(64),
        wranglerWorktreeSha256: wranglerHash,
        productionSearchRolloutMode: "shadow",
        providerNetworkDeny: true,
        retries: 0,
        workers: 1,
      },
      scratchRestore: {
        sourceDumpSha256: "d".repeat(64),
        transformedSqlSha256: "e".repeat(64),
        integrity: "ok",
        foreignKeyViolations: 0,
        exactRowCounts: true,
        dodoLinkagePreserved: true,
        scratchDatabaseRemoved: true,
      },
      isolatedPersistenceRemoved: true,
    },
  };
  const candidate = {
    ok: true,
    fingerprint,
    branch: "main",
    baseCommit: "1".repeat(40),
    headCommit: "1".repeat(40),
    status: { hasChanges: false },
    wrangler: { worktreeSha256: wranglerHash },
  };
  return { root, manifest, candidate };
}

function passingRemoteRestoreEvidence() {
  return {
    schemaVersion: 1,
    candidateFingerprint: fingerprint,
    generatedAt: "2026-07-16T10:00:00.000Z",
    databaseIdentitySha256: "1".repeat(64),
    databaseBookmark: "bookmark-2026-07-16",
    scratchDatabaseIdentitySha256: "2".repeat(64),
    sourceDumpSha256: "3".repeat(64),
    transformedSqlSha256: "4".repeat(64),
    rowCountDigestSha256: "5".repeat(64),
    migrationLedgerSha256: "6".repeat(64),
    wranglerWorktreeSha256: wranglerHash,
    latestMigration: "0067_workspace_membership_invariants.sql",
    migrationCount: 67,
    planRowCount: 5,
    dodoLinkedPlanRowCount: 5,
    productionSearchRolloutMode: "shadow",
    integrity: "ok",
    foreignKeyViolations: 0,
    exactRowCounts: true,
    dodoLinkagePreserved: true,
    scratchDatabaseRemoved: true,
  };
}

describe("production deployment readiness gate", () => {
  it("places the exact launch and evidence gates before the deploy mutation", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const earlyRefundPreflight = plan.find((step: any) => step.id === "partial_refund_invariants_preflight");
    expect(earlyRefundPreflight).toMatchObject({
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan.indexOf(earlyRefundPreflight!)).toBeLessThan(
      plan.findIndex((step: any) => step.id === "migration_sync"),
    );
    expect(plan.findIndex((step: any) => step.id === "launch_readiness")).toBeLessThan(
      plan.findIndex((step: any) => step.id === "readiness_evidence"),
    );
    expect(plan.findIndex((step: any) => step.id === "readiness_evidence")).toBeLessThan(
      plan.findIndex((step: any) => step.id === "deploy"),
    );
    expect(plan.findIndex((step: any) => step.id === "remote_restore_evidence")).toBeLessThan(
      plan.findIndex((step: any) => step.id === "deploy"),
    );
    expect(plan.find((step: any) => step.id === "deploy")?.env).toMatchObject({
      WRANGLER_OUTPUT_FILE_PATH: wranglerOutputPath,
    });
    expect(plan.findIndex((step: any) => step.id === "deploy")).toBeLessThan(
      plan.findIndex((step: any) => step.id === "post_deploy_release_canary"),
    );
    const deployIndex = plan.findIndex((step: any) => step.id === "deploy");
    expect(plan[deployIndex - 1]).toMatchObject({
      id: "partial_refund_invariants_predeploy",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan[deployIndex + 1]).toMatchObject({
      id: "partial_refund_invariants_postdeploy",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan[deployIndex + 2]).toMatchObject({
      id: "launch_readiness_proof_canary_cycle",
      command: "node",
      args: ["scripts/launch-readiness-canary-cycle.mjs"],
    });
    const canaryIndex = plan.findIndex((step: any) => step.id === "post_deploy_release_canary");
    expect(plan[canaryIndex + 1]).toMatchObject({
      id: "partial_refund_invariants_postcanary",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan[canaryIndex + 2]).toMatchObject({ id: "live_public_truth" });
  });

  it("stops at the executable refund preflight before migration or deploy", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    expect(() => executeProductionDeployPlan(plan, (step: any) => {
      executed.push(step.id);
      if (step.id === "partial_refund_invariants_preflight") {
        throw new Error("refund_preflight_failed");
      }
    })).toThrow("refund_preflight_failed");
    expect(executed).toEqual([
      "public_source_truth",
      "workspace_membership_preflight",
      "partial_refund_invariants_preflight",
    ]);
    expect(executed).not.toContain("migration_sync");
    expect(executed).not.toContain("deploy");
  });

  it.each([
    ["partial_refund_invariants_predeploy", "deploy"],
    ["partial_refund_invariants_postdeploy", "launch_readiness_proof_canary_cycle"],
    ["launch_readiness_proof_canary_cycle", "post_deploy_release_canary"],
    ["partial_refund_invariants_postcanary", "live_public_truth"],
  ])("stops at %s before %s", (failureStep, blockedStep) => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    expect(() => executeProductionDeployPlan(plan, (step: any) => {
      executed.push(step.id);
      if (step.id === failureStep) throw new Error(`${failureStep}_failed`);
    })).toThrow(`${failureStep}_failed`);
    expect(executed).toContain(failureStep);
    expect(executed).not.toContain(blockedStep);
  });

  it("runs the post-canary refund invariant before rethrowing a canary failure", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    const canaryFailure = new Error("post_deploy_release_canary_failed");
    let caught: unknown;
    try {
      executeProductionDeployPlan(plan, (step: any) => {
        executed.push(step.id);
        if (step.id === "post_deploy_release_canary") throw canaryFailure;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(canaryFailure);
    expect(executed).toContain("partial_refund_invariants_postcanary");
    expect(executed).not.toContain("live_public_truth");
  });

  it("preserves both failures when the canary and post-canary invariant fail", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const canaryFailure = new Error("post_deploy_release_canary_failed");
    const invariantFailure = new Error("partial_refund_invariants_postcanary_failed");
    let caught: unknown;
    try {
      executeProductionDeployPlan(plan, (step: any) => {
        if (step.id === "post_deploy_release_canary") throw canaryFailure;
        if (step.id === "partial_refund_invariants_postcanary") throw invariantFailure;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([canaryFailure, invariantFailure]);
    expect((caught as Error & { cause?: unknown }).cause).toBe(canaryFailure);
  });

  it("proves an intentional readiness failure prevents every deploy mutation", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    expect(() => executeProductionDeployPlan(plan, (step: any) => {
      executed.push(step.id);
      if (step.id === "launch_readiness") throw new Error("intentional_gate_failure");
    })).toThrow("intentional_gate_failure");
    expect(executed).not.toContain("deploy");
  });

  it("fails remote restore evidence closed on absence, staleness, drift, or incomplete cleanup", () => {
    const validateRemoteRestoreEvidence = (
      deployPlanModule as Record<string, unknown>
    ).validateRemoteRestoreEvidence;
    expect(typeof validateRemoteRestoreEvidence).toBe("function");
    if (typeof validateRemoteRestoreEvidence !== "function") return;
    const expected = {
      candidateFingerprint: fingerprint,
      wranglerWorktreeSha256: wranglerHash,
      now: new Date("2026-07-16T12:00:00.000Z"),
    };

    expect(validateRemoteRestoreEvidence(null, expected)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_evidence_missing"]),
    });
    expect(validateRemoteRestoreEvidence({
      ...passingRemoteRestoreEvidence(),
      generatedAt: "2026-07-14T10:00:00.000Z",
    }, expected)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_evidence_stale"]),
    });
    expect(validateRemoteRestoreEvidence({
      ...passingRemoteRestoreEvidence(),
      candidateFingerprint: "9".repeat(64),
      scratchDatabaseRemoved: false,
    }, expected)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        "remote_restore_candidate_mismatch",
        "remote_restore_scratch_cleanup",
      ]),
    });
    expect(validateRemoteRestoreEvidence({
      ...passingRemoteRestoreEvidence(),
      migrationLedgerSha256: null,
      planRowCount: -1,
      dodoLinkedPlanRowCount: 6,
    }, expected)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        "remote_restore_migrationLedgerSha256",
        "remote_restore_plan_rows",
        "remote_restore_dodo_rows",
      ]),
    });
    expect(
      validateRemoteRestoreEvidence(passingRemoteRestoreEvidence(), expected),
    ).toEqual({ ok: true, issues: [] });
  });

  it("extracts the exact newly deployed Worker version from Wrangler's official output envelope", () => {
    const readDeployedWorkerVersionId = (
      deployPlanModule as Record<string, unknown>
    ).readDeployedWorkerVersionId;
    expect(typeof readDeployedWorkerVersionId).toBe("function");
    if (typeof readDeployedWorkerVersionId !== "function") return;

    expect(readDeployedWorkerVersionId(
      `${JSON.stringify({ type: "deploy", version: 1, version_id: "worker-version-new" })}\n`,
    )).toBe("worker-version-new");
    expect(() => readDeployedWorkerVersionId("{}")).toThrow(
      "deployed_worker_version_missing",
    );
  });

  it("wires private restore evidence and the post-deploy canary token into protected-main CI", () => {
    const workflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8");

    expect(workflow).toContain("D1_REMOTE_RESTORE_EVIDENCE_JSON");
    expect(workflow).toContain("D1_REMOTE_RESTORE_EVIDENCE_PATH");
    expect(workflow).toContain("CANARY_BYPASS_TOKEN");
  });

  it("accepts only a clean, exact, all-six first-attempt manifest with intact artifacts", () => {
    const evidence = passingEvidence();
    expect(validateDeployReadiness(evidence)).toEqual({ ok: true, issues: [] });

    evidence.manifest.postflight.launchConfig.productionSearchRolloutMode = "v2";
    expect(validateDeployReadiness(evidence)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["postflight_config_identity"]),
    });
  });

  it("fails closed on candidate drift and artifact tampering", () => {
    const evidence = passingEvidence();
    evidence.candidate.status.hasChanges = true;
    const firstArtifact = evidence.manifest.entries[0].artifacts[0];
    writeFileSync(resolve(evidence.root, "test-results", firstArtifact.name), Buffer.from("tampered"));
    expect(validateDeployReadiness(evidence)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["candidate_not_clean", "artifact_file_integrity"]),
    });
  });

  it("refuses to deploy a clean candidate before it reaches protected main", () => {
    const evidence = passingEvidence();
    evidence.candidate.branch = "codex/customer-ready-finalization";

    expect(validateDeployReadiness(evidence)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["candidate_not_protected_main"]),
    });
  });
});
