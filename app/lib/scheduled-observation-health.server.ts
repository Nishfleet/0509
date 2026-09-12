import type { AppEnv } from "~/lib/env.server";

export const SCHEDULED_OBSERVATION_GAP_CHECK_CRON = "13 * * * *";
export const SCHEDULED_OBSERVATION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const SCHEDULED_OBSERVATION_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;

export const SCHEDULED_OBSERVATION_DEADLINES = Object.freeze([
  { cron: "0 */3 * * *", maxAgeMs: 4 * 60 * 60 * 1000 },
  { cron: "17 */6 * * *", maxAgeMs: 7 * 60 * 60 * 1000 },
  { cron: "0 4 * * *", maxAgeMs: 26 * 60 * 60 * 1000 },
  { cron: "0 5 * * MON", maxAgeMs: 8 * 24 * 60 * 60 * 1000 },
]);

/**
 * The hourly gap-check cron writes this object on every run. It is the only
 * durable evidence that the `13 * * * *` trigger itself is alive: the four-cron
 * soak contract (migration 0070) deliberately refuses to record this
 * control-plane cron, so losing just this trigger left `/api/health/deep`
 * green while the gap alerter was already dead (issue #2368). It lives in
 * object storage because both soak tables pin their `cron` column with a CHECK
 * and widening either one needs a table rebuild plus a prod-D1 migration.
 */
export const SCHEDULED_OBSERVATION_GAP_CHECK_HEARTBEAT_KEY =
  "cron-heartbeats/gap-check.json";

/**
 * An hourly cron that missed one tick is still healthy; two missed ticks is the
 * signal. Kept under half a day so a dead trigger is visible the same shift.
 */
export const SCHEDULED_OBSERVATION_GAP_CHECK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * A version that has been live for less than one hourly cadence has not had a
 * chance to write its first heartbeat. Deliberately one cadence rather than the
 * full max age, so a gap-check trigger that is dead on a brand-new version is
 * still caught inside two hours instead of hiding behind the freshness window.
 */
export const SCHEDULED_OBSERVATION_GAP_CHECK_ACTIVATION_GRACE_MS = 60 * 60 * 1000;

// The /status uptime sample rail. Every scheduled() invocation (any of the
// five crons) drops one row; the writer prunes past 7 days in the same batch.
export const STATUS_HEALTH_SAMPLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Record one public-status health sample. Best effort: a failed sample write
 * must never fail or slow the cron that carries it. `d1_ok` comes from a real
 * `SELECT 1` probe so the /status uptime row reflects storage health, not
 * just scheduler liveness.
 */
