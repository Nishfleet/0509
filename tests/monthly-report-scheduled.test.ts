import {
  WEEKLY_DIGEST as WEEKLY_DIGEST_CRON,
  createContext,
  loadWorker,
} from "./helpers/scheduled-handler-worker";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Monthly report scheduled handler (issue #2422)", () => {
  it("files the monthly report on the weekly tick and pages only real failures", async () => {
    const loaded = await loadWorker();
    const { ctx, pending } = createContext();
    loaded.sendMonthlyReports
      .mockResolvedValueOnce({
        attempted: 3,
        filed: 2,
        duplicates: 1,
        skipped: 0,
        failed: 0,
      })
      .mockResolvedValueOnce({
        attempted: 2,
        filed: 1,
        duplicates: 0,
        skipped: 0,
        failed: 1,
      });

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

    // Issue #2422: one monthly report per workspace per UTC month, on the
    // existing weekly cron tick — no new cron.
    expect(loaded.sendMonthlyReports).toHaveBeenCalledTimes(2);
    expect(loaded.sendMonthlyReports).toHaveBeenCalledWith(
      expect.anything(),
      { scheduledTime: Date.parse("2026-07-06T05:00:00.000Z") },
    );
    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledTimes(1);
    expect(loaded.reportScheduledTaskFailure).toHaveBeenCalledWith(
      expect.anything(),
      "monthly_reports_degraded",
      expect.objectContaining({
        message: "monthly reports completed with 1 failed workspaces",
      }),
    );
  });
});
