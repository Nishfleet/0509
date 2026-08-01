import { getDiscoveryProviderState } from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";

const WINDOW_DAYS = 7;
const RECENT_SUCCESS_HOURS = 24;
const RECENT_FAILURE_HOURS = 24;
const MIN_LIVE_SAMPLES = 20;
const MIN_SUCCESS_RATE = 0.95;
const MAX_PARTIAL_RATE = 0.05;

interface ProviderSampleRow {
  provider: string;
  attempts: number;
  successes: number;
  failures: number;
  partial_attempts: number;
  latest_success_at: string | null;
  latest_failure_at: string | null;
}

interface AggregateSampleRow {
  attempts: number;
  successes: number;
  failures: number;
  partial_attempts: number;
  recent_failures: number;
  latest_success_at: string | null;
  latest_failure_at: string | null;
}

export interface MetaAdsBetaReadiness {
  ok: boolean;
  label: string;
  windowDays: number;
  sampleTarget: number;
  samples: number;
  completeSamples: number;
  successes: number;
  failures: number;
  partialAttempts: number;
  recentFailures: number;
  unrecoveredRecentFailures: number;
  successRate: number | null;
  partialRate: number | null;
  latestSuccessAt: string | null;
  latestFailureAt: string | null;
  blockers: string[];
  providerBreakdown: Array<{
    provider: string;
    samples: number;
    completeSamples: number;
    successes: number;
    failures: number;
    partialAttempts: number;
    successRate: number | null;
    partialRate: number | null;
    latestSuccessAt: string | null;
    latestFailureAt: string | null;
  }>;
}

