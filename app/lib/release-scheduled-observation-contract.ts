import {
  RELEASE_SCHEDULE_CRONS as RUNTIME_RELEASE_SCHEDULE_CRONS,
  RELEASE_SCHEDULED_TASK_NAMES as RUNTIME_RELEASE_SCHEDULED_TASK_NAMES,
  expectedReleaseSchedule as runtimeExpectedReleaseSchedule,
} from "../../scripts/release-scheduled-observation-contract.mjs";

export const RELEASE_SCHEDULED_TASK_NAMES = RUNTIME_RELEASE_SCHEDULED_TASK_NAMES as readonly [
  "billing_lifecycle_email_recovery",
  "weekly_business_numbers",
  "digest_schedule_exhaustion_recovery",
  "digest_schedule_recovery",
  "discovery_warmup",
  "monitoring_fanout_reconciliation",
  "instant_alert_flush",
  "retention_sweep",
  "presence_polling_batch",
  "scheduled_monitoring",
  "customer_at_risk_alert",
];

export const RELEASE_SCHEDULE_CRONS = RUNTIME_RELEASE_SCHEDULE_CRONS as readonly [
  "17 */6 * * *",
  "0 */3 * * *",
  "0 4 * * *",
  "0 5 * * MON",
];

export type ReleaseScheduledTaskName = (typeof RELEASE_SCHEDULED_TASK_NAMES)[number];

export type ExpectedReleaseObservation = {
  cron: string;
  taskName: ReleaseScheduledTaskName;
  scheduledAt: string;
};

export function expectedReleaseSchedule(startedAtMs: number, endedAtMs: number) {
  return runtimeExpectedReleaseSchedule(startedAtMs, endedAtMs) as ExpectedReleaseObservation[];
}