export async function recordStatusHealthSample(
  env: AppEnv,
  cron: string,
  options: { now?: Date } = {},
): Promise<boolean> {
  if (!env.DB) return false;
  const now = options.now ?? new Date();
  try {
    let d1Ok = 1;
    try {
      await env.DB.prepare("SELECT 1").first();
    } catch {
      d1Ok = 0;
    }
    const cutoff = new Date(
      now.getTime() - STATUS_HEALTH_SAMPLE_RETENTION_MS,
    ).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO status_health_sample (id, checked_at, d1_ok, cron_name)
         VALUES (?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        now.toISOString(),
        d1Ok,
        cron.slice(0, 32),
      ),
      env.DB.prepare(
        `DELETE FROM status_health_sample WHERE checked_at < ?`,
      ).bind(cutoff),
    ]);
    return true;
  } catch (error) {
    console.warn("status health sample write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export interface StatusUptimeReading {
  /** Samples recorded in the trailing 24 hours. */
  samples24h: number;
  /** Samples in that window whose D1 probe passed. */
  okSamples24h: number;
  /** ISO timestamp of the most recent sample of any age, or null. */
  lastSampleAt: string | null;
}

/**
 * Read the /status uptime figure. One bounded COUNT over the indexed
 * checked_at column plus one MAX; never throws to the caller (a read error
 * reads as zero samples so the page can degrade with a reason).
 */
export async function readStatusUptime(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<StatusUptimeReading> {
  if (!env.DB) {
    return { samples24h: 0, okSamples24h: 0, lastSampleAt: null };
  }
  const now = options.now ?? new Date();
  const dayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const [countsRow, lastRow] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN d1_ok = 1 THEN 1 ELSE 0 END) AS ok
           FROM status_health_sample
          WHERE checked_at >= ?`,
      ).bind(dayAgoIso).first<{ total: number; ok: number | null }>(),
      env.DB.prepare(
        `SELECT MAX(checked_at) AS last_sample_at FROM status_health_sample`,
      ).first<{ last_sample_at: string | null }>(),
    ]);
    return {
      samples24h: Number(countsRow?.total ?? 0),
      okSamples24h: Number(countsRow?.ok ?? 0),
      lastSampleAt: lastRow?.last_sample_at ?? null,
    };
  } catch {
    return { samples24h: 0, okSamples24h: 0, lastSampleAt: null };
  }
}

export type ScheduledObservationHealth = {
  cron: string;
  lastScheduledAt: string | null;
  maxAgeMs: number;
  overdue: boolean;
  futureEvidence: boolean;
};

export type ScheduledObservationGapCheckStatus = "ok" | "degraded" | "missing";

export type ScheduledObservationGapCheckHealth = {
  status: ScheduledObservationGapCheckStatus;
  lastRunAt: string | null;
  maxAgeMs: number;
};

/**
 * Best-effort record that the hourly gap-check cron ran. Rollback rolls back
 * code, never data: if this writer is reverted the object simply goes unread.
 * Never throws — a broken heartbeat write must not be reported as a failed gap
 * check, which would page for the wrong reason.
 */
export async function recordScheduledObservationGapCheckHeartbeat(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<boolean> {
  const bucket = env.LANDING_PAGE_ARTIFACTS;
  if (!bucket) return false;

  const now = options.now ?? new Date();
  try {
    await bucket.put(
      SCHEDULED_OBSERVATION_GAP_CHECK_HEARTBEAT_KEY,
      JSON.stringify({ lastRunAt: now.toISOString() }),
      { httpMetadata: { contentType: "application/json" } },
    );
    return true;
  } catch (error) {
    console.warn("scheduled observation gap check heartbeat write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Freshness of the gap-check heartbeat, read without mutating anything.
 *
 * A missing heartbeat on a version that has been live for less than one hourly
 * cadence is not yet evidence of a dead cron: this version has not had a full
 * cadence in which to write its first heartbeat (the same activation-baseline
 * posture as migration 0072). A missing heartbeat on an older version, or one
 * that stopped advancing, is degraded. An unbound bucket reports `missing` so
 * the caller can tell "no object storage here" from "the cron stopped".
 */
export async function readScheduledObservationGapCheckHealth(
  env: AppEnv,
  options: { now?: Date; deployedAt?: string | null } = {},
): Promise<ScheduledObservationGapCheckHealth> {
  const now = options.now ?? new Date();
  const maxAgeMs = SCHEDULED_OBSERVATION_GAP_CHECK_MAX_AGE_MS;
  const bucket = env.LANDING_PAGE_ARTIFACTS;
  if (!bucket) {
    return { status: "missing", lastRunAt: null, maxAgeMs };
  }

  let lastRunAt: string | null = null;
  try {
    const object = await bucket.get(SCHEDULED_OBSERVATION_GAP_CHECK_HEARTBEAT_KEY);
    if (object) {
      const payload = (await object.json()) as { lastRunAt?: unknown };
      lastRunAt = typeof payload?.lastRunAt === "string" ? payload.lastRunAt : null;
    }
  } catch {
    // A read failure is treated exactly like an absent heartbeat: a broken
    // observability rail must not pretend the cron is healthy.
    lastRunAt = null;
  }

  const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : Number.NaN;
  if (Number.isFinite(lastRunMs)) {
    const futureEvidence =
      lastRunMs - now.getTime() > SCHEDULED_OBSERVATION_MAX_FUTURE_SKEW_MS;
    return {
      status:
        futureEvidence || now.getTime() - lastRunMs > maxAgeMs
          ? "degraded"
          : "ok",
      lastRunAt,
      maxAgeMs,
    };
  }

  const deployedMs = options.deployedAt ? Date.parse(options.deployedAt) : Number.NaN;
  const withinActivationGrace =
    Number.isFinite(deployedMs) &&
    deployedMs <= now.getTime() &&
    now.getTime() - deployedMs <= SCHEDULED_OBSERVATION_GAP_CHECK_ACTIVATION_GRACE_MS;
  return {
    status: withinActivationGrace ? "ok" : "degraded",
    lastRunAt: null,
    maxAgeMs,
  };
}

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
