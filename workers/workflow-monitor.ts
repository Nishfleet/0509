import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { captureCheckIn } from "@sentry/cloudflare";

interface CronMonitorConfig {
  schedule: { type: "crontab"; value: string };
  checkinMargin: number;
  maxRuntime: number;
  timezone: "UTC";
}

const CHECK_IN_STEP: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "30 seconds",
};

export async function withStepCheckIn<T>(
  step: WorkflowStep,
  monitor: { slug: string; config: CronMonitorConfig },
  work: () => Promise<T>,
): Promise<T> {
  const checkInId = await step.do("monitor start", CHECK_IN_STEP, () =>
    Promise.resolve(
      captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, monitor.config),
    ),
  );
  try {
    const result = await work();
    await step.do("monitor ok", CHECK_IN_STEP, () =>
      Promise.resolve(
        captureCheckIn({ checkInId, monitorSlug: monitor.slug, status: "ok" }, monitor.config),
      ),
    );
    return result;
  } catch (error) {
    await step.do("monitor error", CHECK_IN_STEP, () =>
      Promise.resolve(
        captureCheckIn({ checkInId, monitorSlug: monitor.slug, status: "error" }, monitor.config),
      ),
    );
    throw error;
  }
}
