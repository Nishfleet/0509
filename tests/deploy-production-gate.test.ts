import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const deployPlanModule = await import("../scripts/deploy-production-plan.mjs");
const {
  buildProductionDeployPlan,
  executeProductionDeployPlan,
  printReleaseReadinessDiagnostics,
} = deployPlanModule;
const {
  firstParentMigrationDiffs,
  hasAppliedMigrationMutation,
  hasMigrationChanges,
  hasMigrationMutationAcrossCommits,
  hasRestoreCriticalChanges,
  minimumValidityMs,
} =
  await import("../scripts/verify-remote-restore-evidence.mjs");
const rollbackTargetModule =
  await import("../scripts/worker-rollback-target.mjs");
const { validateDeployReadiness } =
  await import("../scripts/verify-deploy-readiness.mjs");
const { RELEASE_COVERAGE_MATRIX, expectedReleaseArtifacts } =
  await import("../scripts/playwright-release-manifest-reporter.mjs");

const fingerprint = "a".repeat(64);
const wranglerHash = "b".repeat(64);
const serverIdentity = "local-0123456789abcdef0123456789abcdef";
const roots: string[] = [];
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const aria = Buffer.from('- main "0509":\n  - heading "Proof"\n', "utf8");
const remoteRestoreEvidencePath =
  "test-results/d1-remote-restore-evidence.json";
const wranglerOutputPath = "test-results/wrangler-deploy-output.jsonl";
const migrationLedgerNames = ["0001_first.sql", "0002_second.sql"];
const migrationLedgerNamesHash = createHash("sha256")
  .update(JSON.stringify(migrationLedgerNames))
  .digest("hex");

afterEach(() => {
  while (roots.length > 0)
    rmSync(roots.pop()!, { recursive: true, force: true });
});

function finalUrl(expected: any, viewport: string) {
  if (expected.exact) return expected.exact;
  const query = expected.search
    ? new URLSearchParams(expected.search).toString()
    : expected.searchKeys
        .map((key: string) => `${key}=e2e-${viewport}`)
        .join("&");
  return `${expected.pathname}?${query}`;
}

