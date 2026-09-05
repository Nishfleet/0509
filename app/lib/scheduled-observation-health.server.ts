import type { AppEnv } from "~/lib/env.server";

export const SCHEDULED_OBSERVATION_GAP_CHECK_CRON = "13 * * * *";
export const SCHEDULED_OBSERVATION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const SCHEDULED_OBSERVATION_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;

export const SCHEDULED_OBSERVATION_DEADLINES = Object.freeze([
  { cron: "0 */3 * * *", maxAgeMs: 4 * 60 * 60 * 1000 },
  { cron: "17 */6 * * *", maxAgeMs: 7 * 60 * 60 * 1000 },
  // WP-50: dedicated brand-page refresh — same gap-check window as the
  // six-hourly warmup because the brand-page refresh is hosted on the
  // 12-hourly cadence and shares the same health/deadline contract.
  { cron: "37 */12 * * *", maxAgeMs: 14 * 60 * 60 * 1000 },
  { cron: "0 4 * * *", maxAgeMs: 26 * 60 * 60 * 1000 },
  { cron: "0 5 * * MON", maxAgeMs: 8 * 24 * 60 * 60 * 1000 },
]);

export type ScheduledObservationHealth = {
  cron: string;
  lastScheduledAt: string | null;
  maxAgeMs: number;
  overdue: boolean;
  futureEvidence: boolean;
};

/**
 * Reads schedule freshness without mutating health state. Migration 0072 seeds
 * the durable activation baselines used before a cron's first observation.
 */
