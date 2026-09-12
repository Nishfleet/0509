export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
export const REGULAR_MONITORING_CRON = "0 */3 * * *";
export const DAILY_DIGEST_CRON = "0 4 * * *";
export const WEEKLY_DIGEST_CRON = "0 5 * * MON";
/**
 * Live status probes (app/lib/status-probes.server.ts). A control-plane cron
 * like the hourly gap check: deliberately OUTSIDE the four-cron release-soak
 * contract (SCHEDULED_OBSERVATION_DEADLINES stays exactly the four workload
 * crons, so the gap alerter neither pages for this cron nor misses one of the
 * four). Its liveness evidence is the status_probe_samples table itself — if
 * this cron stops, checked_at stops advancing on /status.
 */
export const STATUS_PROBES_CRON = "*/5 * * * *";
export { SCHEDULED_OBSERVATION_GAP_CHECK_CRON } from "../app/lib/scheduled-observation-health.server";

export type ScheduledTask =
  | {
      kind: "discovery_warmup";
    }
  | {
      kind: "status_probes";
    }
  | {
      kind: "monitoring";
      includeScans: boolean;
      includeDigests: boolean;
      includeMentionResweep: boolean;
      includeAutoCompetitorResweep: boolean;
      digestCadence?: "daily" | "weekly";
      digestLookbackDays?: number;
    };

export function resolveScheduledTask(cron: string): ScheduledTask {
  if (cron === STATUS_PROBES_CRON) {
    // Must resolve to its own kind, never the monitoring fallthrough below:
    // an unrecognized cron silently runs the full monitoring tick, so the
    // 5-minute probe rail must be pinned here (and in tests) to stay inert.
    return { kind: "status_probes" };
  }

  if (cron === DISCOVERY_WARMUP_CRON) {
    return { kind: "discovery_warmup" };
  }

  if (cron === WEEKLY_DIGEST_CRON) {
    // The Monday 05:00 UTC cron no longer assembles weekly digests: a single
    // UTC shot lands Sunday evening in the Americas. The three-hourly
    // monitoring tick now hosts the weekly cycle and enqueues each
    // workspace only while its local time sits inside the Monday
    // 05:00-08:00 window (issue #2406). This cron still fires the weekly
    // operator business numbers and first-of-month customer recaps —
    // workers/app.ts keys those on the cron string, not the resolved task.
    return {
      kind: "monitoring",
      includeScans: false,
      includeDigests: false,
      includeMentionResweep: false,
      includeAutoCompetitorResweep: false,
    };
  }

  if (cron === DAILY_DIGEST_CRON) {
    return {
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeMentionResweep: false,
      includeAutoCompetitorResweep: true,
      digestCadence: "daily",
      digestLookbackDays: 1,
    };
  }

  if (cron === REGULAR_MONITORING_CRON) {
    // The three-hourly tick also hosts the weekly brief: the digest cycle
    // enqueues a workspace only while its local time is inside the Monday
    // 05:00-08:00 window. The window equals the tick spacing, so every
    // timezone enters it exactly once per local Monday (issue #2406).
    return {
      kind: "monitoring",
      includeScans: true,
      includeDigests: true,
      includeMentionResweep: true,
      includeAutoCompetitorResweep: false,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    };
  }

  return {
    kind: "monitoring",
    includeScans: true,
    includeDigests: false,
    includeMentionResweep: true,
    includeAutoCompetitorResweep: false,
  };
}

