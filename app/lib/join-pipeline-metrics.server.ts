import type { AppEnv } from "~/lib/env.server";
import { FIRST_BRIEF_KIND } from "~/lib/first-brief";
import {
  funnelMeasurementEnabled,
  isGpcOptOut,
} from "~/lib/funnel-measurement.server";
import {
  DAY_MS,
  JOIN_FIRST_CONFIRM_PROBE,
  type JoinPipelineMetrics,
  type JoinPipelineWindowStats,
} from "~/lib/join-pipeline-metrics";

// The shared names/types live in the pure `join-pipeline-metrics` module so
// the /status route component can use them client-side; re-exported here so
// server-side callers keep one import site.
export {
  formatJoinLatencyMs,
  JOIN_FIRST_CONFIRM_PROBE,
  type JoinPipelineLatencyMetric,
  type JoinPipelineMetrics,
  type JoinPipelineWindowStats,
} from "~/lib/join-pipeline-metrics";

const WINDOW_7D_MS = 7 * DAY_MS;
// Upper bound on rows folded into one read. Join confirms are human-scale;
// the cap only bounds a pathological burst, never the real metric.
const JOIN_PIPELINE_SAMPLE_CAP = 5000;

/**
 * Percentile pick matching the probe rail's rank convention: the existing
 * p50 SQL uses `rn = floor(n / 2) + 1` (the upper-middle element on even
 * n). On the sorted array that is index `min(n - 1, floor(q * n))`.
 */
function summarizeLatencies(latencies: number[]): JoinPipelineWindowStats {
  if (latencies.length === 0) {
    return { samples: 0, p50Ms: null, p95Ms: null };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
  return { samples: sorted.length, p50Ms: pick(0.5), p95Ms: pick(0.95) };
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  // Tolerate "YYYY-MM-DD HH:MM:SS[.SSS]" storage by upgrading to ISO-Z.
  const iso = Date.parse(`${value.trim().replace(" ", "T")}Z`);
  return Number.isFinite(iso) ? iso : null;
}

/**
 * Record one join-confirm latency sample. Never throws: a sample-write
 * failure is a warn so a broken metric can never block a signup redirect.
 * `latencyMs` may be null (first-touch cookie absent — e.g. a direct POST
 * replay); the confirm still counts as an event, it just carries no
 * latency and is skipped by the percentile reads.
 */
export async function recordJoinConfirmSample(
  env: AppEnv,
  request: Request,
  sample: { latencyMs: number | null; kind: string },
): Promise<void> {
  if (!env.DB || !funnelMeasurementEnabled(env) || isGpcOptOut(request)) {
    return;
  }
  const kind = ["domain", "person", "brand"].includes(sample.kind) ? sample.kind : "brand";
  const latency =
    sample.latencyMs !== null && Number.isFinite(sample.latencyMs) && sample.latencyMs >= 0
      ? Math.round(sample.latencyMs)
      : null;
  try {
    await env.DB.prepare(
      "INSERT INTO status_probe_samples (probe, ok, latency_ms, detail, checked_at) VALUES (?, 1, ?, ?, ?)",
    )
      .bind(JOIN_FIRST_CONFIRM_PROBE, latency, `kind=${kind}`, new Date().toISOString())
      .run();
  } catch (error) {
    console.warn("join confirm sample write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

interface ConfirmSampleRow {
  latency_ms: number | null;
  checked_at: string;
}

interface FirstBriefRow {
  brief_at: string;
  signup_at: string;
}

/**
 * Read both join-path metrics from D1. Returns null when the database
 * binding is absent so the page can say so; a live read error propagates
 * to the caller's allSettled guard, matching every other /status read.
 */
export async function getJoinPipelineMetrics(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<JoinPipelineMetrics | null> {
  if (!env.DB) {
    return null;
  }
  const now = options.now ?? new Date();
  const since7dIso = new Date(now.getTime() - WINDOW_7D_MS).toISOString();
  const since24hIso = new Date(now.getTime() - DAY_MS).toISOString();

  const [confirmResult, briefResult] = await Promise.all([
    env.DB.prepare(
      `SELECT latency_ms, checked_at
       FROM status_probe_samples
       WHERE probe = ? AND checked_at >= ?
       ORDER BY checked_at DESC
       LIMIT ?`,
    )
      .bind(JOIN_FIRST_CONFIRM_PROBE, since7dIso, JOIN_PIPELINE_SAMPLE_CAP)
      .all<ConfirmSampleRow>(),
    env.DB.prepare(
      `SELECT dr.created_at AS brief_at, u.createdAt AS signup_at
       FROM digest_run dr
       JOIN user u ON u.id = dr.user_id
       WHERE json_extract(dr.summary_json, '$.kind') = ?
         AND dr.created_at >= ?
       ORDER BY dr.created_at DESC
       LIMIT ?`,
    )
      .bind(FIRST_BRIEF_KIND, since7dIso, JOIN_PIPELINE_SAMPLE_CAP)
      .all<FirstBriefRow>(),
  ]);

  const confirmLatencies24h: number[] = [];
  const confirmLatencies7d: number[] = [];
  let latestConfirmAt: string | null = null;
  for (const row of confirmResult.results ?? []) {
    if (row.checked_at < since7dIso) continue;
    if (!latestConfirmAt || row.checked_at > latestConfirmAt) {
      latestConfirmAt = row.checked_at;
    }
    if (typeof row.latency_ms !== "number" || !Number.isFinite(row.latency_ms) || row.latency_ms < 0) {
      continue;
    }
    confirmLatencies7d.push(row.latency_ms);
    if (row.checked_at >= since24hIso) {
      confirmLatencies24h.push(row.latency_ms);
    }
  }

  const briefLatencies24h: number[] = [];
  const briefLatencies7d: number[] = [];
  let latestBriefAt: string | null = null;
  for (const row of briefResult.results ?? []) {
    if (row.brief_at < since7dIso) continue;
    if (!latestBriefAt || row.brief_at > latestBriefAt) {
      latestBriefAt = row.brief_at;
    }
    const briefMs = parseTimestampMs(row.brief_at);
    const signupMs = parseTimestampMs(row.signup_at);
    if (briefMs === null || signupMs === null) continue;
    const latencyMs = briefMs - signupMs;
    if (latencyMs < 0) continue;
    briefLatencies7d.push(latencyMs);
    if (row.brief_at >= since24hIso) {
      briefLatencies24h.push(latencyMs);
    }
  }

  return {
    firstConfirm: {
      last24h: summarizeLatencies(confirmLatencies24h),
      last7d: summarizeLatencies(confirmLatencies7d),
      latestAt: latestConfirmAt,
    },
    firstBrief: {
      last24h: summarizeLatencies(briefLatencies24h),
      last7d: summarizeLatencies(briefLatencies7d),
      latestAt: latestBriefAt,
    },
  };
}