export async function getMetaAdsBetaReadiness(
  env: AppEnv,
  now: Date = new Date(),
): Promise<MetaAdsBetaReadiness> {
  if (!env.DB) {
    return buildReadiness({
      aggregate: emptyAggregate(),
      extraBlockers: ["missing_db"],
      now,
      providerRows: [],
      visualProviderStatus: null,
    });
  }

  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const recentFailureSince = new Date(
    now.getTime() - RECENT_FAILURE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const [aggregate, providers, visualProviderState] = await Promise.all([
    env.DB
      .prepare(
        `
          SELECT
            COUNT(*) AS attempts,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS successes,
            SUM(CASE WHEN status = 'failed'
              AND COALESCE(json_extract(metadata_json, '$.partial'), 0) != 1
              THEN 1 ELSE 0 END) AS failures,
            SUM(CASE WHEN status = 'failed'
              AND COALESCE(json_extract(metadata_json, '$.partial'), 0) = 1
              THEN 1 ELSE 0 END) AS partial_attempts,
            SUM(CASE WHEN status = 'failed'
              AND COALESCE(json_extract(metadata_json, '$.partial'), 0) != 1
              AND created_at >= ? THEN 1 ELSE 0 END) AS recent_failures,
            MAX(CASE WHEN status = 'succeeded' THEN created_at ELSE NULL END) AS latest_success_at,
            MAX(CASE WHEN status = 'failed'
              AND COALESCE(json_extract(metadata_json, '$.partial'), 0) != 1
              THEN created_at ELSE NULL END) AS latest_failure_at
          FROM discovery_fetch_log
          WHERE (
              provider = 'meta_library_browser'
              OR (
                provider = 'meta_api'
                AND json_extract(metadata_json, '$.customerOwned') = 1
              )
            )
            AND created_at >= ?
        `,
      )
      .bind(recentFailureSince, since)
      .first<AggregateSampleRow>(),
    env.DB
      .prepare(
        `
          SELECT
            provider,
            COUNT(*) AS attempts,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS successes,
            SUM(CASE WHEN status = 'failed'
              AND COALESCE(json_extract(metadata_json, '$.partial'), 0) != 1
              THEN 1 ELSE 0 END) AS failures,
            SUM(CASE WHEN status = 'failed'
              AND COALESCE(json_extract(metadata_json, '$.partial'), 0) = 1
              THEN 1 ELSE 0 END) AS partial_attempts,
            MAX(CASE WHEN status = 'succeeded' THEN created_at ELSE NULL END) AS latest_success_at,
            MAX(CASE WHEN status = 'failed'
              AND COALESCE(json_extract(metadata_json, '$.partial'), 0) != 1
              THEN created_at ELSE NULL END) AS latest_failure_at
          FROM discovery_fetch_log
          WHERE (
              provider = 'meta_library_browser'
              OR (
                provider = 'meta_api'
                AND json_extract(metadata_json, '$.customerOwned') = 1
              )
            )
            AND created_at >= ?
          GROUP BY provider
          ORDER BY provider ASC
        `,
      )
      .bind(since)
      .all<ProviderSampleRow>(),
    getDiscoveryProviderState(env, "meta_library_browser").catch(() => null),
  ]);

  return buildReadiness({
    aggregate: aggregate ?? emptyAggregate(),
    extraBlockers: [],
    now,
    providerRows: providers.results ?? [],
    visualProviderStatus:
      visualProviderState?.metadata?.partial === true
        ? null
        : visualProviderState?.status ?? null,
  });
}

function buildReadiness(input: {
  aggregate: AggregateSampleRow;
  extraBlockers: string[];
  now: Date;
  providerRows: ProviderSampleRow[];
  visualProviderStatus: string | null;
}): MetaAdsBetaReadiness {
  const samples = Number(input.aggregate.attempts ?? 0);
  const successes = Number(input.aggregate.successes ?? 0);
  const failures = Number(input.aggregate.failures ?? 0);
  const partialAttempts = Number(input.aggregate.partial_attempts ?? 0);
  const completeSamples = Math.max(0, samples - partialAttempts);
  const recentFailures = Number(input.aggregate.recent_failures ?? 0);
  const successRate = completeSamples > 0 ? successes / completeSamples : null;
  const partialRate = samples > 0 ? partialAttempts / samples : null;
  const latestSuccessAt = input.aggregate.latest_success_at ?? null;
  const latestFailureAt = input.aggregate.latest_failure_at ?? null;
  const unrecoveredRecentFailures = hasRecoveredSinceLatestFailure(latestSuccessAt, latestFailureAt)
    ? 0
    : recentFailures;
  const blockers = [...input.extraBlockers];

  if (completeSamples < MIN_LIVE_SAMPLES) {
    blockers.push("not_enough_live_samples");
  }
  if (successRate === null || successRate < MIN_SUCCESS_RATE) {
    blockers.push("success_rate_below_95_percent");
  }
  if (!isRecentEnough(latestSuccessAt, input.now, RECENT_SUCCESS_HOURS)) {
    blockers.push("no_recent_live_success");
  }
  if (unrecoveredRecentFailures > 0) {
    blockers.push("recent_live_failures");
  }
  if (partialRate !== null && partialRate > MAX_PARTIAL_RATE) {
    blockers.push("partial_result_rate_above_5_percent");
  }
  if (input.visualProviderStatus && input.visualProviderStatus !== "healthy") {
    blockers.push("visual_path_not_healthy");
  }

  return {
    ok: blockers.length === 0,
    label: blockers.length === 0 ? "Ready to review graduation" : "Beta: needs validation",
    windowDays: WINDOW_DAYS,
    sampleTarget: MIN_LIVE_SAMPLES,
    samples,
    completeSamples,
    successes,
    failures,
    partialAttempts,
    recentFailures,
    unrecoveredRecentFailures,
    successRate,
    partialRate,
    latestSuccessAt,
    latestFailureAt,
    blockers,
    providerBreakdown: input.providerRows.map((row) => {
      const providerSamples = Number(row.attempts ?? 0);
      const providerSuccesses = Number(row.successes ?? 0);
      const providerPartialAttempts = Number(row.partial_attempts ?? 0);
      const providerCompleteSamples = Math.max(
        0,
        providerSamples - providerPartialAttempts,
      );
      return {
        provider: row.provider,
        samples: providerSamples,
        completeSamples: providerCompleteSamples,
        successes: providerSuccesses,
        failures: Number(row.failures ?? 0),
        partialAttempts: providerPartialAttempts,
        successRate:
          providerCompleteSamples > 0
            ? providerSuccesses / providerCompleteSamples
            : null,
        partialRate:
          providerSamples > 0
            ? providerPartialAttempts / providerSamples
            : null,
        latestSuccessAt: row.latest_success_at ?? null,
        latestFailureAt: row.latest_failure_at ?? null,
      };
    }),
  };
}

function emptyAggregate(): AggregateSampleRow {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    partial_attempts: 0,
    recent_failures: 0,
    latest_success_at: null,
    latest_failure_at: null,
  };
}

function isRecentEnough(value: string | null, now: Date, maxAgeHours: number) {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  return now.getTime() - timestamp <= maxAgeHours * 60 * 60 * 1000;
}

function hasRecoveredSinceLatestFailure(latestSuccessAt: string | null, latestFailureAt: string | null) {
  if (!latestSuccessAt || !latestFailureAt) {
    return false;
  }

  const latestSuccessMs = Date.parse(latestSuccessAt);
  const latestFailureMs = Date.parse(latestFailureAt);
  if (Number.isNaN(latestSuccessMs) || Number.isNaN(latestFailureMs)) {
    return false;
  }

  return latestSuccessMs > latestFailureMs;
}
