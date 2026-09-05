import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runVersionBoundGateC, sanitizeProofDiagnostics, defaultHealthAnchor } = await import("../scripts/verify-post-deploy-release.mjs");
const { createDeferredBackupDisposition } = await import(
  "../scripts/deploy-production-plan.mjs"
);
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
    proofEmail: {
      gateRunId: "gate-c-worker-v1",
      dispatchStartedAt: "2026-07-18T00:00:00.000Z",
      subject: "0509 Gate C proof gate-c-worker-v1",
      provider: {
        status: "sent",
        accepted: true,
        messageId: "provider-message-1",
        error: null,
      },
    },
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

const PRODUCTION_HEALTH_URLS = [
  "https://0509.io/api/health",
  "https://www.0509.io/api/health",
  "https://api.0509.io/api/health",
];

function releaseCompatibleProductionMetaReport(options: {
  blockers?: string[];
  digestAttempts?: number;
  digestSent?: number;
  emailAttempts?: number;
  emailSent?: number;
  latestAttemptAt?: string | null;
  healthOk?: boolean;
  blockingFailures?: unknown[];
  metaStatus?: string;
  metaReadinessOk?: boolean;
} = {}) {
  const healthChecks = PRODUCTION_HEALTH_URLS.map((url) => ({
    ok: options.healthOk ?? true,
    status: 200,
    app: "0509",
    expectedApp: "0509",
    expectedWorkerVersionId: "worker-v1",
    expectedSearchRolloutMode: "v2",
    releaseIdentity: {
      workerVersionId: "worker-v1",
      tag: null,
      timestamp: "2026-07-18T00:00:00.000Z",
      searchRolloutMode: "v2",
    },
    releaseIdentityOk: true,
    message: null,
    url,
  }));
  const blockingFailures = options.blockingFailures ?? [];
  const metaStatus = options.metaStatus ?? "ok";
  const metaReadinessOk = options.metaReadinessOk ?? true;
  return {
    passed: false,
    generatedAt: "2026-07-18T00:00:01.000Z",
    baseUrl: "https://0509.io",
    health: healthChecks[0],
    healthChecks,
    expectedWorkerVersionId: "worker-v1",
    expectedSearchRolloutMode: "v2",
    launchReadiness: {
      ok: false,
      status: 503,
      message: "no_recent_email_delivery_attempt, no_recent_email_sent",
      url: "https://0509.io/api/launch-readiness",
      blockers: options.blockers ?? [
        "no_recent_email_delivery_attempt",
        "no_recent_email_sent",
      ],
      signals: {
        digestDelivery: {
          recentAttempts: options.digestAttempts ?? 0,
          recentSent: options.digestSent ?? 0,
          latestAttemptAt: null,
        },
        emailDelivery: {
          recentAttempts: options.emailAttempts ?? 3,
          recentSent: options.emailSent ?? 3,
          latestAttemptAt:
            options.latestAttemptAt === undefined
              ? "2026-07-18T00:00:00.131Z"
              : options.latestAttemptAt,
        },
      },
      metaAdsBeta: { ok: metaReadinessOk, blockers: [] },
    },
    queries: ["nykaa"],
    country: "India",
    mode: "advertiser",
    requireFreshLive: true,
    freshLiveBypass: {
      required: true,
      configured: true,
      proved: true,
      message: null,
    },
    blockingFailures,
    metaAdsBeta: {
      beta: true,
      strict: false,
      status: metaStatus,
      failures: blockingFailures,
      readiness: { ok: metaReadinessOk },
    },
    results: [],
  };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("sanitizeProofDiagnostics", () => {
  it("keeps only identifier-safe blocker/delivery fields and drops anything address-shaped", () => {
    const diagnostics = sanitizeProofDiagnostics({
      ok: false,
      // recipient/body/token style fields must never survive
      recipient: "someone@example.com",
      messageBody: "Your weekly digest…",
      token: "secret-token",
      blockers: ["no_digest_delivery_sent", "INVALID BLOCKER!", 42],
      delivery: {
        attempts: 2,
        channels: ["email", "whatsapp"],
        details: [
          {
            channel: "email",
            status: "unknown",
            webhookStatus: "provider_unknown",
            deliveredAt: "2026-07-20T00:00:00.000Z",
            recipient: "someone@example.com",
          },
        ],
      },
    });
    expect(diagnostics).toEqual({
      blockers: ["no_digest_delivery_sent"],
      delivery: {
        attempts: 2,
        channels: ["email", "whatsapp"],
        details: [{ channel: "email", status: "unknown", webhookStatus: "provider_unknown" }],
      },
    });
    // Nothing address/body/token-shaped may appear anywhere in the output.
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("digest…");
    expect(serialized).not.toContain("deliveredAt");
  });

  it("returns null when there is nothing safe to report", () => {
    expect(sanitizeProofDiagnostics(undefined)).toBeNull();
    expect(sanitizeProofDiagnostics({ ok: false })).toBeNull();
    expect(sanitizeProofDiagnostics({ ok: false, blockers: [], delivery: {} })).toBeNull();
  });
});

describe("defaultHealthAnchor (stabilized identity anchor)", () => {
  const HOSTS = ["https://0509.io", "https://www.0509.io", "https://api.0509.io"];
  const instantDelay = () => Promise.resolve();

  type HealthProbeArgs = {
    baseUrl?: string;
    expectedWorkerVersionId?: string | null;
    expectedSearchRolloutMode?: string | null;
  };
  type HealthImpl = NonNullable<Parameters<typeof defaultHealthAnchor>[0]["checkHealthImpl"]>;

  it("resets on a flapping sample then passes after 3 consecutive all-alias OKs", async () => {
    // The first probe of the "flapping" alias fails (lagging edge colo), which
    // must reset the consecutive counter; convergence then needs THREE clean
    // all-alias samples — proving a single fresh-connection snapshot is no
    // longer sufficient (attempt-18 root cause).
    const callsByHost = new Map<string, number>();
    const checkHealthImpl = vi.fn(async ({ baseUrl }: HealthProbeArgs) => {
      const host = baseUrl ?? "";
      const count = (callsByHost.get(host) ?? 0) + 1;
      callsByHost.set(host, count);
      const flapping = host === "https://www.0509.io" && count === 1;
      return { ok: !flapping };
    });

    const result = await defaultHealthAnchor({
      workerVersionId: "worker-v1",
      checkHealthImpl: checkHealthImpl as unknown as HealthImpl,
      delayImpl: instantDelay,
      maxSamples: 20,
      requiredConsecutive: 3,
    });

    expect(result.ok).toBe(true);
    expect(result.hosts).toEqual(HOSTS.map((url) => ({ url, ok: true })));
    // The flapping reset means at least 4 samples were needed (1 failed + 3 clean),
    // not the 3 a single-shot / non-resetting sampler would have accepted.
    expect(callsByHost.get("https://www.0509.io")).toBeGreaterThanOrEqual(4);
  });

  it("fails closed with the preserved worker-identity error when it never converges", async () => {
    // One alias never serves the exact version → the bounded waiter throws
    // launch_readiness_worker_propagation_not_stable, which the anchor surfaces
    // as { ok:false }, so the surrounding step machinery still emits the exact
    // identity_pre_failed / identity_post_failed identifiers downstream.
    const checkHealthImpl = vi.fn(async ({ baseUrl }: HealthProbeArgs) => ({
      ok: baseUrl !== "https://api.0509.io",
    }));

    const result = await defaultHealthAnchor({
      workerVersionId: "worker-v1",
      checkHealthImpl: checkHealthImpl as unknown as HealthImpl,
      delayImpl: instantDelay,
      maxSamples: 5,
      maxWaitMs: 1_000,
      requiredConsecutive: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("worker_identity_not_stable");
    // Never accepted: consecutive never reached the required streak.
    expect(checkHealthImpl.mock.calls.length).toBeGreaterThan(0);
  });

  it("enforces the exact worker version and v2 rollout mode on every alias, every sample", async () => {
    const checkHealthImpl = vi.fn(async (_args: HealthProbeArgs) => ({ ok: true }));

    const result = await defaultHealthAnchor({
      workerVersionId: "worker-v1",
      checkHealthImpl: checkHealthImpl as unknown as HealthImpl,
      delayImpl: instantDelay,
      maxSamples: 20,
      requiredConsecutive: 3,
    });

    expect(result.ok).toBe(true);
    // All three aliases probed, each with the exact deployed version + v2 rollout.
    for (const url of HOSTS) {
      expect(checkHealthImpl).toHaveBeenCalledWith({
        baseUrl: url,
        expectedWorkerVersionId: "worker-v1",
        expectedSearchRolloutMode: "v2",
      });
    }
    // Every recorded probe carried the exact-version + v2 rollout assertion.
    for (const [args] of checkHealthImpl.mock.calls) {
      expect(args).toMatchObject({
        expectedWorkerVersionId: "worker-v1",
        expectedSearchRolloutMode: "v2",
      });
    }
  });
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

  it("runs the exact deferred immediate gate once without backup lifecycle or soak evidence", async () => {
    const releaseSha = "f".repeat(40);
    const backupLifecycle = vi.fn(async () => ({
      ok: true,
      report: backupReport(),
    }));
    const proof = vi.fn(async () => ({ ok: true, payload: proofPayload() }));
    const cleanup = vi.fn(async () => ({ ok: true }));
    const path = evidencePath();

    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      releaseSha,
      backupProofStatus: "deferred",
      backupProofDisposition: createDeferredBackupDisposition(
        releaseSha,
        "a".repeat(40),
      ),
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle,
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof,
        productionCanary: vi.fn(async () => ({
          ok: true,
          report: { passed: true },
        })),
        cleanup,
      },
    });

    expect(result.passed).toBe(true);
    expect(backupLifecycle).not.toHaveBeenCalled();
    expect(proof).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    const journal = JSON.parse(readFileSync(path, "utf8"));
    expect(journal).toMatchObject({
      gatePhase: "immediate",
      backupProofStatus: "deferred",
      status: "passed",
      steps: {
        proof_email: {
          status: "passed",
          detail: {
            gateRunId: "gate-c-worker-v1",
            dispatchStartedAt: "2026-07-18T00:00:00.000Z",
            subject: "0509 Gate C proof gate-c-worker-v1",
          },
        },
        proof_cleanup: { status: "passed" },
      },
    });
    expect(Object.keys(journal.steps)).not.toContain("backup_lifecycle");
    expect(journal.backupLifecycleSummary).toBeUndefined();
    expect(Object.keys(journal.steps.proof_email.detail).sort()).toEqual([
      "dispatchStartedAt",
      "gateRunId",
      "subject",
    ]);
    expect(JSON.stringify(journal.steps.proof_email.detail)).not.toMatch(
      /accepted|messageId|error|provider/u,
    );
  });

  it("accepts only the same-run proof for the exact digest-only production-meta gap", async () => {
    const productionCanary = vi.fn(async () => ({
      ok: false,
      report: releaseCompatibleProductionMetaReport(),
    }));
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: evidencePath(),
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => ({ ok: true, payload: proofPayload() })),
        productionCanary,
        cleanup: vi.fn(async () => ({ ok: true })),
      },
    });

    expect(result.passed).toBe(true);
    expect(result.journal.steps.production_meta?.status).toBe("passed");
    expect(result.journal.productionSummary).toContain(
      "release compatibility: same-run internal proof accepted; customer digest readiness remains blocked",
    );
    expect(result.journal.productionSummary).toContain("ops readiness: failed");
    expect(productionCanary).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "an extra blocker",
      { blockers: ["no_recent_email_delivery_attempt", "no_recent_email_sent", "no_recent_monitoring_run"] },
    ],
    ["missing generic email attempt", { emailAttempts: 0 }],
    ["missing generic email acceptance", { emailSent: 0 }],
    ["nonzero customer digest activity", { digestAttempts: 1 }],
    ["a stale generic email attempt", { latestAttemptAt: "2026-07-17T23:59:59.999Z" }],
    ["a malformed generic email timestamp", { latestAttemptAt: "not-a-timestamp" }],
    ["a failed exact-worker health check", { healthOk: false }],
    ["a fresh-live search failure", { blockingFailures: [{ query: "nykaa", status: "empty" }] }],
    ["a Meta readiness failure", { metaStatus: "needs_proof", metaReadinessOk: false }],
  ])("keeps production meta fatal for %s", async (_label, reportOptions) => {
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: evidencePath(),
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => ({ ok: true, payload: proofPayload() })),
        productionCanary: vi.fn(async () => ({
          ok: false,
          report: releaseCompatibleProductionMetaReport(reportOptions),
        })),
        cleanup: vi.fn(async () => ({ ok: true })),
      },
    });

    expect(result.passed).toBe(false);
    expect(result.journal.errors).toContain("production_meta_failed");
  });

  it.each([undefined, "not-a-timestamp"])(
    "does not run production meta when proof T0 is %s",
    async (dispatchStartedAt) => {
      const payload = proofPayload();
      if (dispatchStartedAt === undefined) {
        delete (payload.proofEmail as { dispatchStartedAt?: string }).dispatchStartedAt;
      } else {
        payload.proofEmail.dispatchStartedAt = dispatchStartedAt;
      }
      const productionCanary = vi.fn();
      const result = await runVersionBoundGateC({
        workerVersionId: "worker-v1",
        token: "token",
        evidencePath: evidencePath(),
        dependencies: {
          healthAnchor: vi.fn(async () => ({ ok: true })),
          backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
          pricing: vi.fn(async () => ({ ok: true })),
          billing: vi.fn(async () => ({ ok: true })),
          proof: vi.fn(async () => ({ ok: true, payload })),
          productionCanary,
          cleanup: vi.fn(async () => ({ ok: true })),
        },
      });

      expect(result.passed).toBe(false);
      expect(result.journal.errors).toContain("proof_email_dispatch_invalid");
      expect(productionCanary).not.toHaveBeenCalled();
    },
  );

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

  it("cleans a partial proof failure by gate ID when no digest ticket exists", async () => {
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
        proof: vi.fn(async () => ({
          ok: false,
          payload: {
            ok: false,
            gateRunId: "gate-c-worker-v1",
            runId: "run-loser",
            proofCaptureId: "proof-loser",
            blockers: ["digest_period_claim_conflict"],
            proofEmail: {
              gateRunId: "gate-c-worker-v1",
              dispatchStartedAt: "2026-07-18T00:00:00.000Z",
              subject: "0509 Gate C proof gate-c-worker-v1",
              provider: {
                status: "failed",
                accepted: false,
                messageId: null,
                error: "provider rejected the message",
              },
            },
          },
        })),
        productionCanary: vi.fn(),
        cleanup,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.journal.errors).toContain("proof_email_failed");
    expect(result.journal.errors).not.toContain("proof_cleanup_ticket_missing");
    expect(cleanup).toHaveBeenCalledWith({
      ticket: null,
      gateRunId: "gate-c-worker-v1",
      token: "token",
    });
  });

  it("persists identifier-safe proof blockers and sanitized delivery on proof failure", async () => {
    const path = evidencePath();
    const productionCanary = vi.fn();
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        pricing: vi.fn(async () => ({ ok: true })),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => ({
          ok: false,
          payload: {
            ok: false,
            gateRunId: "gate-c-worker-v1",
            runId: "run-1",
            digestRunId: "digest-1",
            proofCaptureId: "proof-1",
            blockers: ["no_digest_delivery_sent"],
            proofEmail: {
              gateRunId: "gate-c-worker-v1",
              dispatchStartedAt: "2026-07-18T00:00:00.000Z",
              subject: "0509 Gate C proof gate-c-worker-v1",
              provider: {
                status: "pending",
                accepted: false,
                messageId: null,
                error: null,
              },
            },
            // The route already sanitizes this via sanitizeDeliveryForCanary.
            delivery: {
              attempts: 1,
              channels: ["email"],
              details: [{ channel: "email", status: "unknown", webhookStatus: "provider_unknown", deliveredAt: null }],
            },
          },
        })),
        productionCanary,
        cleanup: vi.fn(async () => ({ ok: true })),
      },
    });

    expect(result.passed).toBe(false);
    expect(result.journal.errors).toContain("proof_email_failed");
    expect(productionCanary).not.toHaveBeenCalled();
    // Gate C is NOT weakened: this proof failed, and it stays failed.
    const journal = JSON.parse(readFileSync(path, "utf8"));
    expect(journal.proofDiagnostics).toEqual({
      blockers: ["no_digest_delivery_sent"],
      delivery: {
        attempts: 1,
        channels: ["email"],
        // Only identifier-safe fields survive — no deliveredAt, no addresses.
        details: [{ channel: "email", status: "unknown", webhookStatus: "provider_unknown" }],
      },
    });
    expect(result.journal.proofDiagnostics).toEqual(journal.proofDiagnostics);
  });

  it("recovers an interrupted proof by stable gate ID without repeating provider work", async () => {
    const path = evidencePath();
    const existing = {
      schemaVersion: 1,
      generatedAt: "2026-07-18T00:00:00.000Z",
      workerVersionId: "worker-v1",
      searchRolloutMode: "v2",
      gateRunId: "gate-c-worker-v1",
      gatePhase: "immediate",
      backupProofStatus: "required",
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
      searchRolloutMode: "v2",
      gateRunId: "gate-c-worker-v1",
      gatePhase: "immediate",
      backupProofStatus: "required",
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
      searchRolloutMode: "v2",
      gateRunId: "gate-c-worker-v1",
      gatePhase: "immediate",
      backupProofStatus: "required",
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
    const base: any = {
      schemaVersion: 1,
      generatedAt: "2026-07-16T00:00:00.000Z",
      completedAt: "2026-07-16T00:01:00.000Z",
      workerVersionId: "worker-v1",
      searchRolloutMode: "v2",
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
      gatePhase: "immediate",
      backupProofStatus: "required",
    };
    base.steps.proof_email = {
      status: "passed",
      at: "2026-07-16T00:00:00.000Z",
      detail: proofPayload().proofEmail && {
        gateRunId: proofPayload().proofEmail.gateRunId,
        dispatchStartedAt: proofPayload().proofEmail.dispatchStartedAt,
        subject: proofPayload().proofEmail.subject,
      },
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

const { defaultPricing } = await import("../scripts/verify-post-deploy-release.mjs");

describe("defaultPricing bounded retry (run 29852903771 rollback class)", () => {

  it("passes when a one-shot transient (stale-PoP version mismatch) succeeds on retry", async () => {
    const calls: Record<string, number> = {};
    const fetcher = vi.fn(async ({ country }: { country: string }) => {
      calls[country] = (calls[country] ?? 0) + 1;
      // US hits an edge PoP still serving the previous worker on attempt 1.
      if (country === "US" && calls[country] === 1) {
        return { requestedCountry: country, ok: false, status: 200, reason: "worker_version_mismatch" };
      }
      return { requestedCountry: country, ok: true, status: 200, reason: "" };
    });
    const result = await defaultPricing({
      workerVersionId: "worker-v1",
      token: "token",
      fetcher,
      sleeper: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual({ IN: 1, US: 2, GB: 1 });
  });

  it("still fails closed when a country fails every attempt (no gate weakening)", async () => {
    const fetcher = vi.fn(async ({ country }: { country: string }) =>
      country === "GB"
        ? { requestedCountry: country, ok: false, status: 200, reason: "plan_price_invalid" }
        : { requestedCountry: country, ok: true, status: 200, reason: "" });
    const result = await defaultPricing({
      workerVersionId: "worker-v1",
      token: "token",
      attempts: 3,
      fetcher,
      sleeper: async () => {},
    });
    expect(result.ok).toBe(false);
    const gb = result.results.find((entry: { requestedCountry?: string }) => entry.requestedCountry === "GB");
    expect(gb).toMatchObject({ ok: false, attempt: 3, reason: "plan_price_invalid" });
    expect(fetcher.mock.calls.filter(([input]) => input.country === "GB")).toHaveLength(3);
  });

  it("captures thrown fetch errors as bounded fetch_failed results and retries them", async () => {
    let threw = 0;
    const fetcher = vi.fn(async ({ country }: { country: string }) => {
      if (country === "IN" && threw === 0) {
        threw += 1;
        throw new Error("socket hang up");
      }
      return { requestedCountry: country, ok: true, status: 200, reason: "" };
    });
    const result = await defaultPricing({
      workerVersionId: "worker-v1",
      token: "token",
      fetcher,
      sleeper: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(threw).toBe(1);
  });
});

describe("gate step failure detail (evidence diagnosability)", () => {
  it("records the failing step's bounded result detail in the journal", async () => {
    const path = evidencePath();
    const pricingFailure = {
      ok: false,
      results: [
        { requestedCountry: "IN", ok: true, status: 200, attempt: 1 },
        { requestedCountry: "US", ok: false, status: 200, reason: "worker_version_mismatch", attempt: 3 },
        { requestedCountry: "GB", ok: true, status: 200, attempt: 1 },
      ],
    };
    const result = await runVersionBoundGateC({
      workerVersionId: "worker-v1",
      token: "token",
      evidencePath: path,
      dependencies: {
        healthAnchor: vi.fn(async () => ({ ok: true })),
        backupLifecycle: vi.fn(async () => ({ ok: true, report: backupReport() })),
        backupLifecycleRecheck: vi.fn(async () => ({ ok: true, report: backupReport() })),
        backupLifecycleCleanup: vi.fn(async () => ({ ok: true })),
        pricing: vi.fn(async () => pricingFailure),
        billing: vi.fn(async () => ({ ok: true })),
        proof: vi.fn(async () => ({ ok: true, payload: proofPayload() })),
        cleanup: vi.fn(async () => ({ ok: true })),
        productionCanary: vi.fn(async () => ({ ok: true, report: "ok" })),
      },
    });
    expect(result.passed).toBe(false);
    const journal = JSON.parse(readFileSync(path, "utf8"));
    expect(journal.errors).toContain("pricing_failed");
    expect(journal.steps.pricing.status).toBe("failed");
    expect(journal.steps.pricing.detail).toEqual(pricingFailure);
  });
});