export async function listScheduledObservationHealth(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<ScheduledObservationHealth[]> {
  if (!env.DB) {
    throw new Error("scheduled_observation_health_db_unavailable");
  }

  const now = options.now ?? new Date();
  const latestAllowedIso = new Date(
    now.getTime() + SCHEDULED_OBSERVATION_MAX_FUTURE_SKEW_MS,
  ).toISOString();
  const result = await env.DB.prepare(`
      SELECT
        cron,
        MAX(CASE WHEN scheduled_at <= ? THEN scheduled_at END) AS last_scheduled_at,
        SUM(CASE WHEN scheduled_at > ? THEN 1 ELSE 0 END) AS future_observation_count
      FROM release_scheduled_observation
      GROUP BY cron
    `).bind(latestAllowedIso, latestAllowedIso).all<{
      cron: string;
      last_scheduled_at: string | null;
      future_observation_count: number | null;
    }>();
  const lastByCron = new Map(
    (result.results ?? []).map((row) => [row.cron, row.last_scheduled_at]),
  );
  const futureByCron = new Map(
    (result.results ?? []).map((row) => [
      row.cron,
      Number(row.future_observation_count ?? 0) > 0,
    ]),
  );

  const stateResult = await env.DB.prepare(`
      SELECT cron, baseline_at
      FROM scheduled_observation_health_state
    `).all<{ cron: string; baseline_at: string }>();
  const baselineByCron = new Map(
    (stateResult.results ?? []).map((row) => [row.cron, row.baseline_at]),
  );

  return SCHEDULED_OBSERVATION_DEADLINES.map(({ cron, maxAgeMs }) => {
    const lastScheduledAt = lastByCron.get(cron) ?? null;
    const lastScheduledMs = lastScheduledAt ? Date.parse(lastScheduledAt) : Number.NaN;
    const baselineAt = baselineByCron.get(cron);
    const baselineMs = baselineAt ? Date.parse(baselineAt) : Number.NaN;
    if (!Number.isFinite(baselineMs)) {
      throw new Error("scheduled_observation_health_baseline_unavailable");
    }
    const freshnessReferenceMs = Number.isFinite(lastScheduledMs)
      ? lastScheduledMs
      : baselineMs;
    return {
      cron,
      lastScheduledAt,
      maxAgeMs,
      overdue: now.getTime() - freshnessReferenceMs > maxAgeMs,
      futureEvidence: futureByCron.get(cron) === true,
    };
  });
}

export function formatScheduledObservationHealthLines(
  health: ScheduledObservationHealth[],
) {
  const unhealthy = health.filter((entry) => entry.overdue || entry.futureEvidence);
  if (unhealthy.length === 0) {
    return ["Scheduled-work gap check: all four production schedules are fresh"];
  }

  return unhealthy.map((entry) => {
    if (entry.futureEvidence) {
      return `Scheduled-work gap check found quarantined future evidence for ${entry.cron}.`;
    }
    return `Scheduled-work gap check OVERDUE for ${entry.cron}; last observed: ${entry.lastScheduledAt ?? "never"}.`;
  });
}

export async function sendScheduledObservationGapAlert(
  env: AppEnv,
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const health = await listScheduledObservationHealth(env, { now });
  const unhealthy = health.filter((entry) => entry.overdue || entry.futureEvidence);
  if (unhealthy.length === 0) {
    return { sent: false, reason: "healthy" as const, health };
  }

  const unhealthyMask = health.reduce(
    (mask, entry, index) =>
      entry.overdue || entry.futureEvidence ? mask | (1 << index) : mask,
    0,
  );
  const previous = await env.DB!.prepare(
    `SELECT last_alerted_at, unhealthy_mask, last_attempted_at, last_attempt_outcome
     FROM scheduled_observation_alert_state
     WHERE alert_key = 'scheduled_observation_gap'`,
  ).first<{
    last_alerted_at: string | null;
    unhealthy_mask: number;
    last_attempted_at: string;
    last_attempt_outcome: "accepted" | "rejected" | "provider_unknown";
  }>();
  const previousAlertedMs = previous?.last_alerted_at
    ? Date.parse(previous.last_alerted_at)
    : Number.NaN;
  const hasNewlyUnhealthySchedule = previous
    ? (unhealthyMask & ~previous.unhealthy_mask) !== 0
    : true;
  if (
    Number.isFinite(previousAlertedMs) &&
    previousAlertedMs <= now.getTime() &&
    now.getTime() - previousAlertedMs < SCHEDULED_OBSERVATION_ALERT_THROTTLE_MS &&
    !hasNewlyUnhealthySchedule
  ) {
    return { sent: false, reason: "throttled" as const, health };
  }

  const previousAttemptedMs = previous
    ? Date.parse(previous.last_attempted_at)
    : Number.NaN;
  if (
    previous?.last_attempt_outcome === "rejected" &&
    Number.isFinite(previousAttemptedMs) &&
    previousAttemptedMs <= now.getTime() &&
    now.getTime() - previousAttemptedMs < SCHEDULED_OBSERVATION_ALERT_THROTTLE_MS &&
    !hasNewlyUnhealthySchedule
  ) {
    return { sent: false, reason: "retry_throttled" as const, health };
  }

  const { sendOperatorAlertEmailDetailed } = await import("~/lib/delivery.server");
  const outcome = await sendOperatorAlertEmailDetailed(env, {
    subject: `0509 scheduled-work gap: ${unhealthy.length} unhealthy`,
    intro: "A production schedule is overdue or produced invalid future evidence:",
    lines: formatScheduledObservationHealthLines(unhealthy),
    // Until an accepted page advances last_alerted_at, every retry uses the
    // same durable key. Provider-unknown outcomes therefore cannot resend just
    // because a wall-clock bucket rotated, and a repaired state write observes
    // the already-accepted delivery instead of sending again.
    idempotencyKey: `scheduled-observation-gap:${unhealthyMask}:${previous?.last_alerted_at ?? "initial"}`,
  });

  const accepted = outcome === "accepted" || outcome === "already_accepted";
  const attemptOutcome = accepted
    ? "accepted"
    : outcome === "rejected"
      ? "rejected"
      : "provider_unknown";
  await env.DB!.prepare(
    `INSERT INTO scheduled_observation_alert_state (
       alert_key, last_alerted_at, unhealthy_mask,
       last_attempted_at, last_attempt_outcome
     ) VALUES ('scheduled_observation_gap', ?, ?, ?, ?)
     ON CONFLICT(alert_key) DO UPDATE SET
       last_alerted_at = CASE
         WHEN excluded.last_alerted_at IS NOT NULL AND (
           scheduled_observation_alert_state.last_alerted_at IS NULL
           OR scheduled_observation_alert_state.last_alerted_at < excluded.last_alerted_at
         ) THEN excluded.last_alerted_at
         ELSE scheduled_observation_alert_state.last_alerted_at
       END,
       unhealthy_mask = CASE
         WHEN scheduled_observation_alert_state.last_attempted_at < excluded.last_attempted_at
         THEN excluded.unhealthy_mask
         ELSE scheduled_observation_alert_state.unhealthy_mask
       END,
       last_attempted_at = CASE
         WHEN scheduled_observation_alert_state.last_attempted_at < excluded.last_attempted_at
         THEN excluded.last_attempted_at
         ELSE scheduled_observation_alert_state.last_attempted_at
       END,
       last_attempt_outcome = CASE
         WHEN scheduled_observation_alert_state.last_attempted_at < excluded.last_attempted_at
         THEN excluded.last_attempt_outcome
         ELSE scheduled_observation_alert_state.last_attempt_outcome
       END`,
  ).bind(
    accepted ? now.toISOString() : null,
    unhealthyMask,
    now.toISOString(),
    attemptOutcome,
  ).run();

  return {
    sent: outcome === "accepted",
    reason:
      outcome === "accepted"
        ? ("sent" as const)
        : outcome === "already_accepted"
          ? ("already_sent" as const)
          : outcome === "in_flight_or_unknown"
            ? ("alert_pending" as const)
            : ("alert_not_sent" as const),
    health,
  };
}
