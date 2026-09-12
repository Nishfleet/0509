import { vi } from "vitest";
import {
  DAILY_DIGEST_CRON,
  DISCOVERY_WARMUP_CRON,
  REGULAR_MONITORING_CRON,
  WEEKLY_DIGEST_CRON,
} from "../../workers/schedule";

// Shared scheduled-handler test rig (issue #2422 split). Kept in tests/helpers/
// so the file-size ratchet (tests/file-size-ratchet.test.ts) does not count it.
export const DAILY_DIGEST = DAILY_DIGEST_CRON;
export const WEEKLY_DIGEST = WEEKLY_DIGEST_CRON;
export const DISCOVERY_WARMUP = DISCOVERY_WARMUP_CRON;
export const REGULAR_MONITORING = REGULAR_MONITORING_CRON;

export const NORMAL_CRON = "0 * * * *";
export const WARMUP_CRON = DISCOVERY_WARMUP_CRON;
export const GAP_CHECK_CRON = "13 * * * *";

export function createContext() {
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

export async function loadWorker() {
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
  const scheduleBillingLifecycleEmailRecovery = vi.fn();
  const scheduleDigestScheduleExhaustionRecovery = vi.fn();
  const sendScheduledObservationGapAlert = vi.fn().mockResolvedValue({
    sent: false,
    reason: "healthy",
    health: [],
  });
  const recordScheduledObservationGapCheckHeartbeat = vi.fn().mockResolvedValue(true);
  const recordStatusHealthSample = vi.fn().mockResolvedValue(true);
  const sendMonthlyCustomerRecaps = vi.fn().mockResolvedValue({
    sent: 0,
    skipped: 0,
    failed: 0,
  });
  const sendMonthlyReports = vi.fn().mockResolvedValue({
    attempted: 0,
    filed: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
  });
  const reportScheduledTaskFailure = vi.fn();
  const cleanupRateLimitEvents = vi.fn().mockResolvedValue(undefined);
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

  vi.doMock("../../app/lib/monitoring.server", () => ({
    flushDeferredInstantAlerts,
    runScheduledDiscoveryWarmup,
    runScheduledMonitoring,
  }));
  vi.doMock("../../app/lib/operator-metrics-emails.server", () => ({
    sendWeeklyBusinessNumbers,
  }));
  vi.doMock("../../app/lib/demo-brand-backfill.server", () => ({
    runDemoBrandBackfill,
    runDemoBrandProofHoleCatchUp,
    summarizeDemoBrandBackfill,
  }));
  vi.doMock("../../app/lib/sneaker-resale-backfill.server", () => ({
    runSneakerResaleBackfill,
    summarizeSneakerResaleBackfill,
  }));
  vi.doMock("../../app/lib/sitemap-timeline-backfill.server", () => ({
    runSitemapTimelineBackfill,
    summarizeSitemapTimelineBackfill,
  }));
  vi.doMock("../../app/lib/ads-domain-publisher.server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../app/lib/ads-domain-publisher.server")>()),
    runAdsDomainPublisher,
  }));
  vi.doMock("../../app/lib/cron-failure-alert.server", () => ({ reportScheduledTaskFailure }));
  vi.doMock("../../app/lib/monthly-recap.server", () => ({ sendMonthlyCustomerRecaps }));
  // Issue #2422: monthly reports ride the same weekly Monday tick. Mocked so
  // the scheduled-handler suite never reaches the real report build.
  vi.doMock("../../app/lib/delivery.server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../app/lib/delivery.server")>()),
    sendMonthlyReports,
  }));
  vi.doMock("../../app/lib/scheduled-observation-health.server", () => ({
    SCHEDULED_OBSERVATION_GAP_CHECK_CRON: GAP_CHECK_CRON,
    recordScheduledObservationGapCheckHeartbeat,
    recordStatusHealthSample,
    sendScheduledObservationGapAlert,
  }));
  vi.doMock("../../app/lib/release-scheduled-observation.server", () => ({ observeScheduledTask }));
  vi.doMock("../../app/lib/monitoring-fanout.server", () => ({
    reconcileOrchestratedWatchlistRuns,
    resolveMonitoringFanoutMode: vi.fn().mockReturnValue("fanout"),
    resolveMonitoringOrchestrationLeaseMs: vi.fn().mockReturnValue(60_000),
  }));
  vi.doMock("../../app/lib/presence-service.server", () => ({
    runPresencePollingBatch: vi.fn().mockResolvedValue({ results: [] }),
  }));
  vi.doMock("../../app/lib/retention.server", () => ({
    runRetentionSweep: vi.fn().mockResolvedValue({ deleted: {} }),
  }));
  vi.doMock("../../workers/delivery-recovery", () => ({ scheduleBillingLifecycleEmailRecovery }));
  vi.doMock("../../workers/digest-schedule-recovery", () => ({
    scheduleDigestScheduleExhaustionRecovery,
  }));
  vi.doMock("../../workers/schedule", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../workers/schedule")>()),
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
              digestCadence: "daily",
              digestLookbackDays: 1,
            }
          : {
              kind: "monitoring",
              includeScans: true,
              includeDigests: true,
              digestCadence: "weekly",
              digestLookbackDays: 7,
            },
    ),
  }));
  vi.doMock("../../workers/primary-domain", () => ({ primaryDomainRedirect: vi.fn().mockReturnValue(null) }));
  vi.doMock("../../workers/security-headers", () => ({ withSecurityHeaders: vi.fn((response) => response) }));
  vi.doMock("../../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class MonitoringWorkflow {} }));
  vi.doMock("../../app/lib/rate-limit.server", () => ({
    cleanupRateLimitEvents,
    enforceRequestRateLimit: vi.fn().mockResolvedValue(null),
  }));

  const worker = await import("../../workers/app");
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
    cleanupRateLimitEvents,
    sendMonthlyCustomerRecaps,
    sendMonthlyReports,
    sendScheduledObservationGapAlert,
    recordScheduledObservationGapCheckHeartbeat,
    recordStatusHealthSample,
    reconcileOrchestratedWatchlistRuns,
  };
}

