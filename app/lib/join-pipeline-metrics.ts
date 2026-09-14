/**
 * Join-path latency measurements for /status (issue #3177, epic #3172).
 *
 * Two numbers, both read live from rows the pipeline already writes:
 *
 * - time-to-first-confirm: sampled at /join confirm time into
 *   `status_probe_samples` under the `join_first_confirm` probe name. The
 *   latency spans the first-touch cookie set at resolve → the confirm POST
 *   (card shown → confirmed). No new table: the rail already carries
 *   (latency_ms, checked_at) and the 5-minute cron prunes every probe's
 *   rows at 7 days, which is exactly the retention the public metric needs.
 *   The name stays OUT of STATUS_PROBE_NAMES on purpose — it is a real-user
 *   event sample, not a scheduled canary, so it never appears as a health
 *   row and never runs on the cron.
 * - time-to-first-brief: derived live from business rows the first-brief
 *   pipeline already writes — `user.createdAt` (signup completed) →
 *   `digest_run.created_at` where `summary_json.kind = "first_brief"`.
 *
 * Write-side gating mirrors the funnel spec: the sample is recorded only
 * when FUNNEL_MEASUREMENT_ENABLED is truthy and the visitor has not sent
 * Sec-GPC: 1. When the flag is off the /status rows read as an honest
 * empty window, never a fabricated number.
 *
 * This module is the pure half (names, types, display formatting) so the
 * /status route component can import it client-side; the D1 reads and the
 * confirm write live in `join-pipeline-metrics.server.ts`.
 */

export const JOIN_FIRST_CONFIRM_PROBE = "join_first_confirm";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface JoinPipelineWindowStats {
  /** Samples with a usable latency inside the window. */
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface JoinPipelineLatencyMetric {
  last24h: JoinPipelineWindowStats;
  last7d: JoinPipelineWindowStats;
  /** Most recent event timestamp inside the 7-day window, or null. */
  latestAt: string | null;
}

export interface JoinPipelineMetrics {
  /** Identity card shown → visitor confirmed (resolve → confirm POST). */
  firstConfirm: JoinPipelineLatencyMetric;
  /** Signup completed (user row) → first brief filed (digest_run row). */
  firstBrief: JoinPipelineLatencyMetric;
}

/**
 * One compact latency clause for /status rows: "9 s", "4 min", "3 h",
 * "2 d". Confirm latencies are second-scale; first-brief latencies are
 * minute-to-hour scale, so fixed unit steps (no false decimals) keep both
 * honest.
 */
export function formatJoinLatencyMs(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < DAY_MS) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / DAY_MS)} d`;
}
