import { describe, expect, it, vi } from "vitest";

import {
  classifyScheduledTaskResult,
  observeScheduledTask,
  recordReleaseScheduledObservation,
  safeScheduledFailureCategory,
} from "~/lib/release-scheduled-observation.server";

function context() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
  };
}

describe("release scheduled observations", () => {
  it("returns the exact original promise and records on a separate branch", async () => {
    const { pending, ctx } = context();
    const record = vi.fn().mockResolvedValue(undefined);
    const task = Promise.resolve({ queued: 1, duplicates: 0, inlineRuns: 0, inlineFailures: 0, skippedForBudget: 0, skippedForBilling: 0, dispatchFailures: 0, digests: 0 });
    const observed = observeScheduledTask(
      { CF_VERSION_METADATA: { id: "worker-v1" } } as never,
      ctx as never,
      { cron: "0 */3 * * *", scheduledTime: Date.parse("2026-07-19T06:00:00.000Z"), taskName: "scheduled_monitoring" },
      task,
      {
        record,
        now: vi.fn()
          .mockReturnValueOnce(new Date("2026-07-19T06:00:00.100Z"))
          .mockReturnValueOnce(new Date("2026-07-19T06:00:01.100Z")),
      },
    );

    expect(observed).toBe(task);
    expect(pending).toHaveLength(1);
    await Promise.all([observed, ...pending]);
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      taskName: "scheduled_monitoring",
      outcome: "completed",
      metrics: expect.objectContaining({ queued: 1, dispatchFailures: 0 }),
    }));
  });

  it("preserves the original rejection when observation persistence fails", async () => {
    const { pending, ctx } = context();
    const original = new Error("secret customer id should never persist");
    const task = Promise.reject(original);
    const logObservationFailure = vi.fn();
    const observed = observeScheduledTask(
      {} as never,
      ctx as never,
      { cron: "17 */6 * * *", scheduledTime: Date.parse("2026-07-19T06:17:00.000Z"), taskName: "discovery_warmup" },
      task,
      {
        record: vi.fn().mockRejectedValue(new Error("D1 unavailable token=secret")),
        logObservationFailure,
      },
    );

    expect(observed).toBe(task);
    await expect(observed).rejects.toBe(original);
    await Promise.all(pending);
    expect(logObservationFailure).toHaveBeenCalledWith("discovery_warmup");
  });

  it("binds only sanitized allowlisted values", async () => {
    const bindings: unknown[][] = [];
    const env = {
      CF_VERSION_METADATA: { id: "worker-v1" },
      DB: {
        prepare: vi.fn(() => ({
          bind: (...values: unknown[]) => {
            bindings.push(values);
            return { run: vi.fn().mockResolvedValue({ success: true }) };
          },
        })),
      },
    };
    await recordReleaseScheduledObservation(env as never, {
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-07-19T06:00:00.000Z"),
      taskName: "scheduled_monitoring",
      startedAt: new Date("2026-07-19T06:00:00.000Z"),
      completedAt: new Date("2026-07-19T06:00:01.000Z"),
      outcome: "completed",
      failureCategory: null,
      metrics: { queued: 1, sent: false },
    }, { randomUUID: () => "12345678-1234-1234-1234-123456789abc" });

    const serialized = JSON.stringify(bindings);
    expect(serialized).toContain("worker-v1");
    expect(serialized).toContain('\\"queued\\":1');
    expect(serialized).not.toContain("customer");
    expect(serialized).not.toContain("@example");
    expect(serialized).not.toContain("http");
  });

  it("classifies only bounded task-specific aggregates", () => {
    expect(classifyScheduledTaskResult("scheduled_monitoring", {
      queued: 3,
      duplicates: 0,
      inlineRuns: 0,
      inlineFailures: 0,
      skippedForBudget: 1,
      skippedForBilling: 0,
      dispatchFailures: 0,
      digests: 0,
      customerId: "private",
      error: "token=secret",
    })).toMatchObject({ outcome: "degraded", metrics: { queued: 3, skippedForBudget: 1 } });
    expect(classifyScheduledTaskResult("discovery_warmup", { attempted: 0, failed: 0 })).toMatchObject({ outcome: "no_work" });
    expect(classifyScheduledTaskResult("billing_lifecycle_email_recovery", {
      claimed: 1,
      failed: 1,
      providerUnknown: 1,
      conflicts: 1,
    })).toMatchObject({ outcome: "degraded", metrics: { failed: 1, providerUnknown: 1, conflicts: 1 } });
    expect(classifyScheduledTaskResult("instant_alert_flush", { groups: 0, attempts: 0, failures: 2 }))
      .toMatchObject({ outcome: "degraded", metrics: { failures: 2 } });
    expect(classifyScheduledTaskResult("scheduled_monitoring", { queued: 0, duplicates: 1 }))
      .toMatchObject({ outcome: "no_work", metrics: { duplicates: 1 } });
    expect(classifyScheduledTaskResult("scheduled_monitoring", { digests: 2, digestAttempts: 3, digestFailures: 1 }))
      .toMatchObject({ outcome: "degraded", metrics: { digests: 2, digestAttempts: 3, digestFailures: 1 } });
    expect(classifyScheduledTaskResult("digest_schedule_recovery", { attempted: 2, sent: 1, failed: 1 }))
      .toMatchObject({ outcome: "degraded", metrics: { attempted: 2, digests: 1, failures: 1 } });
    expect(classifyScheduledTaskResult("weekly_business_numbers", { sent: false, reason: "duplicate" }))
      .toMatchObject({ outcome: "no_work", metrics: { sent: false } });
    expect(classifyScheduledTaskResult("weekly_business_numbers", { sent: false, reason: "delivery_failed" }))
      .toMatchObject({ outcome: "degraded", metrics: { sent: false } });
    expect(classifyScheduledTaskResult("customer_at_risk_alert", {
      sent: false,
      reason: "duplicate",
      signals: 2,
    })).toMatchObject({ outcome: "no_work", metrics: { sent: false, signals: 2 } });
    expect(classifyScheduledTaskResult("customer_at_risk_alert", {
      sent: false,
      reason: "delivery_failed",
      signals: 2,
    })).toMatchObject({ outcome: "degraded", metrics: { sent: false, signals: 2 } });
    expect(classifyScheduledTaskResult("digest_schedule_exhaustion_recovery", {
      attempted: 1,
      alerted: 0,
      failed: 1,
    })).toMatchObject({ outcome: "degraded", metrics: { attempted: 1, alerted: 0, failures: 1 } });
    expect(classifyScheduledTaskResult("presence_polling_batch", { polled: 2, results: [{ ok: true, targetId: "private" }, { ok: false, errorCode: "private" }] })).toMatchObject({ outcome: "degraded", metrics: { polled: 2, failed: 1 } });
    expect(classifyScheduledTaskResult("monitoring_fanout_reconciliation", {
      recovered: 0,
      redispatched: 0,
      redispatchFailures: 2,
      firstScans: { failures: 0 },
    })).toMatchObject({
      outcome: "degraded",
      metrics: { redispatchFailures: 2 },
    });
    expect(JSON.stringify(classifyScheduledTaskResult("presence_polling_batch", { polled: 1, results: [{ ok: true, targetId: "private" }] }))).not.toContain("private");
  });

  it("records scheduled-monitoring degradation without sending a duplicate generic page", async () => {
    const { pending, ctx } = context();
    const reportDegraded = vi.fn().mockResolvedValue(undefined);
    const task = Promise.resolve({
      queued: 0,
      inlineFailures: 1,
      skippedForBudget: 0,
      dispatchFailures: 0,
      digestFailures: 0,
    });

    await observeScheduledTask(
      {} as never,
      ctx as never,
      {
        cron: "0 */3 * * *",
        scheduledTime: Date.parse("2026-07-19T06:00:00.000Z"),
        taskName: "scheduled_monitoring",
      },
      task,
      {
        record: vi.fn().mockResolvedValue(undefined),
        reportDegraded,
      },
    );
    await Promise.all(pending);

    expect(reportDegraded).not.toHaveBeenCalled();
  });

  it("actively reports fulfilled degradation without a dedicated worker page", async () => {
    const { pending, ctx } = context();
    const reportDegraded = vi.fn().mockResolvedValue(undefined);

    await observeScheduledTask(
      {} as never,
      ctx as never,
      {
        cron: "17 */6 * * *",
        scheduledTime: Date.parse("2026-07-19T06:17:00.000Z"),
        taskName: "instant_alert_flush",
      },
      Promise.resolve({ groups: 1, failures: 1 }),
      {
        record: vi.fn().mockResolvedValue(undefined),
        reportDegraded,
      },
    );
    await Promise.all(pending);

    expect(reportDegraded).toHaveBeenCalledWith("instant_alert_flush");
  });

  it("keeps degraded-page failure separate from successful observation persistence", async () => {
    const { pending, ctx } = context();
    const record = vi.fn().mockResolvedValue(undefined);
    const logObservationFailure = vi.fn();
    const logDegradedReportFailure = vi.fn();

    await observeScheduledTask(
      {} as never,
      ctx as never,
      {
        cron: "17 */6 * * *",
        scheduledTime: Date.parse("2026-07-19T06:17:00.000Z"),
        taskName: "instant_alert_flush",
      },
      Promise.resolve({ groups: 1, failures: 1 }),
      {
        record,
        reportDegraded: vi.fn().mockRejectedValue(new Error("page failed")),
        logObservationFailure,
        logDegradedReportFailure,
      },
    );
    await Promise.all(pending);

    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "degraded" }),
    );
    expect(logObservationFailure).not.toHaveBeenCalled();
    expect(logDegradedReportFailure).toHaveBeenCalledWith(
      "instant_alert_flush",
    );
  });

  it("reduces thrown values to stable categories", () => {
    const timeout = new Error("private");
    timeout.name = "TimeoutError";
    expect(safeScheduledFailureCategory(timeout)).toBe("timeout");
    expect(safeScheduledFailureCategory(new Error("private"))).toBe("runtime_error");
    expect(safeScheduledFailureCategory("private")).toBe("non_error_throw");
  });

  it("accepts every configured cron including the named weekly schedule", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const env = {
      CF_VERSION_METADATA: { id: "worker-v1" },
      DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })) },
    };
    await recordReleaseScheduledObservation(env as never, {
      cron: "0 5 * * MON",
      scheduledTime: Date.parse("2026-07-20T05:00:00.000Z"),
      taskName: "weekly_business_numbers",
      startedAt: new Date("2026-07-20T05:00:00.000Z"),
      completedAt: new Date("2026-07-20T05:00:01.000Z"),
      outcome: "no_work",
      failureCategory: null,
      metrics: { sent: false },
    }, { randomUUID: () => "12345678-1234-1234-1234-123456789abc" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects scheduled timestamps beyond the allowed future skew", async () => {
    const env = {
      CF_VERSION_METADATA: { id: "worker-v1" },
      DB: { prepare: vi.fn() },
    };

    await expect(recordReleaseScheduledObservation(env as never, {
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-07-20T05:10:00.001Z"),
      taskName: "scheduled_monitoring",
      startedAt: new Date("2026-07-20T05:00:00.000Z"),
      completedAt: new Date("2026-07-20T05:05:00.000Z"),
      outcome: "no_work",
      failureCategory: null,
      metrics: {},
    })).rejects.toThrow("unsafe_release_soak_future_scheduled_time");
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });
});
