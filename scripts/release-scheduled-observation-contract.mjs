export const RELEASE_SCHEDULED_TASK_NAMES = Object.freeze([
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
]);

export const RELEASE_SCHEDULE_CRONS = Object.freeze([
  "17 */6 * * *",
  "0 */3 * * *",
  "0 4 * * *",
  "0 5 * * MON",
]);

const WARMUP_TASKS = Object.freeze([
  "billing_lifecycle_email_recovery",
  "digest_schedule_exhaustion_recovery",
  "digest_schedule_recovery",
  "discovery_warmup",
  "monitoring_fanout_reconciliation",
  "instant_alert_flush",
  "retention_sweep",
  "presence_polling_batch",
]);
const MONITORING_TASKS = Object.freeze([
  "billing_lifecycle_email_recovery",
  "scheduled_monitoring",
]);
const DAILY_TASKS = Object.freeze([
  ...MONITORING_TASKS,
  "customer_at_risk_alert",
]);
const WEEKLY_TASKS = Object.freeze([
  "billing_lifecycle_email_recovery",
  "weekly_business_numbers",
  "scheduled_monitoring",
]);

/**
 * @param {number} startedAtMs
 * @param {number} endedAtMs
 * @returns {Array<{ cron: string, taskName: string, scheduledAt: string }>}
 */
export function expectedReleaseSchedule(startedAtMs, endedAtMs) {
  if (
    !Number.isSafeInteger(startedAtMs) || !Number.isSafeInteger(endedAtMs) ||
    endedAtMs <= startedAtMs
  ) throw new Error("invalid_release_schedule_window");
  /** @type {Array<{ cron: string, taskName: string, scheduledAt: string }>} */
  const expected = [];
  /** @param {string} cron @param {readonly string[]} taskNames @param {Date} date */
  const add = (cron, taskNames, date) => {
    for (const taskName of taskNames) expected.push({ cron, taskName, scheduledAt: date.toISOString() });
  };
  const firstMinute = Math.ceil(startedAtMs / 60_000) * 60_000;
  for (let timestamp = firstMinute; timestamp < endedAtMs; timestamp += 60_000) {
    const date = new Date(timestamp);
    const minute = date.getUTCMinutes();
    const hour = date.getUTCHours();
    if (minute === 17 && hour % 6 === 0) add("17 */6 * * *", WARMUP_TASKS, date);
    if (minute === 0 && hour % 3 === 0) add("0 */3 * * *", MONITORING_TASKS, date);
    if (minute === 0 && hour === 4) add("0 4 * * *", DAILY_TASKS, date);
    if (minute === 0 && hour === 5 && date.getUTCDay() === 1) add("0 5 * * MON", WEEKLY_TASKS, date);
  }
  return expected;
}

/** @param {Record<string, unknown>} observation */
export function releaseObservationKey(observation) {
  return `${observation.cron}\u0000${observation.taskName}\u0000${observation.scheduledAt}`;
}
