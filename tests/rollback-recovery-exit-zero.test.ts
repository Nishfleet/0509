import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The 17:36Z incident (run 34770115098, #3390): the Gate C release canary
// failed with production_meta_failed + proof_cleanup_failed, the recovery
// rolled the worker back to the last-green version (wrangler printed
// `Current Version ID: 515fb9d2-…`), and the Deploy Worker job STILL went
// red — the 09-11 occurrence threw `worker_rollback_failed` at
// scripts/rollback-production.mjs:41:32 (run 34626446693).
const deployedVersionId = "f55c34ef-2c24-49d2-b86b-5918e1580dc7";
const lastGreenVersionId = "515fb9d2-a117-4b3b-923a-c04bd9326f2d";
const evidenceVersionId = lastGreenVersionId;

// Wrangler 4.123.0's rollback transcript, 17:36Z: the swap landed (the final
// `Current Version ID:` line names the last-green version) and the process
// exited 1 anyway — the `╰ SUCCESS` box never printed.
const wranglerRollbackOutput17_36z = [
  "├ Fetching latest deployment",
  "├ Your current deployment has 1 version(s):",
  "│ (100%) f55c34ef-2c24-49d2-b86b-5918e1580dc7",
  "? Please provide an optional message for this rollback (120 characters max)",
  "🤖 Using default value in non-interactive context: rollback failed release f55c34ef-2c24-49d2-b86b-5918e1580dc7",
  "│  WARNING  You are about to rollback to Worker Version 515fb9d2-a117-4b3b-923a-c04bd9326f2d.",
  "Performing rollback...",
  "│",
  "Current Version ID: 515fb9d2-a117-4b3b-923a-c04bd9326f2d",
  "",
].join("\n");

const rollbackEvidence = {
  schemaVersion: 1,
  capturedAt: "2026-09-13T17:32:58.000Z",
  source: "wrangler deployments status --json",
  deploymentId: "8e04f9a2-1111-4222-8333-c44445555666",
  versionId: evidenceVersionId,
  percentage: 100,
};

const wranglerOutputFixture = `${JSON.stringify({ type: "deploy", version: 1, version_id: deployedVersionId })}\n`;

const deployLedgerFixture = [
  {
    sha: "30ce8ff42f9f6c36229200dcdd9c13d10515d1dd",
    tree: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    deployed_at: "2026-09-13T12:40:49.000Z",
    version_id: lastGreenVersionId,
  },
]
  .map((row) => JSON.stringify(row))
  .join("\n");

const versionsListFixture = [
  { id: deployedVersionId, metadata: { created_on: "2026-09-13T17:33:11.548807Z" } },
  { id: lastGreenVersionId, metadata: { created_on: "2026-09-13T12:40:48.9278Z" } },
];

const fakeWrangler = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "versions" && args[1] === "list") {
  process.stdout.write(JSON.stringify(${JSON.stringify(versionsListFixture)}));
  process.exit(0);
}
if (args[0] === "rollback") {
  process.stdout.write(${JSON.stringify(wranglerRollbackOutput17_36z)});
  process.exit(1);
}
process.exit(64);
`;

const tempDirs: string[] = [];
function makeRunFixture() {
  const dir = mkdtempSync(join(tmpdir(), "rollback-3390-"));
  tempDirs.push(dir);
  const wranglerBin = join(dir, "fake-wrangler.mjs");
  writeFileSync(wranglerBin, fakeWrangler, { encoding: "utf8", mode: 0o700 });
  chmodSync(wranglerBin, 0o755);
  const evidencePath = join(dir, "worker-rollback-target.json");
  writeFileSync(evidencePath, `${JSON.stringify(rollbackEvidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const wranglerOutputPath = join(dir, "wrangler-deploy-output.jsonl");
  writeFileSync(wranglerOutputPath, wranglerOutputFixture, { encoding: "utf8" });
  const ledgerPath = join(dir, "deploy-ledger.jsonl");
  writeFileSync(ledgerPath, `${deployLedgerFixture}\n`, { encoding: "utf8" });
  return { dir, wranglerBin, evidencePath, wranglerOutputPath, ledgerPath };
}

function runRollbackChild(fixtures: ReturnType<typeof makeRunFixture>) {
  return spawnSync(
    process.execPath,
    [
      "scripts/rollback-production.mjs",
      "--target",
      fixtures.evidencePath,
      "--wrangler-output",
      fixtures.wranglerOutputPath,
      "--deploy-ledger",
      fixtures.ledgerPath,
    ],
    { cwd: repoRoot, env: { ...process.env, WRANGLER_BIN: fixtures.wranglerBin }, encoding: "utf8" },
  );
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("interpretWorkerRollbackSpawn (#3390: rollback that swapped but exited non-zero)", () => {
  it("accepts the 17:36Z signature: exit 1 after the Current Version ID marker", async () => {
    const { interpretWorkerRollbackSpawn } = await import("../scripts/worker-rollback-target.mjs");
    const verdict = interpretWorkerRollbackSpawn(
      { status: 1, error: null, stdout: wranglerRollbackOutput17_36z },
      lastGreenVersionId,
    );
    expect(verdict).toEqual({
      ok: true,
      liveVersionId: lastGreenVersionId,
      outcome: "rolled_back_although_spawn_exited_nonzero",
    });
  });

  it("keeps the historical success: exit 0 means the swap landed", async () => {
    const { interpretWorkerRollbackSpawn } = await import("../scripts/worker-rollback-target.mjs");
    const verdict = interpretWorkerRollbackSpawn(
      { status: 0, error: null, stdout: wranglerRollbackOutput17_36z },
      lastGreenVersionId,
    );
    expect(verdict).toEqual({ ok: true, liveVersionId: lastGreenVersionId, outcome: "rolled_back" });
  });

  it("keeps the historical failure: exit 1 with no marker confirms nothing", async () => {
    const { interpretWorkerRollbackSpawn } = await import("../scripts/worker-rollback-target.mjs");
    const verdict = interpretWorkerRollbackSpawn(
      { status: 1, error: null, stdout: "Performing rollback...\n" },
      lastGreenVersionId,
    );
    expect(verdict).toEqual({ ok: false, liveVersionId: null, outcome: "worker_rollback_not_confirmed" });
  });

  it("keeps the historical failure: a marker naming another version is not the chosen target", async () => {
    const { interpretWorkerRollbackSpawn } = await import("../scripts/worker-rollback-target.mjs");
    const verdict = interpretWorkerRollbackSpawn(
      { status: 1, error: null, stdout: `Current Version ID: ${deployedVersionId}\n` },
      lastGreenVersionId,
    );
    expect(verdict).toEqual({ ok: false, liveVersionId: null, outcome: "worker_rollback_not_confirmed" });
  });
});

describe("rollback-production.mjs replays the 17:36Z failure end-to-end (#3390)", () => {
  it("exits 0 and records the live version when wrangler swaps but exits non-zero", () => {
    const fixtures = makeRunFixture();
    const result = runRollbackChild(fixtures);
    expect(result.status).toBe(0);
    const outcomeLines = (result.stdout ?? "")
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const recorded = outcomeLines.at(-1) ?? {};
    expect(recorded.recoveredLiveVersionId).toBe(lastGreenVersionId);
    expect(recorded.recovery).toBe("rolled_back_although_spawn_exited_nonzero");
    const updatedEvidence = JSON.parse(readFileSync(fixtures.evidencePath, "utf8")) as Record<string, unknown>;
    expect(updatedEvidence.recoveredLiveVersionId).toBe(lastGreenVersionId);
    expect(updatedEvidence.recovery).toBe("rolled_back_although_spawn_exited_nonzero");
    expect(typeof updatedEvidence.recoveredAt).toBe("string");
  });

  it("records the live version even when it skips recovery (target already 100% live)", () => {
    const fixtures = makeRunFixture();
    // Same-version case: the pre-deploy capture names the version the failed
    // deploy put at 100%, so there is nothing to recover.
    writeFileSync(
      fixtures.evidencePath,
      `${JSON.stringify({ ...rollbackEvidence, versionId: deployedVersionId }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    rmSync(fixtures.ledgerPath, { force: true });
    const result = spawnSync(
      process.execPath,
      [
        "scripts/rollback-production.mjs",
        "--target",
        fixtures.evidencePath,
        "--wrangler-output",
        fixtures.wranglerOutputPath,
      ],
      { cwd: repoRoot, env: { ...process.env, WRANGLER_BIN: fixtures.wranglerBin }, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const outcomeLines = (result.stdout ?? "")
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const recorded = outcomeLines.at(-1) ?? {};
    expect(recorded.recoveredLiveVersionId).toBe(deployedVersionId);
    expect(recorded.recovery).toBe("rollback_target_already_live");
    const updatedEvidence = JSON.parse(readFileSync(fixtures.evidencePath, "utf8")) as Record<string, unknown>;
    expect(updatedEvidence.recoveredLiveVersionId).toBe(deployedVersionId);
  });
});

describe("executeProductionDeployPlan (#3390: a recovered release must exit 0)", () => {
  const plan = (rollbackSucceeds: boolean) => [
    { id: "deploy" },
    { id: "post_deploy_release_canary" },
    { id: "partial_refund_invariants_postcanary" },
    { id: "rollback_failed_release", runOnPostDeployFailure: true },
    { id: "start_production_soak" },
    { id: "live_public_truth" },
    { id: "canary_bypass_token_sync", nonBlockingDiagnostic: true },
  ];

  it("continues past a recovered canary failure instead of rethrowing it", async () => {
    const { executeProductionDeployPlan } = await import("../scripts/deploy-production-plan.mjs");
    const called: string[] = [];
    expect(() =>
      executeProductionDeployPlan(plan(true) as never, (step: { id: string }) => {
        called.push(step.id);
        if (step.id === "post_deploy_release_canary") {
          const failure = new Error(
            "node scripts/verify-post-deploy-release.mjs --wrangler-output test-results/wrangler-deploy-output-x.jsonl failed",
          ) as Error & { exitCode: number };
          failure.exitCode = 1;
          throw failure;
        }
      }),
    ).not.toThrow();
    expect(called.indexOf("live_public_truth")).toBeGreaterThan(called.indexOf("post_deploy_release_canary"));
    expect(called.at(-1)).toBe("canary_bypass_token_sync");
  });

  it("keeps the AggregateError when recovery itself fails", async () => {
    const { executeProductionDeployPlan } = await import("../scripts/deploy-production-plan.mjs");
    expect(() =>
      executeProductionDeployPlan(plan(false) as never, (step: { id: string }) => {
        if (step.id === "post_deploy_release_canary" || step.id === "rollback_failed_release") {
          throw new Error("worker_rollback_failed");
        }
      }),
    ).toThrow("post_deploy_recovery_failed");
  });
});

describe("deploy-ledger.mjs records the LIVE version after a recovery (#3390)", () => {
  it("prefers the recovered live version over the deployed-then-rolled-back one", () => {
    const fixtures = makeRunFixture();
    writeFileSync(
      fixtures.evidencePath,
      `${JSON.stringify({ ...rollbackEvidence, recoveredLiveVersionId: lastGreenVersionId, recovery: "rolled_back" }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const row = spawnSync(
      process.execPath,
      [
        "scripts/deploy-ledger.mjs",
        "row",
        "--sha",
        "30ce8ff42f9f6c36229200dcdd9c13d10515d1dd",
        "--tree",
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
        "--wrangler-output",
        fixtures.wranglerOutputPath,
        "--rollback-evidence",
        fixtures.evidencePath,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(row.status).toBe(0);
    const parsed = JSON.parse((row.stdout ?? "").trim()) as Record<string, unknown>;
    expect(parsed.version_id).toBe(lastGreenVersionId);
  });

  it("keeps the wrangler-output version when the evidence carries no recovery outcome", () => {
    const fixtures = makeRunFixture();
    const row = spawnSync(
      process.execPath,
      [
        "scripts/deploy-ledger.mjs",
        "row",
        "--sha",
        "30ce8ff42f9f6c36229200dcdd9c13d10515d1dd",
        "--tree",
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
        "--wrangler-output",
        fixtures.wranglerOutputPath,
        "--rollback-evidence",
        fixtures.evidencePath,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(row.status).toBe(0);
    const parsed = JSON.parse((row.stdout ?? "").trim()) as Record<string, unknown>;
    expect(parsed.version_id).toBe(deployedVersionId);
  });
});
