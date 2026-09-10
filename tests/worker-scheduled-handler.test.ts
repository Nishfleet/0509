import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_DIGEST_CRON,
  DISCOVERY_WARMUP_CRON,
  REGULAR_MONITORING_CRON,
  WEEKLY_DIGEST_CRON,
} from "../workers/schedule";

const NORMAL_CRON = "0 * * * *";
const WARMUP_CRON = DISCOVERY_WARMUP_CRON;
const GAP_CHECK_CRON = "13 * * * *";

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
  const runDemoBrandBackfill = vi.fn().mockResolvedValue({
    day: "2026-09-05",
    startedAt: "2026-09-05T01:00:00.000Z",
    capturedCount: 5,
    failedCount: 0,
    domains: [],
  });
  const runDemoBrandProofHoleCatchUp = vi.fn().mockResolvedValue({
    skipped: true,
    missingDomains: [],
    backfill: null,
  });
  const summarizeDemoBrandBackfill = vi.fn((result) =>
    `demo-brand-backfill day=${result.day} captured=${result.capturedCount} failed=${result.failedCount} []`,
  );
  const runSneakerResaleBackfill = vi.fn().mockResolvedValue({
    day: "2026-09-05",
    startedAt: "2026-09-05T01:00:00.000Z",
    capturedCount: 6,
    failedCount: 0,
    domains: [],
  });
  const summarizeSneakerResaleBackfill = vi.fn((result) =>
    `sneaker-resale-backfill day=${result.day} cohort=${result.domains.length} captured=${result.capturedCount} failed=${result.failedCount} []`,
  );
  const runSitemapTimelineBackfill = vi.fn().mockResolvedValue({
    day: "2026-09-05",
    startedAt: "2026-09-05T01:00:00.000Z",
    capturedCount: 7,
    failedCount: 0,
    domains: [],
  });
  const summarizeSitemapTimelineBackfill = vi.fn((result) =>
    `sitemap-timeline-backfill day=${result.day} cohort=${result.domains.length} captured=${result.capturedCount} failed=${result.failedCount} stale=0 []`,
  );
  const runAdsDomainPublisher = vi.fn().mockResolvedValue({
    list: "sneaker-resale",
    gate: "bet2_active",
    attempted: 0,
    published: 0,
    skipped: 0,
    warming: 0,
    failed: 0,
    invalid: 0,
    outcomes: [],
  });
  const flushDeferredInstantAlerts = vi.fn().mockResolvedValue({ groups: 0 });
  const sendWeeklyBusinessNumbers = vi.fn().mockResolvedValue({ sent: false });
  const sendCustomerAtRiskAlert = vi.fn().mockResolvedValue({ sent: false });
  const scheduleBillingLifecycleEmailRecovery = vi.fn();
  const scheduleDigestScheduleExhaustionRecovery = vi.fn();
  const sendScheduledObservationGapAlert = vi.fn().mockResolvedValue({
    sent: false,
    reason: "healthy",
    health: [],
  });
  const sendMonthlyCustomerRecaps = vi.fn().mockResolvedValue({
    sent: 0,
    skipped: 0,
    failed: 0,
  });
  const reportScheduledTaskFailure = vi.fn();
  const reconcileOrchestratedWatchlistRuns = vi.fn().mockResolvedValue({
    redispatched: 0,
    recovered: 0,
    cancelled: 0,
    redispatchFailures: 0,
  });
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
  }));
  vi.doMock("../app/lib/operator-metrics-emails.server", () => ({
    sendCustomerAtRiskAlert,
    sendWeeklyBusinessNumbers,
  }));
  vi.doMock("../app/lib/demo-brand-backfill.server", () => ({
    runDemoBrandBackfill,
    runDemoBrandProofHoleCatchUp,
    summarizeDemoBrandBackfill,
  }));
  vi.doMock("../app/lib/sneaker-resale-backfill.server", () => ({
    runSneakerResaleBackfill,
    summarizeSneakerResaleBackfill,
  }));
  vi.doMock("../app/lib/sitemap-timeline-backfill.server", () => ({
    runSitemapTimelineBackfill,
    summarizeSitemapTimelineBackfill,
  }));
  vi.doMock("../app/lib/ads-domain-publisher.server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../app/lib/ads-domain-publisher.server")>()),
    runAdsDomainPublisher,
  }));
  vi.doMock("../app/lib/cron-failure-alert.server", () => ({ reportScheduledTaskFailure }));
  vi.doMock("../app/lib/monthly-recap.server", () => ({ sendMonthlyCustomerRecaps }));
  vi.doMock("../app/lib/scheduled-observation-health.server", () => ({
    SCHEDULED_OBSERVATION_GAP_CHECK_CRON: GAP_CHECK_CRON,
    sendScheduledObservationGapAlert,
  }));
  vi.doMock("../app/lib/release-scheduled-observation.server", () => ({ observeScheduledTask }));
  vi.doMock("../app/lib/monitoring-fanout.server", () => ({
    reconcileOrchestratedWatchlistRuns,
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
        : cron === DAILY_DIGEST_CRON
          ? {
              kind: "monitoring",
              includeScans: false,
              includeDigests: true,
              includeMentionResweep: false,
              includeAutoCompetitorResweep: true,
              includeRiskAlert: true,
              digestCadence: "daily",
              digestLookbackDays: 1,
            }
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
    runDemoBrandBackfill,
    runDemoBrandProofHoleCatchUp,
    summarizeDemoBrandBackfill,
    runSneakerResaleBackfill,
    summarizeSneakerResaleBackfill,
    runSitemapTimelineBackfill,
    summarizeSitemapTimelineBackfill,
    runAdsDomainPublisher,
    flushDeferredInstantAlerts,
    scheduleBillingLifecycleEmailRecovery,
    scheduleDigestScheduleExhaustionRecovery,
    observeScheduledTask,
    reportScheduledTaskFailure,
    sendCustomerAtRiskAlert,
    sendMonthlyCustomerRecaps,
    sendScheduledObservationGapAlert,
    reconcileOrchestratedWatchlistRuns,
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
  it("runs the per-cron gap check while preserving shared email recovery", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();

    await loaded.worker.scheduled(
      {
        cron: GAP_CHECK_CRON,
        scheduledTime: Date.parse("2026-07-30T12:13:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.sendScheduledObservationGapAlert).toHaveBeenCalledTimes(1);
    expect(loaded.runScheduledMonitoring).not.toHaveBeenCalled();
    expect(loaded.runDemoBrandBackfill).not.toHaveBeenCalled();
    expect(loaded.runDemoBrandProofHoleCatchUp).toHaveBeenCalledTimes(1);
    expect(loaded.scheduleBillingLifecycleEmailRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
    );
    expect(loaded.observeScheduledTask).not.toHaveBeenCalled();
  });

  it("pages a rejected in-Worker gap check", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const failure = new Error("heartbeat query failed");
    loaded.sendScheduledObservationGapAlert.mockRejectedValueOnce(failure);

    await loaded.worker.scheduled(
      {
        cron: GAP_CHECK_CRON,
        scheduledTime: Date.parse("2026-07-30T12:13:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "scheduled_observation_gap_check",
      failure,
    );
  });

  it("pages only reconciliation redispatch failures from fulfilled fanout work", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    loaded.reconcileOrchestratedWatchlistRuns.mockResolvedValueOnce({
      redispatched: 0,
      recovered: 0,
      cancelled: 0,
      redispatchFailures: 2,
      firstScans: { redispatched: 0, cancelled: 0, failures: 0 },
    });

    await loaded.worker.scheduled(
      {
        cron: WARMUP_CRON,
        scheduledTime: Date.parse("2026-07-30T12:17:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "monitoring_fanout_reconciliation_redispatch",
      expect.any(Error),
    );
    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledTimes(1);
  });

  it("does not generically page other fulfilled reconciliation evidence", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    loaded.reconcileOrchestratedWatchlistRuns.mockResolvedValueOnce({
      redispatched: 1,
      recovered: 1,
      cancelled: 1,
      redispatchFailures: 0,
      firstScans: { redispatched: 0, cancelled: 0, failures: 2 },
    });

    await loaded.worker.scheduled(
      {
        cron: WARMUP_CRON,
        scheduledTime: Date.parse("2026-07-30T12:17:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).not.toHaveBeenCalled();
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

  it("pages scheduled-monitoring inline failures once through the dedicated risk alert", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    loaded.runScheduledMonitoring.mockResolvedValueOnce({
      queued: 0,
      duplicates: 0,
      inlineRuns: 0,
      inlineFailures: 1,
      skippedForBudget: 0,
      skippedForBilling: 0,
      dispatchFailures: 0,
      digests: 0,
      digestFailures: 0,
    });

    await loaded.worker.scheduled(
      {
        cron: NORMAL_CRON,
        scheduledTime: Date.parse("2026-07-30T04:00:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.sendCustomerAtRiskAlert).toHaveBeenCalledTimes(1);
    expect(loaded.sendCustomerAtRiskAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inlineFailures: 1,
        idempotencyKey: expect.stringMatching(/inline/),
      }),
    );
    expect(loaded.reportScheduledTaskFailure).not.toHaveBeenCalledWith(
      expect.anything(),
      "scheduled_monitoring_degraded",
      expect.anything(),
    );
  });

  it("pages monthly recap failures without paging intentional skips", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    loaded.sendMonthlyCustomerRecaps
      .mockResolvedValueOnce({ sent: 0, skipped: 2, failed: 0 })
      .mockResolvedValueOnce({ sent: 0, skipped: 0, failed: 1 });

    for (const scheduledTime of [
      Date.parse("2026-07-06T05:00:00.000Z"),
      Date.parse("2026-08-03T05:00:00.000Z"),
    ]) {
      await loaded.worker.scheduled(
        { cron: WEEKLY_DIGEST_CRON, scheduledTime } as never,
        {} as never,
        ctx as never,
      );
    }
    await Promise.all(pending);

    expect(loaded.sendMonthlyCustomerRecaps).toHaveBeenCalledTimes(2);
    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledTimes(1);
    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "monthly_customer_recaps_degraded",
      expect.objectContaining({
        message: "monthly customer recaps completed with 1 failed recipients",
      }),
    );
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

  it("passes the exact scheduled ExecutionContext into discovery warmup", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();

    await loaded.worker.scheduled(
      {
        cron: WARMUP_CRON,
        scheduledTime: Date.parse("2026-07-16T06:17:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    // The warmup call receives the SAME context object the handler was given
    // (identity, not a copy) so slow telemetry writes get real waitUntil
    // background completion in production.
    expect(loaded.runScheduledDiscoveryWarmup).toHaveBeenCalledTimes(1);
    const call = loaded.runScheduledDiscoveryWarmup.mock.calls[0]!;
    expect(call[0]).toBeDefined();
    expect(call[1]).toBe(ctx);
  });

  it("passes the exact scheduled ExecutionContext into scheduled monitoring", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();

    await loaded.worker.scheduled(
      {
        cron: NORMAL_CRON,
        scheduledTime: Date.parse("2026-07-16T04:00:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    // The monitoring call receives the SAME context object the handler was
    // given (identity, not a copy) so scans and proof captures get real
    // waitUntil background completion in production.
    expect(loaded.runScheduledMonitoring).toHaveBeenCalledTimes(1);
    const call = loaded.runScheduledMonitoring.mock.calls[0]!;
    expect(call[0]).toBeDefined();
    expect(call[1]).toMatchObject({
      includeScans: true,
      cron: NORMAL_CRON,
    });
    expect(call[1].executionContext).toBe(ctx);
  });

  it("runs the nightly demo-brand backfill on the daily 04:00 cron alongside monitoring", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const scheduledTime = Date.parse("2026-09-05T04:00:00.000Z");

    await loaded.worker.scheduled(
      { cron: DAILY_DIGEST_CRON, scheduledTime } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.runDemoBrandBackfill).toHaveBeenCalledTimes(1);
    expect(loaded.runDemoBrandProofHoleCatchUp).not.toHaveBeenCalled();
    // The daily digest cron itself still runs its normal monitoring/digest
    // work — the backfill rides the rail, it does not replace it. The hook
    // only fires for digestCadence "daily", never the 3-hour or weekly crons.
    expect(loaded.runScheduledMonitoring).toHaveBeenCalledTimes(1);
    expect(loaded.runScheduledDiscoveryWarmup).not.toHaveBeenCalled();
    expect(loaded.observeScheduledTask.mock.calls.map((call) => call[2])).toEqual(
      expect.arrayContaining([
        { cron: DAILY_DIGEST_CRON, scheduledTime, taskName: "scheduled_monitoring" },
      ]),
    );
    // The shared customer-email outbox drain still runs for this cron.
    expect(loaded.scheduleBillingLifecycleEmailRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ observationContext: expect.anything() }),
    );
  });

  it("does not run the demo-brand backfill on the 3-hour or weekly crons", async () => {
    for (const cron of [WARMUP_CRON, NORMAL_CRON]) {
      const loaded = await loadWorker();
      const { ctx, pending } = createContext();
      await loaded.worker.scheduled(
        { cron, scheduledTime: Date.parse("2026-09-05T04:00:00.000Z") } as never,
        {} as never,
        ctx as never,
      );
      await Promise.all(pending);
      expect(loaded.runDemoBrandBackfill).not.toHaveBeenCalled();
      expect(loaded.runDemoBrandProofHoleCatchUp).not.toHaveBeenCalled();
    }
  });

  it("pages the operator when the hourly demo-brand proof-hole catch-up throws", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const failure = new Error("proof hole capture pipeline down");
    loaded.runDemoBrandProofHoleCatchUp.mockRejectedValueOnce(failure);

    await loaded.worker.scheduled(
      {
        cron: GAP_CHECK_CRON,
        scheduledTime: Date.parse("2026-09-07T15:13:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "demo_brand_proof_hole_catch_up",
      failure,
    );
  });

  it("pages the operator when the nightly demo-brand backfill throws", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const failure = new Error("capture pipeline down");
    loaded.runDemoBrandBackfill.mockRejectedValueOnce(failure);

    await loaded.worker.scheduled(
      {
        cron: DAILY_DIGEST_CRON,
        scheduledTime: Date.parse("2026-09-05T04:00:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "demo_brand_backfill",
      failure,
    );
  });

  it("runs the nightly sneaker-resale backfill on the daily 04:00 cron alongside the demo-brand backfill (issue #1946)", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const scheduledTime = Date.parse("2026-09-05T04:00:00.000Z");

    await loaded.worker.scheduled(
      { cron: DAILY_DIGEST_CRON, scheduledTime } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    // Both backfills ride the same daily rail — the cohort expansion in
    // #1946 must NOT displace the existing demo-brand backfill, so the
    // scheduled handler dispatches both as siblings on the daily cron.
    expect(loaded.runSneakerResaleBackfill).toHaveBeenCalledTimes(1);
    expect(loaded.runDemoBrandBackfill).toHaveBeenCalledTimes(1);
    // The summary log line ran for the new backfill so a nightly canary
    // can grep for "sneaker-resale-backfill day=" in the operator log.
    expect(loaded.summarizeSneakerResaleBackfill).toHaveBeenCalledTimes(1);
    // The daily digest cron still runs its normal monitoring/digest work.
    expect(loaded.runScheduledMonitoring).toHaveBeenCalledTimes(1);
  });

  it("does not run the sneaker-resale backfill on the 3-hour or weekly crons (issue #1946)", async () => {
    for (const cron of [WARMUP_CRON, NORMAL_CRON]) {
      const loaded = await loadWorker();
      const { ctx, pending } = createContext();
      await loaded.worker.scheduled(
        { cron, scheduledTime: Date.parse("2026-09-05T04:00:00.000Z") } as never,
        {} as never,
        ctx as never,
      );
      await Promise.all(pending);
      expect(loaded.runSneakerResaleBackfill).not.toHaveBeenCalled();
    }
  });

  it("pages the operator when the nightly sneaker-resale backfill throws (issue #1946)", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const failure = new Error("sneaker-resale capture pipeline down");
    loaded.runSneakerResaleBackfill.mockRejectedValueOnce(failure);

    await loaded.worker.scheduled(
      {
        cron: DAILY_DIGEST_CRON,
        scheduledTime: Date.parse("2026-09-05T04:00:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "sneaker_resale_backfill",
      failure,
    );
    // The demo-brand backfill still ran on the same rail — one sibling
    // failing must not poison the other's waitUntil.
    expect(loaded.runDemoBrandBackfill).toHaveBeenCalledTimes(1);
  });

  it("waits for the nightly publisher to land public_search rows before deriving the sneaker-resale cohort (issue #1946)", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const scheduledTime = Date.parse("2026-09-05T04:00:00.000Z");

    // The cohort verdict reads the publisher's public_search cache rows,
    // which carry a 15-minute TTL. If the backfill ran as a sibling it
    // would read before the publisher's awaited per-domain writes land and
    // derive an empty cohort every night; regression: the backfill must
    // not even be invoked until the publisher's promise resolves.
    let resolvePublisher: (value: unknown) => void = () => {};
    loaded.runAdsDomainPublisher.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePublisher = resolve;
      }),
    );

    await loaded.worker.scheduled(
      { cron: DAILY_DIGEST_CRON, scheduledTime } as never,
      {} as never,
      ctx as never,
    );

    expect(loaded.runSneakerResaleBackfill).not.toHaveBeenCalled();
    resolvePublisher({
      list: "sneaker-resale",
      attempted: 2,
      published: 2,
      skipped: 0,
      failed: 0,
      invalid: 0,
    });
    await Promise.all(pending);

    expect(loaded.runSneakerResaleBackfill).toHaveBeenCalledTimes(1);
    // The publisher's own block still ran and logged on the same rail.
    expect(loaded.runAdsDomainPublisher).toHaveBeenCalledTimes(1);
  });

  it("still runs the sneaker-resale backfill when the nightly publisher throws (issue #1946)", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    loaded.runAdsDomainPublisher.mockRejectedValueOnce(new Error("publisher pipeline down"));

    await loaded.worker.scheduled(
      {
        cron: DAILY_DIGEST_CRON,
        scheduledTime: Date.parse("2026-09-05T04:00:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    // Best-effort capture against whatever rows exist; the empty-cohort
    // guard keeps the honest 410, and the publisher pages via its own block.
    expect(loaded.runSneakerResaleBackfill).toHaveBeenCalledTimes(1);
    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "ads_domain_publisher",
      expect.any(Error),
    );
  });

  it("runs the nightly sitemap-timeline backfill on the daily 04:00 cron alongside the demo-brand and sneaker-resale backfills (issue #1958)", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const scheduledTime = Date.parse("2026-09-05T04:00:00.000Z");

    await loaded.worker.scheduled(
      { cron: DAILY_DIGEST_CRON, scheduledTime } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    // The cohort expansion in #1958 must NOT displace the existing rails —
    // the scheduled handler dispatches all three backfills as siblings on
    // the daily cron.
    expect(loaded.runSitemapTimelineBackfill).toHaveBeenCalledTimes(1);
    expect(loaded.runDemoBrandBackfill).toHaveBeenCalledTimes(1);
    expect(loaded.runSneakerResaleBackfill).toHaveBeenCalledTimes(1);
    // The summary log line ran so a nightly canary can grep for
    // "sitemap-timeline-backfill day=" in the operator log.
    expect(loaded.summarizeSitemapTimelineBackfill).toHaveBeenCalledTimes(1);
    // The daily digest cron still runs its normal monitoring/digest work.
    expect(loaded.runScheduledMonitoring).toHaveBeenCalledTimes(1);
  });

  it("does not run the sitemap-timeline backfill on the 3-hour or weekly crons (issue #1958)", async () => {
    // The literal 3-hourly and weekly crons rather than the warmup/hourly
    // surrogates: the daily rail must be the ONLY rail that runs the
    // nightly sitemap-timeline backfill (issue #1958, phase 5).
    for (const cron of [REGULAR_MONITORING_CRON, WEEKLY_DIGEST_CRON]) {
      const loaded = await loadWorker();
      const { ctx, pending } = createContext();
      await loaded.worker.scheduled(
        { cron, scheduledTime: Date.parse("2026-09-05T04:00:00.000Z") } as never,
        {} as never,
        ctx as never,
      );
      await Promise.all(pending);
      expect(loaded.runSitemapTimelineBackfill).not.toHaveBeenCalled();
    }
  });

  it("pages the operator when the nightly sitemap-timeline backfill throws (issue #1958)", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    const failure = new Error("sitemap-timeline capture pipeline down");
    loaded.runSitemapTimelineBackfill.mockRejectedValueOnce(failure);

    await loaded.worker.scheduled(
      {
        cron: DAILY_DIGEST_CRON,
        scheduledTime: Date.parse("2026-09-05T04:00:00.000Z"),
      } as never,
      {} as never,
      ctx as never,
    );
    await Promise.all(pending);

    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "sitemap_timeline_backfill",
      failure,
    );
    // The demo-brand backfill still ran on the same rail — one sibling
    // failing must not poison the other's waitUntil.
    expect(loaded.runDemoBrandBackfill).toHaveBeenCalledTimes(1);
  });
});
