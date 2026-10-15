import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { captureCheckIn, captureException, captureMessage } from "@sentry/cloudflare";

import { pingCheck } from "../app/lib/healthcheck.server";
import { RUN_OK, type RunHealth } from "../app/lib/sweep-health";

type CronMonitorConfig = NonNullable<Parameters<typeof captureCheckIn>[1]>;

const CHECK_IN_STEP: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "30 seconds",
};

interface Monitor<T> {
  slug: string;
  config: CronMonitorConfig;
  health?: (result: T) => RunHealth;
}

function closeCheckIn(
  monitor: Pick<Monitor<never>, "slug" | "config">,
  checkInId: string,
  health: RunHealth,
): Promise<string> {
  const failed = health.state === "failed";
  const body = health.state === "ok" ? undefined : health.reason;
  return pingCheck(monitor.slug, failed ? "fail" : "ok", body).then(() =>
    captureCheckIn({ checkInId, monitorSlug: monitor.slug, status: failed ? "error" : "ok" }, monitor.config),
  );
}

function reportHealth(job: string, health: RunHealth): void {
  if (health.state === "ok") return;
  if (health.state === "degraded") {
    console.warn(JSON.stringify({ event: "workflow.run_degraded", job, reason: health.reason }));
    captureMessage(`${job} degraded: ${health.reason}`, { level: "warning", tags: { job } });
    return;
  }
  console.error(JSON.stringify({ event: "workflow.run_failed", job, reason: health.reason }));
  captureException(new Error(`${job} finished unhealthy: ${health.reason}`), { tags: { job } });
}

export async function withStepCheckIn<T>(step: WorkflowStep, monitor: Monitor<T>, work: () => Promise<T>): Promise<T> {
  const checkInId = await step.do("monitor start", CHECK_IN_STEP, () =>
    Promise.resolve(captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, monitor.config)),
  );
  try {
    const result = await work();
    const health = monitor.health?.(result) ?? RUN_OK;
    await step.do(health.state === "failed" ? "monitor error" : "monitor ok", CHECK_IN_STEP, () => {
      reportHealth(monitor.slug, health);
      return closeCheckIn(monitor, checkInId, health);
    });
    return result;
  } catch (error) {
    await step.do("monitor error", CHECK_IN_STEP, () =>
      closeCheckIn(monitor, checkInId, { state: "failed", reason: "threw" }),
    );
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
