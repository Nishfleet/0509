import { captureException, setTag, withMonitor } from "@sentry/cloudflare";

import { deleteExpiredAuthRows } from "../app/lib/data/auth_expiry.server";
import { stampFirstSignals } from "../app/lib/data/onboarding_run.server";
import {
  startNightlyDiscovery,
  startWeeklyRefresh,
  WEEKLY_REFRESH_CRON,
} from "../app/lib/discovery/start.server";
import { pingLiveness } from "../app/lib/liveness-ping.server";
import { cronMonitor } from "./cron-monitors";
import { NIGHTLY_CRON, sweepPending } from "./delivery/sweeper";
import { runNightlyStanding } from "./standing/nightly";

export type ScheduledEnv = Env & { LIVENESS_PING_URL?: string };

export async function handleScheduled(
  controller: ScheduledController,
  env: ScheduledEnv,
  ctx: ExecutionContext,
): Promise<void> {
  setTag("cron", controller.cron);

  const run = async (): Promise<void> => {
    if (controller.cron === NIGHTLY_CRON) {
      const now = new Date(controller.scheduledTime);
      const results = await Promise.allSettled([
        runNightlyStanding(env, now),
        sweepPending(env, now),
        startNightlyDiscovery(now),
        deleteExpiredAuthRows(env.DB, now),
        stampFirstSignals(),
      ]);
      results.forEach((result) => {
        if (result.status === "rejected") captureException(result.reason);
      });
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        throw new Error(`nightly: ${String(failures.length)} of ${String(results.length)} sub-jobs failed`);
      }
      return;
    }
    if (controller.cron === WEEKLY_REFRESH_CRON) {
      await startWeeklyRefresh(new Date(controller.scheduledTime));
      return;
    }
    const ping = pingLiveness(env.LIVENESS_PING_URL);
    if (ping) ctx.waitUntil(ping);
  };

  const monitor = cronMonitor(controller.cron);
  if (!monitor) {
    await run();
    return;
  }
  await withMonitor(monitor.slug, run, {
    schedule: { type: "crontab", value: monitor.schedule },
    checkinMargin: monitor.checkinMargin,
    maxRuntime: monitor.maxRuntime,
    timezone: "UTC",
  });
}