function passingEvidence() {
  const root = mkdtempSync(join(tmpdir(), "0509-deploy-readiness-"));
  roots.push(root);
  const artifactRoot = resolve(
    root,
    "test-results/gate-b-artifacts",
    fingerprint,
    serverIdentity,
  );
  mkdirSync(artifactRoot, { recursive: true });
  const entries = Object.values(
    RELEASE_COVERAGE_MATRIX as Record<number, readonly any[]>,
  )
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
        localProofSearchRolloutMode: "v2",
        providerNetworkDeny: true,
        authProvider: "better-auth",
        browserProject: "local-release",
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
    schemaVersion: 2,
    candidateFingerprint: fingerprint,
    generatedAt: "2026-07-16T10:00:00.000Z",
    databaseIdentitySha256: "1".repeat(64),
    databaseBookmark: "bookmark-2026-07-16",
    scratchDatabaseIdentitySha256: "2".repeat(64),
    sourceDumpSha256: "3".repeat(64),
    transformedSqlSha256: "4".repeat(64),
    rowCountDigestSha256: "5".repeat(64),
    migrationLedgerSha256: "6".repeat(64),
    migrationLedgerBaselineSha256: "9".repeat(64),
    migrationLedgerNames,
    migrationLedgerNamesSha256: migrationLedgerNamesHash,
    schemaDigestSha256: "7".repeat(64),
    contentDigestSha256: "8".repeat(64),
    wranglerWorktreeSha256: wranglerHash,
    latestMigration: "0002_second.sql",
    migrationCount: 2,
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
    const earlyRefundPreflight = plan.find(
      (step: any) => step.id === "partial_refund_invariants_preflight",
    );
    expect(earlyRefundPreflight).toMatchObject({
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan.indexOf(earlyRefundPreflight!)).toBeLessThan(
      plan.findIndex((step: any) => step.id === "migration_sync"),
    );
    expect(
      plan.findIndex((step: any) => step.id === "launch_readiness"),
    ).toBeLessThan(
      plan.findIndex((step: any) => step.id === "readiness_evidence"),
    );
    expect(
      plan.findIndex((step: any) => step.id === "readiness_evidence"),
    ).toBeLessThan(
      plan.findIndex((step: any) => step.id === "cross_browser_risk_proof"),
    );
    expect(
      plan.findIndex((step: any) => step.id === "cross_browser_risk_proof"),
    ).toBeLessThan(plan.findIndex((step: any) => step.id === "deploy"));
    expect(
      plan.findIndex((step: any) => step.id === "remote_restore_evidence"),
    ).toBeLessThan(plan.findIndex((step: any) => step.id === "deploy"));
    expect(plan.find((step: any) => step.id === "deploy")?.env).toMatchObject({
      WRANGLER_OUTPUT_FILE_PATH: wranglerOutputPath,
    });
    expect(plan.findIndex((step: any) => step.id === "deploy")).toBeLessThan(
      plan.findIndex((step: any) => step.id === "post_deploy_release_canary"),
    );
    const deployIndex = plan.findIndex((step: any) => step.id === "deploy");
    expect(plan[deployIndex - 2]).toMatchObject({
      id: "partial_refund_invariants_predeploy",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan[deployIndex - 1]).toMatchObject({
      id: "capture_worker_rollback_target",
      command: "node",
      includeCloudflareCredentials: true,
    });
    expect(plan[deployIndex + 1]).toMatchObject({
      id: "verify_worker_rollback_target",
      command: "node",
    });
    expect(plan[deployIndex + 2]).toMatchObject({
      id: "partial_refund_invariants_postdeploy",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan[deployIndex + 3]).toMatchObject({
      id: "worker_propagation_stabilization",
      command: "node",
      args: [
        "scripts/launch-readiness-canary-cycle.mjs",
        "--wait-only",
        "--wrangler-output",
        wranglerOutputPath,
      ],
    });
    const canaryIndex = plan.findIndex(
      (step: any) => step.id === "post_deploy_release_canary",
    );
    expect(plan[canaryIndex]).toMatchObject({
      id: "post_deploy_release_canary",
      includeCloudflareCredentials: true,
    });
    expect(plan[canaryIndex + 1]).toMatchObject({
      id: "partial_refund_invariants_postcanary",
      command: "node",
      args: ["scripts/check-partial-refund-invariants.mjs"],
      includeCloudflareCredentials: true,
    });
    expect(plan[canaryIndex + 2]).toMatchObject({
      id: "start_production_soak",
      command: "node",
      args: expect.arrayContaining([
        "scripts/gate-c-soak.mjs",
        "start",
        "--manifest",
        "test-results/deploy-readiness-test.json",
        "--wrangler-output",
        wranglerOutputPath,
        "--rollback-target",
        "test-results/worker-rollback-target.json",
      ]),
    });
    expect(plan[canaryIndex + 3]).toMatchObject({
      id: "rollback_failed_release",
      command: "node",
      includeCloudflareCredentials: true,
      runOnPostDeployFailure: true,
    });
    expect(plan[canaryIndex + 4]).toMatchObject({ id: "live_public_truth" });
    expect(plan[canaryIndex + 5]).toMatchObject({
      id: "production_public_smoke",
      command: "npm",
      args: ["run", "e2e:prod:public"],
    });
    expect(plan[canaryIndex + 6]).toMatchObject({ id: "oauth_branding" });
  });

  it("captures one stable prior Worker version and emits an exact guarded rollback command", () => {
    const target = rollbackTargetModule.parseWorkerDeploymentStatus({
      id: "deployment-stable",
      versions: [{ version_id: "worker-version-prior", percentage: 100 }],
    });
    expect(target).toEqual({
      deploymentId: "deployment-stable",
      versionId: "worker-version-prior",
      percentage: 100,
    });
    expect(() =>
      rollbackTargetModule.parseWorkerDeploymentStatus({
        id: "deployment-split",
        versions: [
          { version_id: "worker-version-a", percentage: 90 },
          { version_id: "worker-version-b", percentage: 10 },
        ],
      }),
    ).toThrow("worker_rollback_target_ambiguous");

    const evidence = {
      schemaVersion: 1,
      capturedAt: "2026-07-18T12:00:00.000Z",
      source: "wrangler deployments status --json",
      ...target,
    };
    expect(
      rollbackTargetModule.validateWorkerRollbackEvidence(evidence, {
        deployedVersionId: "worker-version-new",
      }),
    ).toEqual({ ok: true, issues: [] });
    expect(
      rollbackTargetModule.buildWorkerRollbackCommand(
        "worker-version-prior",
        "worker-version-new",
      ),
    ).toEqual({
      command: "wrangler",
      args: [
        "rollback",
        "worker-version-prior",
        "--name",
        "0509",
        "--message",
        "rollback failed release worker-version-new",
        "--yes",
      ],
    });
    expect(
      rollbackTargetModule.buildWorkerRollbackCommand("worker-version-prior"),
    ).toEqual({
      command: "wrangler",
      args: [
        "rollback",
        "worker-version-prior",
        "--name",
        "0509",
        "--message",
        "rollback ambiguous deploy attempt",
        "--yes",
      ],
    });
    expect(() =>
      rollbackTargetModule.buildWorkerRollbackCommand(
        "worker-version-prior",
        "worker-version-prior",
      ),
    ).toThrow("worker_rollback_target_matches_new_version");
  });

  it("executes the captured rollback target when deploy output is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-worker-rollback-"));
    roots.push(root);
    const targetPath = join(root, "rollback-target.json");
    const wranglerOutputPath = join(root, "missing-wrangler-output.jsonl");
    const fakeWranglerPath = join(root, "fake-wrangler.mjs");
    const invocationPath = join(root, "wrangler-invocation.json");
    writeFileSync(
      targetPath,
      JSON.stringify({
        schemaVersion: 1,
        capturedAt: "2026-07-18T12:00:00.000Z",
        source: "wrangler deployments status --json",
        deploymentId: "deployment-stable",
        versionId: "worker-version-prior",
        percentage: 100,
      }),
    );
    writeFileSync(
      fakeWranglerPath,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_WRANGLER_INVOCATION, JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.FAKE_WRANGLER_EXIT || 0));
