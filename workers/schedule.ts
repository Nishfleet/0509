import type { StatusProbeName } from "../app/lib/status-probes.server";

export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
export const REGULAR_MONITORING_CRON = "0 */3 * * *";
export const DAILY_DIGEST_CRON = "0 4 * * *";
export const WEEKLY_DIGEST_CRON = "0 5 * * MON";
/**
 * Live status probes (app/lib/status-probes.server.ts). Issue #3782: each
 * probe cadence is its own Cron Trigger — the old single 5-minute cron +
 * in-code tick arithmetic could only express "every N×5 minutes" and could
 * not pin provider_meta to minute 25. Control-plane crons like the hourly
 * gap check: deliberately OUTSIDE the four-cron release-soak contract
 * (SCHEDULED_OBSERVATION_DEADLINES stays exactly the four workload crons, so
 * the gap alerter neither pages for these crons nor misses one of the
 * four). Liveness evidence is the status_probe_samples table itself — if a
 * cron stops, checked_at stops advancing on /status.
 *
 * Cadence map (must stay in sync with wrangler.jsonc triggers.crons):
 * - STATUS_PROBES_CRON            every 5 min — cheap D1/self reads;
 * - STATUS_PROBES_EMAIL_CRON      every 15 min — sends a real canary mail
 *   through send_email; 5-minute sends would crowd the customer email
 *   budget;
 * - STATUS_PROBES_SIGNIN_CRON     every 30 min — real canary mail through
 *   send_email, same budget;
 * - STATUS_PROBES_PROVIDER_META_CRON  hourly at minute 25 — one shallow
 *   Meta Ad Library capture through the real browser-provider chain
 *   (browser minutes), kept clear of the :00 monitoring rails.
 */
export const STATUS_PROBES_CRON = "*/5 * * * *";
export const STATUS_PROBES_EMAIL_CRON = "*/15 * * * *";
export const STATUS_PROBES_SIGNIN_CRON = "*/30 * * * *";
export const STATUS_PROBES_PROVIDER_META_CRON = "25 * * * *";
export { SCHEDULED_OBSERVATION_GAP_CHECK_CRON } from "../app/lib/scheduled-observation-health.server";

/**
 * The exact probe set each status-probe Cron Trigger owns. Dispatch on
 * `controller.cron` uses this map — a probe can only ever run on the trigger
 * that names it, so cadence drift requires editing this table AND the
 * wrangler trigger list together.
 */
export const STATUS_PROBE_CRON_PROBES: Readonly<Record<string, readonly StatusProbeName[]>> = {
  [STATUS_PROBES_CRON]: ["public_search", "billing_dodo", "uptime"],
  [STATUS_PROBES_EMAIL_CRON]: ["email_delivery"],
  [STATUS_PROBES_SIGNIN_CRON]: ["signin_dispatch"],
  [STATUS_PROBES_PROVIDER_META_CRON]: ["provider_meta"],
};

export type ScheduledTask =
  | {
      kind: "discovery_warmup";
    }
  | {
      kind: "status_probes";
      /** The exact probe set this cron trigger owns (issue #3782). */
      probes: readonly StatusProbeName[];
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
  const probes = STATUS_PROBE_CRON_PROBES[cron];
  if (probes) {
    // Must resolve to its own kind, never the monitoring fallthrough below:
    // an unrecognized cron silently runs the full monitoring tick, so every
    // probe rail must be pinned here (and in tests) to stay inert.
    return { kind: "status_probes", probes };
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
    // timezone enters it exactly once per local Monday (issue #2406); a
    // workspace whose one in-window tick was lost is caught later the same
    // local Monday by the issue-#2734 catch-up, keyed to the missed tick.
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

