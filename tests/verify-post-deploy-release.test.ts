import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runVersionBoundGateC } = await import("../scripts/verify-post-deploy-release.mjs");
const roots: string[] = [];

function evidencePath() {
  const root = mkdtempSync(join(tmpdir(), "0509-gate-c-"));
  roots.push(root);
  return join(root, "gate-c.json");
}

function proofPayload() {
  return {
    ok: true,
    workerVersionId: "worker-v1",
    gateRunId: "gate-c-worker-v1",
    runId: "run-1",
    digestRunId: "digest-1",
    proofCaptureId: "proof-1",
  };
}

function backupReport() {
  return {
    ok: true,
    remoteObjectAbsent: true,
    lifecycleConfigSha256: "a".repeat(64),
    policySha256: "b".repeat(64),
  };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("version-bound Gate C orchestrator", () => {
  it("orders mutations, always cleans proof state, and bookends exact version checks", async () => {
    const order: string[] = [];
    const path = evidencePath();
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: vi.fn(async () => { order.push("identity"); return { ok: true }; }),
        backupLifecycle: vi.fn(async () => { order.push("backup"); return { ok: true, report: backupReport() }; }),
        pricing: vi.fn(async () => { order.push("pricing"); return { ok: true }; }),
        billing: vi.fn(async () => { order.push("billing"); return { ok: true }; }),
        proof: vi.fn(async () => { order.push("proof"); return { ok: true, payload: proofPayload() }; }),
        productionCanary: vi.fn(async () => { order.push("production"); return { ok: true, report: { passed: true } }; }),
        cleanup: vi.fn(async () => { order.push("cleanup"); return { ok: true }; }),
      },
    });

    expect(result.passed).toBe(true);
    expect(order).toEqual(["identity", "backup", "pricing", "billing", "proof", "production", "cleanup", "identity"]);
    const journal = JSON.parse(readFileSync(path, "utf8"));
    expect(journal).toMatchObject({
      status: "passed",
      workerVersionId: "worker-v1",
      cleanupTicket: { runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" },
      errors: [],
    });
  });

  it("does not hide a primary failure and still runs cleanup and the final identity check", async () => {
    const order: string[] = [];
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: evidencePath(),
      dependencies: {
        healthAnchor: vi.fn(async () => { order.push("identity"); return { ok: true }; }),
        backupLifecycle: vi.fn(async () => { order.push("backup"); return { ok: true, report: backupReport() }; }),
        pricing: vi.fn(async () => { order.push("pricing"); return { ok: true }; }),
        billing: vi.fn(async () => { order.push("billing"); return { ok: true }; }),
        proof: vi.fn(async () => { order.push("proof"); return { ok: true, payload: proofPayload() }; }),
        productionCanary: vi.fn(async () => { order.push("production"); return { ok: false }; }),
        cleanup: vi.fn(async () => { order.push("cleanup"); return { ok: true }; }),
      },
    });

    expect(result.passed).toBe(false);
    expect(result.journal.errors).toContain("production_meta_failed");
    expect(order).toEqual(["identity", "backup", "pricing", "billing", "proof", "production", "cleanup", "identity"]);
  });

  it("captures cleanup identity before surfacing a partial proof failure", async () => {
    const cleanup = vi.fn(async () => ({ ok: true }));
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: evidencePath(),
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => ({ ok: false, payload: proofPayload() })),
        productionCanary: vi.fn(),
        cleanup,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.journal.errors).toContain("proof_email_failed");
    expect(cleanup).toHaveBeenCalledWith({
      ticket: { runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" },
      gateRunId: "gate-c-worker-v1",
      token: "token",
    });
  });

  it("recovers an interrupted proof by stable gate ID without repeating provider work", async () => {
    const path = evidencePath();
    const existing = {
      schemaVersion: 1,
      generatedAt: "2026-07-18T00:00:00.000Z",
      workerVersionId: "worker-v1",
      searchRolloutMode: "shadow",
      gateRunId: "gate-c-worker-v1",
      status: "running",
      steps: { proof_email: { status: "started", at: "2026-07-18T00:00:01.000Z" } },
      errors: [],
    };
    writeFileSync(path, JSON.stringify(existing));
    chmodSync(path, 0o600);
    const billing = vi.fn();
    const proof = vi.fn();
    const cleanup = vi.fn(async () => ({ ok: true }));

    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        billing,
        proof,
        cleanup,
      },
    });
    expect(result.passed).toBe(false);
    expect(billing).not.toHaveBeenCalled();
    expect(proof).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith({
      ticket: null,
      gateRunId: "gate-c-worker-v1",
      token: "token",
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      status: "failed",
      steps: {
        proof_cleanup: { status: "passed" },
        identity_post: { status: "passed" },
      },
    });
  });

  it("removes an interrupted backup canary object without starting later provider work", async () => {
    const path = evidencePath();
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-07-18T00:00:00.000Z",
      workerVersionId: "worker-v1",
      searchRolloutMode: "shadow",
      gateRunId: "gate-c-worker-v1",
      status: "running",
      steps: { backup_lifecycle: { status: "started", at: "2026-07-18T00:00:01.000Z" } },
      errors: [],
    }));
    chmodSync(path, 0o600);
    const provider = vi.fn();
    const backupLifecycleCleanup = vi.fn(async () => ({ ok: true }));
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycleCleanup,
        pricing: provider,
        billing: provider,
        proof: provider,
        cleanup: provider,
        productionCanary: provider,
      },
    });
    expect(result.passed).toBe(false);
    expect(backupLifecycleCleanup).toHaveBeenCalledWith({ workerVersionId: "worker-v1" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("claims the journal exclusively so a concurrent invocation reaches no provider", async () => {
    const path = evidencePath();
    let releaseHealth!: (value: { ok: boolean }) => void;
    const heldHealth = new Promise<{ ok: boolean }>((resolve) => { releaseHealth = resolve; });
    const firstHealth = vi.fn()
      .mockImplementationOnce(() => heldHealth)
      .mockResolvedValue({ ok: true });
    const first = runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: firstHealth,
        pricing: vi.fn(),
        billing: vi.fn(),
        proof: vi.fn(),
        cleanup: vi.fn(),
        productionCanary: vi.fn(),
      },
    });
    await vi.waitFor(() => expect(firstHealth).toHaveBeenCalledTimes(1));

    const provider = vi.fn();
    await expect(runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: vi.fn(),
        pricing: provider,
        billing: provider,
        proof: provider,
        cleanup: provider,
        productionCanary: provider,
      },
    })).rejects.toThrow("gate_c_existing_journal_active");
    expect(provider).not.toHaveBeenCalled();
    releaseHealth({ ok: false });
    await first;
  });

  it("uses stable cleanup identity when proof throws before returning IDs", async () => {
    const cleanup = vi.fn(async () => ({ ok: true }));
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: evidencePath(),
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => { throw new Error("network_lost_after_mutation"); }),
        cleanup,
        productionCanary: vi.fn(),
      },
    });
    expect(result.passed).toBe(false);
    expect(cleanup).toHaveBeenCalledWith({
      ticket: null,
      gateRunId: "gate-c-worker-v1",
      token: "token",
    });
  });

  it("rejects an incomplete passed journal before any provider or identity call", async () => {
    const path = evidencePath();
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-07-18T00:00:00.000Z",
      workerVersionId: "worker-v1",
      searchRolloutMode: "shadow",
      gateRunId: "gate-c-worker-v1",
      status: "passed",
      steps: {},
      errors: [],
    }));
    chmodSync(path, 0o600);
    const provider = vi.fn();
    await expect(runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: { healthAnchor: provider, proof: provider, cleanup: provider },
    })).rejects.toThrow("gate_c_existing_passed_journal_incomplete");
    expect(provider).not.toHaveBeenCalled();
  });

  it("rechecks exact deployed identity before reusing complete passed evidence", async () => {
    const path = evidencePath();
    await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => ({ ok: true, payload: proofPayload() })),
        productionCanary: vi.fn(async () => ({ ok: true, report: { passed: true } })),
        cleanup: vi.fn(async () => ({ ok: true })),
      },
    });
    const provider = vi.fn();
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        backupLifecycleRecheck: vi.fn(async () => ({ ok: true, report: backupReport() })),
        healthAnchor: vi.fn(async () => ({ ok: false })),
        pricing: provider,
        billing: provider,
        proof: provider,
        cleanup: provider,
        productionCanary: provider,
      },
    });
    expect(result.passed).toBe(false);
    expect(result.journal.errors).toContain("identity_recheck_failed");
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects passed evidence older than 24 hours before any recheck", async () => {
    const path = evidencePath();
    const base = {
      schemaVersion: 1,
      generatedAt: "2026-07-16T00:00:00.000Z",
      completedAt: "2026-07-16T00:01:00.000Z",
      workerVersionId: "worker-v1",
      searchRolloutMode: "shadow",
      gateRunId: "gate-c-worker-v1",
      status: "passed",
      steps: Object.fromEntries([
        "identity_pre", "backup_lifecycle", "pricing", "billing", "proof_email",
        "production_meta", "proof_cleanup", "identity_post",
      ].map((name) => [name, { status: "passed", at: "2026-07-16T00:00:00.000Z" }])),
      errors: [],
      cleanupTicket: { runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" },
      productionSummary: "passed",
      backupLifecycleSummary: backupReport(),
    };
    writeFileSync(path, JSON.stringify(base));
    chmodSync(path, 0o600);
    const recheck = vi.fn();
    await expect(runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      now: () => new Date("2026-07-18T00:00:01.000Z"),
      dependencies: { healthAnchor: recheck, backupLifecycleRecheck: recheck },
    })).rejects.toThrow("gate_c_existing_passed_journal_stale");
    expect(recheck).not.toHaveBeenCalled();
  });

  it("fails fresh passed evidence when the lifecycle hash drifts", async () => {
    const path = evidencePath();
    await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => ({ ok: true, payload: proofPayload() })),
        productionCanary: vi.fn(async () => ({ ok: true, report: { passed: true } })),
        cleanup: vi.fn(async () => ({ ok: true })),
      },
    });
    const laterProvider = vi.fn();
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      now: () => new Date("2026-07-18T00:05:00.000Z"),
      dependencies: {
        healthAnchor: laterProvider,
        backupLifecycleRecheck: vi.fn(async () => ({ ok: false })),
        pricing: laterProvider,
        billing: laterProvider,
        proof: laterProvider,
        cleanup: laterProvider,
        productionCanary: laterProvider,
      },
    });
    expect(result.passed).toBe(false);
    expect(result.journal.errors).toContain("backup_lifecycle_recheck_failed");
    expect(laterProvider).not.toHaveBeenCalled();
  });

  it("aborts before any mutation when the deployed identity is wrong", async () => {
    const billing = vi.fn();
    const proof = vi.fn();
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: evidencePath(),
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: false })),
        pricing: vi.fn(),
        billing,
        proof,
        productionCanary: vi.fn(),
        cleanup: vi.fn(),
      },
    });
    expect(result.passed).toBe(false);
    expect(billing).not.toHaveBeenCalled();
    expect(proof).not.toHaveBeenCalled();
  });
});
