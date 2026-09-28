import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WEEKLY_REFRESH_CRON } from "../../app/lib/discovery/start.server";
import { NIGHTLY_CRON } from "../../workers/delivery/sweeper";
import { handleScheduled, type ScheduledEnv } from "../../workers/scheduled";

const LIVENESS_CRON = "*/5 * * * *";

/**
 * The 0509 Worker's three cron triggers check into Sentry Cron Monitors
 * (0509#5798, parent 0509#5739), so a missed or failed 03:00 nightly pages
 * instead of passing silently.
 *
 * This file lives in the workers project because the handler's sub-jobs import
 * `cloudflare:workers`, which does not resolve under the node project. The
 * handler is imported from `workers/scheduled.ts` rather than `workers/app.ts`
 * because the Worker's entry carries a lazy `virtual:react-router/server-build`
 * import that does not resolve under `vitest.config.ts`.
 *
 * The workerd test pool externalizes a bare npm dependency, so `vi.mock` on
 * `@sentry/cloudflare` never reaches the module `workers/scheduled.ts` imports
 * and its call lands on the real client, which would reject against an
 * unconfigured Sentry. `vi.spyOn` on the namespace does reach it, which is what
 * lets each test assert the slug and config its cron branch checks in with.
 */

const sentry = await import("@sentry/cloudflare");

let withMonitor: ReturnType<typeof vi.spyOn>;
let captureException: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  withMonitor = vi.spyOn(sentry, "withMonitor").mockImplementation((_slug, callback) => callback());
  captureException = vi.spyOn(sentry, "captureException").mockImplementation(() => undefined);
});

const controller = (cron: string): ScheduledController =>
  ({ cron, scheduledTime: Date.now(), noRetry: () => undefined }) as ScheduledController;

describe("handleScheduled", () => {
  it("checks the five-minute liveness ping into its monitor", async () => {
    await handleScheduled(controller(LIVENESS_CRON), env as ScheduledEnv, createExecutionContext());

    expect(withMonitor).toHaveBeenCalledTimes(1);
    expect(withMonitor).toHaveBeenCalledWith("liveness-ping", expect.any(Function), {
      schedule: { type: "crontab", value: LIVENESS_CRON },
      checkinMargin: 10,
      maxRuntime: 1,
      timezone: "UTC",
    });
  });

  it("checks the nightly run into its monitor and reports no failure on empty D1", async () => {
    await handleScheduled(controller(NIGHTLY_CRON), env as ScheduledEnv, createExecutionContext());

    expect(withMonitor).toHaveBeenCalledTimes(1);
    expect(withMonitor).toHaveBeenCalledWith("nightly", expect.any(Function), {
      schedule: { type: "crontab", value: NIGHTLY_CRON },
      checkinMargin: 60,
      maxRuntime: 30,
      timezone: "UTC",
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("fails the nightly check-in when a sub-job breaks, so a partial run is not reported ok", async () => {
    const broken = Object.create(env, {
      DB: {
        value: {
          prepare: () => {
            throw new Error("db down");
          },
          batch: () => Promise.reject(new Error("db down")),
        } as unknown as D1Database,
      },
    }) as ScheduledEnv;

    await expect(handleScheduled(controller(NIGHTLY_CRON), broken, createExecutionContext())).rejects.toThrow(
      /nightly: \d+ of \d+ sub-jobs failed/,
    );
    expect(captureException).toHaveBeenCalled();
  });

  it("checks the weekly refresh into its monitor and resolves on empty D1", async () => {
    await handleScheduled(controller(WEEKLY_REFRESH_CRON), env as ScheduledEnv, createExecutionContext());

    expect(withMonitor).toHaveBeenCalledTimes(1);
    expect(withMonitor).toHaveBeenCalledWith("weekly-refresh", expect.any(Function), {
      schedule: { type: "crontab", value: WEEKLY_REFRESH_CRON },
      checkinMargin: 60,
      maxRuntime: 30,
      timezone: "UTC",
    });
  });
});
