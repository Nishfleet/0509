import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { captureCheckIn } from "@sentry/cloudflare";

import { pingCheck } from "../app/lib/healthcheck.server";

type CronMonitorConfig = NonNullable<Parameters<typeof captureCheckIn>[1]>;

const CHECK_IN_STEP: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "30 seconds",
};

export async function withStepCheckIn<T>(
  step: WorkflowStep,
  monitor: { slug: string; config: CronMonitorConfig },
  work: () => Promise<T>,
): Promise<T> {
  const checkInId = await step.do("monitor start", CHECK_IN_STEP, async () => {
    await pingCheck(monitor.slug, "start");
    return captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, monitor.config);
  });
  try {
    const result = await work();
    await step.do("monitor ok", CHECK_IN_STEP, async () => {
      await pingCheck(monitor.slug, "ok");
      return captureCheckIn({ checkInId, monitorSlug: monitor.slug, status: "ok" }, monitor.config);
    });
    return result;
  } catch (error) {
    await step.do("monitor error", CHECK_IN_STEP, async () => {
      await pingCheck(monitor.slug, "fail");
      return captureCheckIn({ checkInId, monitorSlug: monitor.slug, status: "error" }, monitor.config);
    });
    throw error;
  }
}

export async function withCheckPings(slug: string, enabled: boolean, work: () => Promise<void>): Promise<void> {
  if (!enabled) {
    await work();
    return;
  }
  await pingCheck(slug, "start");
  try {
    await work();
  } catch (error) {
    await pingCheck(slug, "fail");
    throw error;
  }
  await pingCheck(slug, "ok");
}
