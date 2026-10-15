import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { captureCheckIn, captureException } from "@sentry/cloudflare";

import { pingCheck } from "../app/lib/healthcheck.server";

type CronMonitorConfig = NonNullable<Parameters<typeof captureCheckIn>[1]>;

const CHECK_IN_STEP: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "30 seconds",
};

interface Monitor<T> {
  slug: string;
  config: CronMonitorConfig;
  unhealthy?: (result: T) => string | null;
}

function closeCheckIn(
  monitor: Pick<Monitor<never>, "slug" | "config">,
  checkInId: string,
  status: "ok" | "error",
): Promise<string> {
  return pingCheck(monitor.slug, status === "ok" ? "ok" : "fail").then(() =>
    captureCheckIn({ checkInId, monitorSlug: monitor.slug, status }, monitor.config),
  );
}

function reportUnhealthy(job: string, reason: string): void {
  console.error(JSON.stringify({ event: "workflow.run_failed", job, reason }));
  captureException(new Error(`${job} finished unhealthy: ${reason}`), { tags: { job } });
}

export async function withStepCheckIn<T>(step: WorkflowStep, monitor: Monitor<T>, work: () => Promise<T>): Promise<T> {
  const checkInId = await step.do("monitor start", CHECK_IN_STEP, () =>
    Promise.resolve(captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, monitor.config)),
  );
  try {
    const result = await work();
    const reason = monitor.unhealthy?.(result) ?? null;
    await step.do(reason === null ? "monitor ok" : "monitor error", CHECK_IN_STEP, () => {
      if (reason !== null) reportUnhealthy(monitor.slug, reason);
      return closeCheckIn(monitor, checkInId, reason === null ? "ok" : "error");
    });
    return result;
  } catch (error) {
    await step.do("monitor error", CHECK_IN_STEP, () => closeCheckIn(monitor, checkInId, "error"));
    throw error;
  }
}

export async function withCheckPings(slug: string, enabled: boolean, work: () => Promise<void>): Promise<void> {
  if (!enabled) {
    await work();
    return;
  }
  try {
    await work();
  } catch (error) {
    await pingCheck(slug, "fail");
    throw error;
  }
  await pingCheck(slug, "ok");
}
