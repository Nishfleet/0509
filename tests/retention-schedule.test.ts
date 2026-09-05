import { beforeEach, describe, expect, it, vi } from "vitest";

const runRetentionSweepMock = vi.hoisted(() => vi.fn());
const reportScheduledTaskFailureMock = vi.hoisted(() => vi.fn());
const runScheduledDiscoveryWarmupMock = vi.hoisted(() => vi.fn());
const reconcileOrchestratedWatchlistRunsMock = vi.hoisted(() => vi.fn());
const flushDeferredInstantAlertsMock = vi.hoisted(() => vi.fn());
const runPresencePollingBatchMock = vi.hoisted(() => vi.fn());
const resumePendingDigestScheduleJobsDetailedMock = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({
  createContext: vi.fn(() => ({})),
  createRequestHandler: vi.fn(() => vi.fn()),
  RouterContextProvider: class {},
}));
vi.mock("~/lib/cron-failure-alert.server", () => ({
  reportScheduledTaskFailure: reportScheduledTaskFailureMock,
}));
vi.mock("~/lib/retention.server", () => ({
  runRetentionSweep: runRetentionSweepMock,
}));
vi.mock("~/lib/digest-orchestration.server", () => ({
  resumePendingDigestScheduleJobsDetailed: resumePendingDigestScheduleJobsDetailedMock,
}));
vi.mock("~/lib/monitoring.server", () => ({
  flushDeferredInstantAlerts: flushDeferredInstantAlertsMock,
  runScheduledDiscoveryWarmup: runScheduledDiscoveryWarmupMock,
  runScheduledMonitoring: vi.fn(),
  sendCustomerAtRiskAlert: vi.fn(),
  sendWeeklyBusinessNumbers: vi.fn(),
}));
vi.mock("~/lib/monitoring-fanout.server", () => ({
  reconcileOrchestratedWatchlistRuns: reconcileOrchestratedWatchlistRunsMock,
  resolveMonitoringFanoutMode: vi.fn(() => "inline"),
  resolveMonitoringOrchestrationLeaseMs: vi.fn(() => 30_000),
}));
vi.mock("~/lib/presence-service.server", () => ({
  runPresencePollingBatch: runPresencePollingBatchMock,
}));
vi.mock("~/lib/public-markdown", () => ({
  isPublicMarkdownPage: vi.fn(() => false),
  LLMS_TEXT: "",
  buildLlmsText: vi.fn(() => ""),
  PUBLIC_MARKDOWN: "",
  wantsPublicMarkdown: vi.fn(() => false),
}));
vi.mock("~/lib/seo", () => ({ publicSeoFileForPathname: vi.fn(() => null) }));
vi.mock("~/lib/rate-limit.server", () => ({ enforceRequestRateLimit: vi.fn() }));
vi.mock("../workers/delivery-recovery", () => ({
  scheduleBillingLifecycleEmailRecovery: vi.fn(),
}));
vi.mock("../workers/digest-schedule-recovery", () => ({
  scheduleDigestScheduleExhaustionRecovery: vi.fn(),
}));
vi.mock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class {} }));
vi.mock("../workers/primary-domain", () => ({ primaryDomainRedirect: vi.fn(() => null) }));
vi.mock("../workers/security-headers", () => ({
  withSecurityHeaders: vi.fn((response: Response) => response),
}));

describe("retention scheduled failure reporting", () => {
  beforeEach(() => {
    vi.resetModules();
    runRetentionSweepMock.mockReset();
    reportScheduledTaskFailureMock.mockReset().mockResolvedValue({ sent: true, reason: "sent" });
    runScheduledDiscoveryWarmupMock.mockReset().mockResolvedValue(undefined);
    reconcileOrchestratedWatchlistRunsMock.mockReset().mockResolvedValue({
      redispatched: 0,
      recovered: 0,
      cancelled: 0,
      firstScans: {
        redispatched: 0,
        cancelled: 0,
        failures: 0,
      },
    });
    flushDeferredInstantAlertsMock.mockReset().mockResolvedValue({ groups: 0 });
    runPresencePollingBatchMock.mockReset().mockResolvedValue({ results: [] });
    resumePendingDigestScheduleJobsDetailedMock.mockReset().mockResolvedValue({ attempted: 0, sent: 0, failed: 0 });
  });

  it("reports a failed-step summary exactly once after all retention steps finish", async () => {
    runRetentionSweepMock.mockResolvedValue({
      deleted: { presence_item: 2 },
      failedSteps: ["discovery_cache_entry", "meta_integration_log"],
    });

    const { default: worker } = await import("../workers/app");
    const pending: Promise<unknown>[] = [];
    const env = { DB: {} } as never;
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as never;

    await worker.scheduled(
      { cron: "17 */6 * * *", scheduledTime: Date.parse("2026-07-15T06:17:00.000Z") } as never,
      env,
      ctx,
    );
    await Promise.all(pending);

    expect(runRetentionSweepMock).toHaveBeenCalledTimes(1);
    expect(reportScheduledTaskFailureMock).toHaveBeenCalledTimes(1);
    expect(reportScheduledTaskFailureMock).toHaveBeenCalledWith(
      env,
      "retention_sweep",
      expect.objectContaining({
        message: "Retention sweep failed for steps: discovery_cache_entry, meta_integration_log",
      }),
    );
  });

  it("does not alert when every retention step succeeds", async () => {
    runRetentionSweepMock.mockResolvedValue({ deleted: { presence_item: 1 }, failedSteps: [] });

    const { default: worker } = await import("../workers/app");
    const pending: Promise<unknown>[] = [];
    await worker.scheduled(
      { cron: "17 */6 * * *", scheduledTime: Date.parse("2026-07-15T06:17:00.000Z") } as never,
      { DB: {} } as never,
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as never,
    );
    await Promise.all(pending);

    expect(reportScheduledTaskFailureMock).not.toHaveBeenCalledWith(
      expect.anything(),
      "retention_sweep",
      expect.anything(),
    );
  });
});
