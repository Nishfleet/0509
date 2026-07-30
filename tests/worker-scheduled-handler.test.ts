import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCOVERY_WARMUP_CRON } from "../workers/schedule";

const NORMAL_CRON = "0 * * * *";
const WARMUP_CRON = DISCOVERY_WARMUP_CRON;
const HEARTBEAT_CRON = "13 * * * *";

function createContext() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: {
      waitUntil(value: Promise<unknown>) {
        pending.push(value);
      },
    },
  };
}

async function loadWorker() {
  const runScheduledMonitoring = vi.fn().mockResolvedValue({
    skippedForBudget: 0,
    dispatchFailures: 0,
  });
  const runScheduledDiscoveryWarmup = vi.fn().mockResolvedValue({});
  const flushDeferredInstantAlerts = vi.fn().mockResolvedValue({ groups: 0 });
  const sendWeeklyBusinessNumbers = vi.fn().mockResolvedValue({ sent: false });
  const sendCustomerAtRiskAlert = vi.fn().mockResolvedValue({ sent: false });
  const scheduleBillingLifecycleEmailRecovery = vi.fn();
  const scheduleDigestScheduleExhaustionRecovery = vi.fn();
  const sendScheduledObservationHeartbeat = vi.fn().mockResolvedValue({
    sent: false,
    reason: "healthy",
    health: [],
  });
  const sendMonthlyCustomerRecaps = vi.fn().mockResolvedValue({
    sent: 0,
    skipped: 0,
  });
  const reportScheduledTaskFailure = vi.fn();
  const observeScheduledTask = vi.fn((
    _env: unknown,
    _ctx: unknown,
    _input: unknown,
    taskPromise: Promise<unknown>,
  ) => taskPromise);

  vi.doMock("../app/lib/monitoring.server", () => ({
    flushDeferredInstantAlerts,
    runScheduledDiscoveryWarmup,
    runScheduledMonitoring,
    sendCustomerAtRiskAlert,
    sendWeeklyBusinessNumbers,
  }));
  vi.doMock("../app/lib/cron-failure-alert.server", () => ({ reportScheduledTaskFailure }));
  vi.doMock("../app/lib/monthly-recap.server", () => ({ sendMonthlyCustomerRecaps }));
  vi.doMock("../app/lib/scheduled-observation-health.server", () => ({
    SCHEDULED_OBSERVATION_HEARTBEAT_CRON: HEARTBEAT_CRON,
    sendScheduledObservationHeartbeat,
  }));
  vi.doMock("../app/lib/release-scheduled-observation.server", () => ({ observeScheduledTask }));
  vi.doMock("../app/lib/monitoring-fanout.server", () => ({
    reconcileOrchestratedWatchlistRuns: vi.fn().mockResolvedValue({
      redispatched: 0,
      recovered: 0,
      cancelled: 0,
    }),
    resolveMonitoringFanoutMode: vi.fn().mockReturnValue("fanout"),
    resolveMonitoringOrchestrationLeaseMs: vi.fn().mockReturnValue(60_000),
  }));
  vi.doMock("../app/lib/presence-service.server", () => ({
    runPresencePollingBatch: vi.fn().mockResolvedValue({ results: [] }),
  }));
  vi.doMock("../app/lib/retention.server", () => ({
    runRetentionSweep: vi.fn().mockResolvedValue({ deleted: {} }),
  }));
  vi.doMock("../workers/delivery-recovery", () => ({ scheduleBillingLifecycleEmailRecovery }));
  vi.doMock("../workers/digest-schedule-recovery", () => ({
    scheduleDigestScheduleExhaustionRecovery,
  }));
  vi.doMock("../workers/schedule", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../workers/schedule")>()),
    resolveScheduledTask: vi.fn((cron: string) =>
      cron === WARMUP_CRON
        ? { kind: "discovery_warmup" }
        : {
            kind: "monitoring",
            includeScans: true,
            includeDigests: true,
            digestCadence: "weekly",
            digestLookbackDays: 7,
            includeRiskAlert: false,
          },
    ),
  }));
  vi.doMock("../workers/primary-domain", () => ({ primaryDomainRedirect: vi.fn().mockReturnValue(null) }));
  vi.doMock("../workers/security-headers", () => ({ withSecurityHeaders: vi.fn((response) => response) }));
  vi.doMock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class MonitoringWorkflow {} }));
  vi.doMock("../app/lib/rate-limit.server", () => ({ enforceRequestRateLimit: vi.fn().mockResolvedValue(null) }));

  const worker = await import("../workers/app");
  return {
    worker: worker.default,
    runScheduledMonitoring,
    runScheduledDiscoveryWarmup,
    flushDeferredInstantAlerts,
    scheduleBillingLifecycleEmailRecovery,
    scheduleDigestScheduleExhaustionRecovery,
    observeScheduledTask,
    reportScheduledTaskFailure,
    sendMonthlyCustomerRecaps,
    sendScheduledObservationHeartbeat,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Worker scheduled handler", () => {
  it("runs the independent observation heartbeat without customer workloads", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();

    await loaded.worker.scheduled(
      {
        cron: HEARTBEAT_CRON,
        scheduledTime: Date.parse("2026-07-30T12:13:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.sendScheduledObservationHeartbeat).toHaveBeenCalledTimes(1);
    expect(loaded.runScheduledMonitoring).not.toHaveBeenCalled();
    expect(loaded.scheduleBillingLifecycleEmailRecovery).not.toHaveBeenCalled();
  });

  it("pages a rejected independent observation heartbeat", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const failure = new Error("heartbeat query failed");
    loaded.sendScheduledObservationHeartbeat.mockRejectedValueOnce(failure);

    await loaded.worker.scheduled(
      {
        cron: HEARTBEAT_CRON,
        scheduledTime: Date.parse("2026-07-30T12:13:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "scheduled_observation_heartbeat",
      failure,
    );
  });

  it("delegates a normal cron to scheduled monitoring", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const scheduledTime = Date.parse("2026-07-16T04:00:00.000Z");

    await loaded.worker.scheduled(
      { cron: NORMAL_CRON, scheduledTime } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.runScheduledMonitoring).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        includeScans: true,
        includeDigests: true,
        digestCadence: "weekly",
        digestLookbackDays: 7,
        cron: NORMAL_CRON,
        scheduledTime,
      }),
    );
    expect(loaded.runScheduledDiscoveryWarmup).not.toHaveBeenCalled();
    expect(loaded.scheduleBillingLifecycleEmailRecovery).toHaveBeenCalledTimes(1);
    expect(loaded.scheduleBillingLifecycleEmailRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { observationContext: { cron: NORMAL_CRON, scheduledTime } },
    );
    expect(loaded.scheduleDigestScheduleExhaustionRecovery).not.toHaveBeenCalled();
    expect(loaded.observeScheduledTask.mock.calls.map((call) => call[2])).toEqual([
      { cron: NORMAL_CRON, scheduledTime, taskName: "scheduled_monitoring" },
    ]);
  });

  it("delegates DISCOVERY_WARMUP_CRON to discovery warmup", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();

    const scheduledTime = Date.parse("2026-07-16T06:17:00.000Z");
    await loaded.worker.scheduled(
      { cron: WARMUP_CRON, scheduledTime } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.runScheduledDiscoveryWarmup).toHaveBeenCalledTimes(1);
    expect(loaded.runScheduledMonitoring).not.toHaveBeenCalled();
    expect(loaded.flushDeferredInstantAlerts).toHaveBeenCalledTimes(1);
    expect(loaded.scheduleBillingLifecycleEmailRecovery).toHaveBeenCalledTimes(1);
    expect(loaded.scheduleDigestScheduleExhaustionRecovery).toHaveBeenCalledTimes(1);
    expect(loaded.scheduleDigestScheduleExhaustionRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { observationContext: { cron: WARMUP_CRON, scheduledTime } },
    );
    expect(loaded.observeScheduledTask.mock.calls.map((call) => call[2])).toEqual([
      { cron: WARMUP_CRON, scheduledTime, taskName: "digest_schedule_recovery" },
      { cron: WARMUP_CRON, scheduledTime, taskName: "discovery_warmup" },
      { cron: WARMUP_CRON, scheduledTime, taskName: "monitoring_fanout_reconciliation" },
      { cron: WARMUP_CRON, scheduledTime, taskName: "instant_alert_flush" },
      { cron: WARMUP_CRON, scheduledTime, taskName: "retention_sweep" },
      { cron: WARMUP_CRON, scheduledTime, taskName: "presence_polling_batch" },
    ]);
  });
});
