import { getDiscoveryProviderState } from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";

const WINDOW_DAYS = 7;
const RECENT_SUCCESS_HOURS = 24;
const RECENT_FAILURE_HOURS = 24;
const MIN_LIVE_SAMPLES = 20;
const MIN_SUCCESS_RATE = 0.95;

interface ProviderSampleRow {
  provider: string;
  attempts: number;
  successes: number;
  failures: number;
  latest_success_at: string | null;
  latest_failure_at: string | null;
}

interface AggregateSampleRow {
  attempts: number;
  successes: number;
  failures: number;
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
  successes: number;
  failures: number;
  recentFailures: number;
  successRate: number | null;
  latestSuccessAt: string | null;
  latestFailureAt: string | null;
  blockers: string[];
  providerBreakdown: Array<{
    provider: string;
    samples: number;
    successes: number;
    failures: number;
    successRate: number | null;
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
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,
            SUM(CASE WHEN status = 'failed' AND created_at >= ? THEN 1 ELSE 0 END) AS recent_failures,
            MAX(CASE WHEN status = 'succeeded' THEN created_at ELSE NULL END) AS latest_success_at,
            MAX(CASE WHEN status = 'failed' THEN created_at ELSE NULL END) AS latest_failure_at
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
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,
            MAX(CASE WHEN status = 'succeeded' THEN created_at ELSE NULL END) AS latest_success_at,
            MAX(CASE WHEN status = 'failed' THEN created_at ELSE NULL END) AS latest_failure_at
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
    visualProviderStatus: visualProviderState?.status ?? null,
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
  const recentFailures = Number(input.aggregate.recent_failures ?? 0);
  const successRate = samples > 0 ? successes / samples : null;
  const latestSuccessAt = input.aggregate.latest_success_at ?? null;
  const blockers = [...input.extraBlockers];

  if (samples < MIN_LIVE_SAMPLES) {
    blockers.push("not_enough_live_samples");
  }
  if (successRate === null || successRate < MIN_SUCCESS_RATE) {
    blockers.push("success_rate_below_95_percent");
  }
  if (!isRecentEnough(latestSuccessAt, input.now, RECENT_SUCCESS_HOURS)) {
    blockers.push("no_recent_live_success");
  }
  if (recentFailures > 0) {
    blockers.push("recent_live_failures");
  }
  if (input.visualProviderStatus && input.visualProviderStatus !== "healthy") {
    blockers.push("visual_path_not_healthy");
  }

  return {
    ok: blockers.length === 0,
    label: blockers.length === 0 ? "Ready to review graduation" : "Beta: needs proof",
    windowDays: WINDOW_DAYS,
    sampleTarget: MIN_LIVE_SAMPLES,
    samples,
    successes,
    failures,
    recentFailures,
    successRate,
    latestSuccessAt,
    latestFailureAt: input.aggregate.latest_failure_at ?? null,
    blockers,
    providerBreakdown: input.providerRows.map((row) => {
      const providerSamples = Number(row.attempts ?? 0);
      const providerSuccesses = Number(row.successes ?? 0);
      return {
        provider: row.provider,
        samples: providerSamples,
        successes: providerSuccesses,
        failures: Number(row.failures ?? 0),
        successRate: providerSamples > 0 ? providerSuccesses / providerSamples : null,
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