`,
    );
    chmodSync(fakeWranglerPath, 0o755);

    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/rollback-production.mjs"),
        "--target",
        targetPath,
        "--wrangler-output",
        wranglerOutputPath,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          WRANGLER_BIN: fakeWranglerPath,
          FAKE_WRANGLER_INVOCATION: invocationPath,
        },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(invocationPath, "utf8"))).toEqual([
      "rollback",
      "worker-version-prior",
      "--name",
      "0509",
      "--message",
      "rollback ambiguous deploy attempt",
      "--yes",
    ]);
  });

  it("refuses malformed rollback evidence and a known same-version target before spawning", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-worker-rollback-refusal-"));
    roots.push(root);
    const fakeWranglerPath = join(root, "fake-wrangler.mjs");
    const invocationPath = join(root, "wrangler-invocation.json");
    writeFileSync(
      fakeWranglerPath,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_WRANGLER_INVOCATION, JSON.stringify(process.argv.slice(2)));
`,
    );
    chmodSync(fakeWranglerPath, 0o755);

    const runRollback = (evidence: Record<string, unknown>, output: string) => {
      const targetPath = join(root, `rollback-target-${Math.random()}.json`);
      const wranglerOutputPath = join(
        root,
        `wrangler-output-${Math.random()}.jsonl`,
      );
      writeFileSync(targetPath, JSON.stringify(evidence));
      writeFileSync(wranglerOutputPath, output);
      return spawnSync(
        process.execPath,
        [
          resolve("scripts/rollback-production.mjs"),
          "--target",
          targetPath,
          "--wrangler-output",
          wranglerOutputPath,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            WRANGLER_BIN: fakeWranglerPath,
            FAKE_WRANGLER_INVOCATION: invocationPath,
          },
          encoding: "utf8",
        },
      );
    };
    const validEvidence = {
      schemaVersion: 1,
      capturedAt: "2026-07-18T12:00:00.000Z",
      source: "wrangler deployments status --json",
      deploymentId: "deployment-stable",
      versionId: "worker-version-prior",
      percentage: 100,
    };

    expect(
      runRollback({ ...validEvidence, percentage: 50 }, "").status,
    ).not.toBe(0);
    for (const versionId of ["--help", "--version", "-y"]) {
      expect(runRollback({ ...validEvidence, versionId }, "").status).not.toBe(
        0,
      );
    }
    expect(
      runRollback(
        validEvidence,
        JSON.stringify({
          type: "deploy",
          version: 1,
          version_id: "worker-version-prior",
        }),
      ).status,
    ).not.toBe(0);
    expect(() => readFileSync(invocationPath, "utf8")).toThrow();
  });

  it("stops at the executable refund preflight before migration or deploy", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    expect(() =>
      executeProductionDeployPlan(plan, (step: any) => {
        executed.push(step.id);
        if (step.id === "partial_refund_invariants_preflight") {
          throw new Error("refund_preflight_failed");
        }
      }),
    ).toThrow("refund_preflight_failed");
    expect(executed).toEqual([
      "public_source_truth",
      "workspace_membership_preflight",
      "partial_refund_invariants_preflight",
    ]);
    expect(executed).not.toContain("migration_sync");
    expect(executed).not.toContain("deploy");
  });

  it("surfaces the readiness manifest status and strictIssues on predeploy readiness failure", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-readiness-diag-"));
    roots.push(root);
    const manifestPath = join(root, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        status: "failed",
        strictIssues: ["annotation:finalUrl", "coverage_count:73:66"],
      }),
    );
    const lines: string[] = [];
    printReleaseReadinessDiagnostics(manifestPath, (text: string) => { lines.push(text); return true; });
    const output = lines.join("");
    expect(output).toContain("status=failed");
    expect(output).toContain("coverage_count:73:66");
    expect(output).toContain("annotation:finalUrl");
  });

  it("reports an unavailable readiness manifest without masking the original failure", () => {
    const lines: string[] = [];
    printReleaseReadinessDiagnostics(
      "test-results/deploy-readiness-does-not-exist.json",
      (text: string) => { lines.push(text); return true; },
    );
    expect(lines.join("")).toContain("readiness manifest unavailable");
  });

  it("prints readiness diagnostics to stderr when launch:readiness:predeploy fails", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const chunks: string[] = [];
    const original = process.stderr.write;
    (process.stderr as any).write = (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      expect(() =>
        executeProductionDeployPlan(plan, (step: any) => {
          if (step.id === "launch_readiness") throw new Error("launch_readiness_failed");
        }),
      ).toThrow("launch_readiness_failed");
    } finally {
      (process.stderr as any).write = original;
    }
    expect(chunks.join("")).toContain("launch:readiness:predeploy failed");
  });

  it("stops at the final refund predeploy gate without attempting rollback", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    expect(() =>
      executeProductionDeployPlan(plan, (step: any) => {
        executed.push(step.id);
        if (step.id === "partial_refund_invariants_predeploy") {
          throw new Error("partial_refund_invariants_predeploy_failed");
        }
      }),
    ).toThrow("partial_refund_invariants_predeploy_failed");
    expect(executed).not.toContain("deploy");
    expect(executed).not.toContain("rollback_failed_release");
  });

  it.each([
    ["deploy", "verify_worker_rollback_target"],
    ["verify_worker_rollback_target", "partial_refund_invariants_postdeploy"],
    [
      "partial_refund_invariants_postdeploy",
      "worker_propagation_stabilization",
    ],
    ["worker_propagation_stabilization", "post_deploy_release_canary"],
    ["partial_refund_invariants_postcanary", "live_public_truth"],
    ["live_public_truth", "production_public_smoke"],
    ["production_public_smoke", "oauth_branding"],
    ["oauth_branding", null],
  ])(
    "rolls back after %s fails and skips later release checks",
    (failureStep, blockedStep) => {
      const plan = buildProductionDeployPlan({
        manifestPath: "test-results/deploy-readiness-test.json",
        remoteRestoreEvidencePath,
        wranglerOutputPath,
      });
      const executed: string[] = [];
      const failure = new Error(`${failureStep}_failed`);
      let caught: unknown;
      try {
        executeProductionDeployPlan(plan, (step: any) => {
          executed.push(step.id);
          if (step.id === failureStep) throw failure;
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBe(failure);
      expect(executed.filter((id) => id === failureStep)).toHaveLength(1);
      expect(
        executed.filter((id) => id === "rollback_failed_release"),
      ).toHaveLength(1);
      if (blockedStep) expect(executed).not.toContain(blockedStep);
    },
  );

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
    expect(
      executed.slice(executed.indexOf("post_deploy_release_canary")),
    ).toEqual([
      "post_deploy_release_canary",
      "partial_refund_invariants_postcanary",
      "rollback_failed_release",
    ]);
    expect(executed).not.toContain("live_public_truth");
  });

  it("preserves both failures when the canary and post-canary invariant fail", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const canaryFailure = new Error("post_deploy_release_canary_failed");
    const invariantFailure = new Error(
      "partial_refund_invariants_postcanary_failed",
    );
    let caught: unknown;
    try {
      executeProductionDeployPlan(plan, (step: any) => {
        if (step.id === "post_deploy_release_canary") throw canaryFailure;
        if (step.id === "partial_refund_invariants_postcanary")
          throw invariantFailure;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      canaryFailure,
      invariantFailure,
    ]);
    expect((caught as Error & { cause?: unknown }).cause).toBe(canaryFailure);
  });

  it("skips the failure-only rollback on a green release", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    executeProductionDeployPlan(plan, (step: any) => executed.push(step.id));
    expect(executed).not.toContain("rollback_failed_release");
    expect(executed).toContain("live_public_truth");
  });

  it("preserves canary and rollback failures and blocks later truth checks", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const canaryFailure = new Error("post_deploy_release_canary_failed");
    const rollbackFailure = new Error("worker_rollback_failed");
    const executed: string[] = [];
    let caught: unknown;
    try {
      executeProductionDeployPlan(plan, (step: any) => {
        executed.push(step.id);
        if (step.id === "post_deploy_release_canary") throw canaryFailure;
        if (step.id === "rollback_failed_release") throw rollbackFailure;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      canaryFailure,
      rollbackFailure,
    ]);
    expect(executed).toContain("partial_refund_invariants_postcanary");
    expect(executed).not.toContain("live_public_truth");
  });

  it("preserves a post-deploy gate failure with a refused rollback target", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const releaseFailure = new Error(
      "partial_refund_invariants_postdeploy_failed",
    );
    const targetFailure = new Error("worker_rollback_target_ambiguous");
    const executed: string[] = [];
    let caught: unknown;
    try {
      executeProductionDeployPlan(plan, (step: any) => {
        executed.push(step.id);
        if (step.id === "partial_refund_invariants_postdeploy")
          throw releaseFailure;
        if (step.id === "rollback_failed_release") throw targetFailure;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      releaseFailure,
      targetFailure,
    ]);
    expect((caught as Error & { cause?: unknown }).cause).toBe(releaseFailure);
    expect(
      executed.filter((id) => id === "rollback_failed_release"),
    ).toHaveLength(1);
    expect(executed).not.toContain("post_deploy_release_canary");
  });

  it("fails closed when a mutated release has no rollback step", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    }).filter((step: any) => !step.runOnPostDeployFailure);
    const releaseFailure = new Error(
      "partial_refund_invariants_postdeploy_failed",
    );
    let caught: unknown;
    try {
      executeProductionDeployPlan(plan, (step: any) => {
        if (step.id === "partial_refund_invariants_postdeploy")
          throw releaseFailure;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors[0]).toBe(releaseFailure);
    expect((caught as AggregateError).errors[1]).toMatchObject({
      message: "post_deploy_rollback_step_missing",
    });
    expect((caught as Error & { cause?: unknown }).cause).toBe(releaseFailure);
  });

  it("proves an intentional readiness failure prevents every deploy mutation", () => {
    const plan = buildProductionDeployPlan({
      manifestPath: "test-results/deploy-readiness-test.json",
      remoteRestoreEvidencePath,
      wranglerOutputPath,
    });
    const executed: string[] = [];
    const chunks: string[] = [];
    const original = process.stderr.write;
    (process.stderr as any).write = (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      expect(() =>
        executeProductionDeployPlan(plan, (step: any) => {
          executed.push(step.id);
          if (step.id === "launch_readiness")
            throw new Error("intentional_gate_failure");
        }),
      ).toThrow("intentional_gate_failure");
    } finally {
      (process.stderr as any).write = original;
    }
    expect(chunks.join("")).toContain("launch:readiness:predeploy failed");
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
    expect(
      validateRemoteRestoreEvidence(
        { ...passingRemoteRestoreEvidence(), schemaVersion: 1 },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_schema"]),
    });
    expect(
      validateRemoteRestoreEvidence(
        {
          ...passingRemoteRestoreEvidence(),
          generatedAt: "2026-07-14T10:00:00.000Z",
        },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_evidence_stale"]),
    });
    expect(
      validateRemoteRestoreEvidence(
        {
          ...passingRemoteRestoreEvidence(),
          candidateFingerprint: "9".repeat(64),
          scratchDatabaseRemoved: false,
        },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        "remote_restore_candidate_mismatch",
        "remote_restore_scratch_cleanup",
      ]),
    });
    expect(
      validateRemoteRestoreEvidence(
        {
          ...passingRemoteRestoreEvidence(),
          migrationLedgerSha256: null,
          planRowCount: -1,
          dodoLinkedPlanRowCount: 6,
        },
        expected,
      ),
    ).toMatchObject({
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

  it("rejects a reordered same-count ledger even when its self-hash is valid", () => {
    const validateRemoteRestoreEvidence = (
      deployPlanModule as Record<string, unknown>
    ).validateRemoteRestoreEvidence;
    expect(typeof validateRemoteRestoreEvidence).toBe("function");
    if (typeof validateRemoteRestoreEvidence !== "function") return;
    const evidence = passingRemoteRestoreEvidence();
    const reorderedNames = [...migrationLedgerNames].reverse();
    const reorderedEvidence = {
      ...evidence,
      migrationLedgerNames: reorderedNames,
      migrationLedgerNamesSha256: createHash("sha256")
        .update(JSON.stringify(reorderedNames))
        .digest("hex"),
    };
    expect(
      validateRemoteRestoreEvidence(reorderedEvidence, {
        candidateFingerprint: fingerprint,
        wranglerWorktreeSha256: wranglerHash,
        allowedMigrationStates: [
          {
            latestMigration: evidence.latestMigration,
            migrationCount: evidence.migrationCount,
            migrationLedgerNames,
            migrationLedgerNamesSha256: migrationLedgerNamesHash,
            migrationLedgerBaselineSha256:
              evidence.migrationLedgerBaselineSha256,
          },
        ],
        now: new Date("2026-07-16T12:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        "remote_restore_migration_mismatch",
        "remote_restore_migration_ledger_order",
      ]),
    });
  });

  it("requires fresh exact restore evidence for migration deploys but permits a seven-day drill for code-only deploys", () => {
    const validateRemoteRestoreEvidence = (
      deployPlanModule as Record<string, unknown>
    ).validateRemoteRestoreEvidence;
    expect(typeof validateRemoteRestoreEvidence).toBe("function");
    if (typeof validateRemoteRestoreEvidence !== "function") return;

    const codeOnlyEvidence = {
      ...passingRemoteRestoreEvidence(),
      generatedAt: "2026-07-10T13:00:00.000Z",
      candidateFingerprint: "7".repeat(64),
      wranglerWorktreeSha256: wranglerHash,
    };
    const expected = {
      candidateFingerprint: fingerprint,
      wranglerWorktreeSha256: wranglerHash,
      latestMigration: "0002_second.sql",
      migrationCount: 2,
      migrationBearing: false,
      now: new Date("2026-07-16T12:00:00.000Z"),
    };

    expect(validateRemoteRestoreEvidence(codeOnlyEvidence, expected)).toEqual({
      ok: true,
      issues: [],
    });
    expect(
      validateRemoteRestoreEvidence(
        {
          ...codeOnlyEvidence,
          wranglerWorktreeSha256: "8".repeat(64),
        },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_config_mismatch"]),
    });
    expect(
      validateRemoteRestoreEvidence(codeOnlyEvidence, {
        ...expected,
        restoreCritical: true,
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_candidate_mismatch"]),
    });
    expect(
      validateRemoteRestoreEvidence(
        { ...codeOnlyEvidence, generatedAt: "2026-07-08T10:00:00.000Z" },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_evidence_stale"]),
    });
    expect(
      validateRemoteRestoreEvidence(codeOnlyEvidence, {
        ...expected,
        latestMigration: "0070_release_scheduled_observations.sql",
        migrationCount: 64,
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        "remote_restore_migration_mismatch",
        "remote_restore_migration_count",
      ]),
    });
  });

  it("applies freshness headroom without widening future clock-skew tolerance", () => {
    const validateRemoteRestoreEvidence = (
      deployPlanModule as Record<string, unknown>
    ).validateRemoteRestoreEvidence;
    expect(typeof validateRemoteRestoreEvidence).toBe("function");
    if (typeof validateRemoteRestoreEvidence !== "function") return;

    const expected = {
      candidateFingerprint: fingerprint,
      wranglerWorktreeSha256: wranglerHash,
      migrationBearing: false,
      now: new Date("2026-07-16T12:00:00.000Z"),
      minimumValidityMs: 6 * 60 * 60 * 1000,
    };
    expect(
      validateRemoteRestoreEvidence(
        {
          ...passingRemoteRestoreEvidence(),
          generatedAt: "2026-07-09T18:00:00.000Z",
        },
        expected,
      ),
    ).toEqual({ ok: true, issues: [] });
    expect(
      validateRemoteRestoreEvidence(
        {
          ...passingRemoteRestoreEvidence(),
          generatedAt: "2026-07-09T17:59:59.999Z",
        },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_evidence_stale"]),
    });
    expect(
      validateRemoteRestoreEvidence(
        {
          ...passingRemoteRestoreEvidence(),
          generatedAt: "2026-07-16T12:05:00.001Z",
        },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["remote_restore_evidence_stale"]),
    });
    expect(
      validateRemoteRestoreEvidence(passingRemoteRestoreEvidence(), {
        ...expected,
        migrationBearing: true,
        minimumValidityMs: 12 * 60 * 60 * 1000,
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("classifies migration and restore-critical changes from the deploy diff", () => {
    const currentHead = spawnSync(
      "git",
      ["rev-parse", "--verify", "HEAD^{commit}"],
      { encoding: "utf8" },
    ).stdout.trim();
    expect(firstParentMigrationDiffs(currentHead)).toEqual([]);
    expect(hasMigrationChanges("app/routes/search.tsx\n")).toBe(false);
    expect(
      hasMigrationChanges(
        "migrations/0070_release_scheduled_observations.sql\n",
      ),
    ).toBe(true);
    expect(
      hasAppliedMigrationMutation(
        "A\tmigrations/0071_new_release_migration.sql\n",
      ),
    ).toBe(false);
    expect(
      hasAppliedMigrationMutation(
        "M\tmigrations/0070_release_scheduled_observations.sql\n",
      ),
    ).toBe(true);
    expect(
      hasAppliedMigrationMutation(
        "D\tmigrations/0069_digest_cadence_preference.sql\n",
      ),
    ).toBe(true);
    expect(
      hasMigrationMutationAcrossCommits([
        "A\tmigrations/0071_new_release_migration.sql\n",
        "M\tmigrations/0071_new_release_migration.sql\n",
      ]),
    ).toBe(true);
    expect(
      hasMigrationMutationAcrossCommits([
        "A\tmigrations/0071_new_release_migration.sql\n",
        "M\tapp/routes/search.tsx\n",
      ]),
    ).toBe(false);
    expect(hasRestoreCriticalChanges("app/routes/search.tsx\n")).toBe(false);
    expect(hasRestoreCriticalChanges("wrangler.jsonc\n")).toBe(true);
    expect(
      hasRestoreCriticalChanges("scripts/d1-migration-sync-check.lib.mjs\n"),
    ).toBe(true);
    expect(
      hasRestoreCriticalChanges(
        "scripts/d1-remote-restore-evidence-core.mjs\n",
      ),
    ).toBe(true);
    expect(
      hasRestoreCriticalChanges(".github/workflows/deploy-production.yml\n"),
    ).toBe(true);
  });

  it("bounds restore-evidence freshness headroom to one day", () => {
    expect(minimumValidityMs({})).toBe(0);
    expect(
      minimumValidityMs({
        D1_REMOTE_RESTORE_EVIDENCE_MIN_VALIDITY_MS: "43200000",
      }),
    ).toBe(43_200_000);
    expect(() =>
      minimumValidityMs({
        D1_REMOTE_RESTORE_EVIDENCE_MIN_VALIDITY_MS: "86400001",
      }),
    ).toThrow("remote_restore_minimum_validity_invalid");
  });

  it("extracts the exact newly deployed Worker version from Wrangler's official output envelope", () => {
    const readDeployedWorkerVersionId = (
      deployPlanModule as Record<string, unknown>
    ).readDeployedWorkerVersionId;
    expect(typeof readDeployedWorkerVersionId).toBe("function");
    if (typeof readDeployedWorkerVersionId !== "function") return;

    expect(
      readDeployedWorkerVersionId(
        `${JSON.stringify({ type: "deploy", version: 1, version_id: "worker-version-new" })}\n`,
      ),
    ).toBe("worker-version-new");
    expect(() => readDeployedWorkerVersionId("{}")).toThrow(
      "deployed_worker_version_missing",
    );
  });

  it("requires pre-generated private restore evidence before the protected deploy job", () => {
    const workflow = readFileSync(
      resolve(".github/workflows/deploy-production.yml"),
      "utf8",
    );
    const checkoutIndex = workflow.indexOf(
      "- uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
    );
    const acquireIndex = workflow.indexOf("- name: Acquire deploy window");
    const verifySecretsIndex = workflow.indexOf(
      "- name: Verify Cloudflare deploy secrets",
    );
    const testIndex = workflow.indexOf("- name: Test");
    const materializeIndex = workflow.indexOf(
      "- name: Materialize private remote-restore evidence",
    );
    const deployIndex = workflow.indexOf("- name: Deploy");
    const verifyEvidenceIndex = workflow.indexOf(
      "- name: Verify complete release evidence set",
    );
    const releaseIndex = workflow.indexOf("- name: Release deploy window");
    const verifySecretsStep = workflow.slice(
      verifySecretsIndex,
      workflow.indexOf("- uses: actions/setup-node@v6", verifySecretsIndex),
    );
    const materializeStep = workflow.slice(materializeIndex, deployIndex);
    const deployStep = workflow.slice(deployIndex, verifyEvidenceIndex);
    const releaseStep = workflow.slice(releaseIndex);

    expect(checkoutIndex).toBeGreaterThanOrEqual(0);
    expect(acquireIndex).toBeGreaterThan(checkoutIndex);
    expect(verifySecretsIndex).toBeGreaterThan(acquireIndex);
    expect(testIndex).toBeGreaterThan(verifySecretsIndex);
    expect(materializeIndex).toBeGreaterThan(testIndex);
    expect(deployIndex).toBeGreaterThan(materializeIndex);
    expect(verifyEvidenceIndex).toBeGreaterThan(deployIndex);
    expect(releaseIndex).toBeGreaterThan(verifyEvidenceIndex);
    expect(workflow).toContain("timeout-minutes: 270");
    expect(workflow.slice(acquireIndex, verifySecretsIndex)).toContain(
      "run: ./scripts/deploy-window-lock.sh acquire",
    );
    expect(verifySecretsStep).toContain(
      "CANARY_BYPASS_TOKEN: ${{ secrets.CANARY_BYPASS_TOKEN }}",
    );
    expect(verifySecretsStep).not.toContain(
      "D1_REMOTE_RESTORE_EVIDENCE_JSON",
    );
    expect(materializeStep).toContain(
      "uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    );
    expect(materializeStep).toContain(
      "d1-remote-restore-evidence-${{ github.sha }}-${{ github.run_id }}",
    );
    expect(workflow).not.toContain(
      "d1-remote-restore-evidence-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain("overwrite: true");
    expect(materializeStep).toContain(
      'chmod 600 test-results/d1-remote-restore-evidence.json',
    );
    expect(deployStep).toContain(
      "CANARY_BYPASS_TOKEN: ${{ secrets.CANARY_BYPASS_TOKEN }}",
    );
    expect(deployStep).toContain(
      "D1_REMOTE_RESTORE_EVIDENCE_PATH: test-results/d1-remote-restore-evidence.json",
    );
    expect(deployStep).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(releaseStep).toContain("if: always()");
    expect(releaseStep).toContain(
      "run: ./scripts/deploy-window-lock.sh release",
    );
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain(
      "prepare_remote_restore_evidence:",
    );
    const prepareSection = workflow.slice(
      workflow.indexOf("prepare_remote_restore_evidence:"),
      workflow.indexOf("\n  deploy:"),
    );
    expect(prepareSection).not.toContain("environment: production");
    expect(prepareSection).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(prepareSection).not.toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(prepareSection).not.toContain(
      "npm run restore:d1:remote-evidence",
    );
    expect(workflow).not.toContain("cleanup_remote_restore_scratch:");
    expect(workflow.match(/^\s+environment:/gmu)).toHaveLength(1);
    expect(workflow).toContain(
      "No valid pre-generated restore evidence is available.",
    );
    expect(workflow).toContain(
      'D1_REMOTE_RESTORE_EVIDENCE_MIN_VALIDITY_MS: "43200000"',
    );
    expect(workflow).toContain('if [ "$status" -ne 2 ]');
    expect(workflow).toContain('return 2');
    expect(workflow).not.toContain("gh secret set");
    expect(workflow).toContain(
      "runs-on: [self-hosted, linux, x64, vps-verify]",
    );
    expect(workflow).toContain(
      "runs-on: ubuntu-latest",
    );
    expect(readFileSync(resolve(".github/workflows/ci.yml"), "utf8")).toContain(
      "runs-on: [self-hosted, linux, x64, vps-verify]",
    );
    expect(
      readFileSync(resolve(".github/workflows/d1-backup-validate.yml"), "utf8"),
    ).toContain("runs-on: [self-hosted, linux, x64, vps-verify]");
    expect(
      readFileSync(resolve(".github/workflows/secret-scan.yml"), "utf8"),
    ).toContain("runs-on: [self-hosted, linux, x64, vps-verify]");
    expect(workflow).not.toContain("- name: Production public smoke");
  });

  it("behaviorally enforces artifact-only and infrastructure-failure evidence paths", () => {
    const workflow = parse(
      readFileSync(
        resolve(".github/workflows/deploy-production.yml"),
        "utf8",
      ),
    ) as any;
    const shell = workflow.jobs.prepare_remote_restore_evidence.steps.find(
      (step: any) =>
        step.name ===
        "Verify pre-generated exact R2 restore evidence",
    )?.run;
    expect(typeof shell).toBe("string");
    expect(shell).toContain(
      "./scripts/deploy-window-lock.sh run -- bash -euo pipefail <<'VERIFY_LANE'",
    );
    const executableShell = shell
      .replace(
        "./scripts/deploy-window-lock.sh run -- bash -euo pipefail <<'VERIFY_LANE'\n",
        "",
      )
      .replace(/\nVERIFY_LANE\s*$/u, "");

    const runMode = (
      mode:
        | "artifact"
        | "unavailable"
        | "verifier_infra"
        | "finder_infra"
        | "download_infra"
        | "corrupt_artifact"
        | "gh_missing",
    ) => {
      const root = mkdtempSync(join(tmpdir(), `0509-evidence-shell-${mode}-`));
      roots.push(root);
      const bin = join(root, "bin");
      const runnerTemp = join(root, "runner");
      const callsPath = join(root, "calls.log");
      const artifactMarker = join(root, "artifact");
      mkdirSync(bin, { recursive: true });
      mkdirSync(runnerTemp, { recursive: true });
      for (const name of ["chmod", "mkdir", "rm"]) {
        symlinkSync(`/bin/${name}`, join(bin, name));
      }

      writeFileSync(
        join(bin, "node"),
        `#!/bin/sh
printf 'node %s\\n' "$*" >> "$FAKE_CALLS"
case "$*" in
  *verify-remote-restore-evidence.mjs*)
    if [ "$FAKE_MODE" = verifier_infra ]; then exit 2; fi
    if [ -f "$FAKE_ARTIFACT_MARKER" ]; then
      exit 0
    fi
    exit 1
    ;;
  *find-recent-remote-restore-artifact.mjs*)
    if [ "$FAKE_MODE" = artifact ] ||
      [ "$FAKE_MODE" = verifier_infra ] ||
      [ "$FAKE_MODE" = download_infra ] ||
      [ "$FAKE_MODE" = corrupt_artifact ] ||
      [ "$FAKE_MODE" = gh_missing ]; then
      printf '30423695493\\td1-remote-restore-evidence-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-30423695493\\n'
      exit 0
    fi
    if [ "$FAKE_MODE" = finder_infra ]; then exit 2; fi
    exit 1
    ;;
esac
exit 90
`,
      );
      writeFileSync(
        join(bin, "sleep"),
        `#!/bin/sh
printf 'sleep %s\\n' "$*" >> "$FAKE_CALLS"
`,
      );
      if (mode !== "gh_missing") {
        writeFileSync(
          join(bin, "gh"),
          `#!/bin/sh
printf 'gh %s\\n' "$*" >> "$FAKE_CALLS"
if [ "$FAKE_MODE" = download_infra ]; then exit 1; fi
directory=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--dir" ]; then
    directory="$2"
    break
  fi
  shift
done
[ -n "$directory" ] || exit 92
mkdir -p "$directory"
: > "$directory/evidence.tar.gz"
`,
        );
      }
      writeFileSync(
        join(bin, "tar"),
        `#!/bin/sh
printf 'tar %s\\n' "$*" >> "$FAKE_CALLS"
case "$1" in
  -tzf) printf 'd1-remote-restore-evidence.json\\n' ;;
  -tvzf) printf '%s\\n' '-rw------- 0/0 18 2026-07-29 00:00 d1-remote-restore-evidence.json' ;;
  -xOzf)
    if [ "$FAKE_MODE" = corrupt_artifact ]; then exit 94; fi
    printf '{"artifact":true}'
    : > "$FAKE_ARTIFACT_MARKER"
    ;;
  *) exit 93 ;;
esac
`,
      );
      writeFileSync(join(bin, "stat"), "#!/bin/sh\nprintf '600\\n'\n");
      const executables = ["node", "sleep", "tar", "stat"];
      if (mode !== "gh_missing") executables.push("gh");
      for (const name of executables) {
        chmodSync(join(bin, name), 0o755);
      }

      const result = spawnSync("/bin/bash", ["-c", executableShell], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: bin,
          FAKE_CALLS: callsPath,
          FAKE_MODE: mode,
          FAKE_ARTIFACT_MARKER: artifactMarker,
          RUNNER_TEMP: runnerTemp,
          GITHUB_REPOSITORY: "nish3451/0509",
        },
        encoding: "utf8",
      });
      return {
        result,
        calls: readFileSync(callsPath, "utf8").trim().split("\n"),
      };
    };

    const artifact = runMode("artifact");
    expect(artifact.result.status).toBe(0);
    expect(artifact.result.stdout).toContain(
      "Recent private restore evidence is valid for this deploy.",
    );
    expect(artifact.calls.filter((call) => call.startsWith("gh ")))
      .toHaveLength(1);
    expect(artifact.calls.filter((call) => call.startsWith("tar ")))
      .toHaveLength(3);

    const unavailable = runMode("unavailable");
    expect(unavailable.result.status).toBe(1);
    expect(unavailable.result.stderr).toContain(
      "No valid pre-generated restore evidence is available.",
    );
    expect(
      unavailable.calls.some((call) =>
        call.includes("find-recent-remote-restore-artifact.mjs"),
      ),
    ).toBe(true);

    const infrastructureFailure = runMode("verifier_infra");
    expect(infrastructureFailure.result.status).toBe(2);
    expect(
      infrastructureFailure.calls.filter((call) =>
        call.startsWith("node scripts/verify-"),
      ),
    ).toHaveLength(3);

    const finderInfrastructureFailure = runMode("finder_infra");
    expect(finderInfrastructureFailure.result.status).toBe(2);
    expect(
      finderInfrastructureFailure.result.stderr,
    ).toContain(
      "Restore-evidence artifact lookup infrastructure failed after retries.",
    );
    expect(
      finderInfrastructureFailure.calls.filter((call) =>
        call.includes("find-recent-remote-restore-artifact.mjs"),
      ),
    ).toHaveLength(3);
    expect(
      finderInfrastructureFailure.result.stderr,
    ).not.toContain("pre-generated restore evidence is available");

    const downloadInfrastructureFailure = runMode("download_infra");
    expect(downloadInfrastructureFailure.result.status).toBe(2);
    expect(
      downloadInfrastructureFailure.result.stderr,
    ).toContain(
      "Restore-evidence artifact download failed after retries.",
    );
    expect(
      downloadInfrastructureFailure.calls.filter((call) =>
        call.startsWith("gh "),
      ),
    ).toHaveLength(3);

    const corruptArtifact = runMode("corrupt_artifact");
    expect(corruptArtifact.result.status).toBe(1);
    expect(corruptArtifact.result.stderr).toContain(
      "No valid pre-generated restore evidence is available.",
    );
    expect(
      corruptArtifact.calls.filter((call) => call.startsWith("tar ")),
    ).toHaveLength(3);

    const missingGitHubCli = runMode("gh_missing");
    expect(missingGitHubCli.result.status).toBe(1);
    expect(missingGitHubCli.result.stderr).toContain(
      "GitHub CLI is unavailable on this runner",
    );
    expect(missingGitHubCli.result.stderr).toContain(
      "No valid pre-generated restore evidence is available.",
    );
    expect(
      missingGitHubCli.calls.some((call) => call.startsWith("gh ")),
    ).toBe(false);
  });

  it("preserves only the explicit non-secret release evidence after every deploy attempt", () => {
    const workflow = readFileSync(
      resolve(".github/workflows/deploy-production.yml"),
      "utf8",
    );
    const verifyStep = workflow.slice(
      workflow.indexOf("- name: Verify complete release evidence set"),
      workflow.indexOf("- name: Preserve release evidence"),
    );
    const archiveStep = workflow.slice(
      workflow.indexOf(
        "- name: Archive permission-preserving release evidence",
      ),
      workflow.indexOf("- name: Preserve release evidence"),
    );
    const uploadStep = workflow.slice(
      workflow.indexOf("- name: Preserve release evidence"),
      workflow.indexOf("- name: Preserve failed release diagnostics"),
    );
    const diagnosticStep = workflow.slice(
      workflow.indexOf("- name: Preserve failed release diagnostics"),
    );

    expect(verifyStep).toContain("if: success()");
    expect(verifyStep).toContain(
      "readiness=(test-results/deploy-readiness-*.json)",
    );
    expect(verifyStep).toContain(
      "wrangler=(test-results/wrangler-deploy-output-*.jsonl)",
    );
    expect(verifyStep).toContain(
      "rollback=(test-results/worker-rollback-target-*.json)",
    );
    expect(verifyStep).toContain("gate_c=(test-results/gate-c-*.json)");
    expect(verifyStep).toContain(
      "production_soak=(test-results/production-soak-*.json)",
    );
    expect(verifyStep).toContain(
      "node scripts/gate-c-soak.mjs verify-start --journal",
    );
    expect(archiveStep).toContain("if: success()");
    expect(archiveStep).toContain(
      "node scripts/release-evidence-archive.mjs create",
    );
    expect(archiveStep).toContain(
      "production-release-evidence-${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.tar.gz",
    );
    expect(verifyStep).toContain('[ "${#authoritative_readiness[@]}" -eq 1 ]');
    expect(verifyStep).toContain("test-results/deploy-readiness-local-release-*.json) ;;");
    expect(verifyStep).toContain('[ "${#wrangler[@]}" -eq 1 ]');
    expect(verifyStep).toContain('[ "${#rollback[@]}" -eq 1 ]');
    expect(verifyStep).toContain('[ "${#gate_c[@]}" -eq 1 ]');
    expect(verifyStep).toContain('[ "${#production_soak[@]}" -eq 1 ]');
    expect(verifyStep).toContain(
      "find test-results/gate-b-artifacts -type f -print -quit",
    );
    expect(uploadStep).toContain("if: success()");
    expect(uploadStep).toContain(
      "uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(uploadStep).toContain(
      "production-release-evidence-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(uploadStep).toContain(
      "test-results/production-release-evidence-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}.tar.gz",
    );
    expect(uploadStep).toContain("if-no-files-found: error");
    expect(uploadStep).toContain("retention-days: 90");
    expect(uploadStep).not.toContain("d1-remote-restore-evidence");
    expect(uploadStep).not.toContain("test-results/**");
    expect(diagnosticStep).toContain("if: failure()");
    expect(diagnosticStep).toContain("production-release-diagnostics-");
    expect(diagnosticStep).toContain(
      "test-results/wrangler-deploy-output-*.jsonl",
    );
    expect(diagnosticStep).toContain("if-no-files-found: warn");
    expect(diagnosticStep).not.toContain("d1-remote-restore-evidence");
  });

  it("accepts only a clean, exact, all-six first-attempt manifest with intact artifacts", () => {
    const evidence = passingEvidence();
    expect(validateDeployReadiness(evidence)).toEqual({ ok: true, issues: [] });

    evidence.manifest.postflight.launchConfig.productionSearchRolloutMode =
      "v2";
    expect(validateDeployReadiness(evidence)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(["postflight_config_identity"]),
    });
  });

  it("fails closed on candidate drift and artifact tampering", () => {
    const evidence = passingEvidence();
    evidence.candidate.status.hasChanges = true;
    const firstArtifact = evidence.manifest.entries[0].artifacts[0];
    writeFileSync(
      resolve(evidence.root, "test-results", firstArtifact.name),
      Buffer.from("tampered"),
    );
    expect(validateDeployReadiness(evidence)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        "candidate_not_clean",
        "artifact_file_integrity",
      ]),
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
