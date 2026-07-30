import type { AppEnv } from "~/lib/env.server";

export const SCHEDULED_OBSERVATION_HEARTBEAT_CRON = "13 * * * *";

export const SCHEDULED_OBSERVATION_DEADLINES = Object.freeze([
  { cron: "0 */3 * * *", maxAgeMs: 4 * 60 * 60 * 1000 },
  { cron: "17 */6 * * *", maxAgeMs: 7 * 60 * 60 * 1000 },
  { cron: "0 4 * * *", maxAgeMs: 26 * 60 * 60 * 1000 },
  { cron: "0 5 * * MON", maxAgeMs: 8 * 24 * 60 * 60 * 1000 },
]);

export type ScheduledObservationHealth = {
  cron: string;
  lastScheduledAt: string | null;
  maxAgeMs: number;
  overdue: boolean;
};

export async function listScheduledObservationHealth(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<ScheduledObservationHealth[]> {
  if (!env.DB) {
    throw new Error("scheduled_observation_health_db_unavailable");
  }

  const now = options.now ?? new Date();
  const result = await env.DB.prepare(`
      SELECT cron, MAX(scheduled_at) AS last_scheduled_at
      FROM release_scheduled_observation
      GROUP BY cron
    `).all<{ cron: string; last_scheduled_at: string | null }>();
  const lastByCron = new Map(
    (result.results ?? []).map((row) => [row.cron, row.last_scheduled_at]),
  );
  const nowIso = now.toISOString();
  const observedCrons = new Set(lastByCron.keys());

  await env.DB.batch(
    SCHEDULED_OBSERVATION_DEADLINES.map(({ cron }) =>
      env.DB!.prepare(`
          INSERT INTO scheduled_observation_health_state (
            cron, baseline_at, had_observation, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(cron) DO UPDATE SET
            had_observation = excluded.had_observation,
            updated_at = excluded.updated_at
        `).bind(cron, nowIso, observedCrons.has(cron) ? 1 : 0, nowIso),
    ),
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
    };
  });
}

export function formatScheduledObservationHealthLines(
  health: ScheduledObservationHealth[],
) {
  const overdue = health.filter((entry) => entry.overdue);
  if (overdue.length === 0) {
    return ["Scheduled-work heartbeat: all four production schedules are fresh"];
  }

  return overdue.map(
    (entry) =>
      `Scheduled-work heartbeat OVERDUE for ${entry.cron}; last observed: ${entry.lastScheduledAt ?? "never"}.`,
  );
}

export async function sendScheduledObservationHeartbeat(
  env: AppEnv,
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const health = await listScheduledObservationHealth(env, { now });
  const overdue = health.filter((entry) => entry.overdue);
  if (overdue.length === 0) {
    return { sent: false, reason: "healthy" as const, health };
  }

  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  const sixHourWindow = Math.floor(now.getTime() / (6 * 60 * 60 * 1000));
  const sent = await sendOperatorAlertEmail(env, {
    subject: `0509 scheduler heartbeat: ${overdue.length} overdue`,
    intro: "A production schedule has not produced its expected heartbeat:",
    lines: formatScheduledObservationHealthLines(overdue),
    idempotencyKey: `scheduled-observation-heartbeat:${sixHourWindow}`,
  });

  return {
    sent,
    reason: sent ? ("sent" as const) : ("alert_not_sent" as const),
    health,
  };
}
