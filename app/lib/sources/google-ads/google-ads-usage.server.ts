import type { AppEnv } from "~/lib/env.server";
import {
  getCaptureStats24h,
  recordCaptureAttempt,
  type CaptureCounters,
  type CaptureStats,
} from "~/lib/sources/capture-usage.server";

/**
 * Google Ads (Transparency Center) capture counters (issue #3197) — a thin
 * binding of the shared `capture-usage.server.ts` helper to this source's
 * `google_ads` key prefix.
 */

export type GoogleAdsCaptureCounters = CaptureCounters;
export type GoogleAdsCaptureStats = CaptureStats;

const SOURCE_ID = "google_ads";

/**
 * Record one capture attempt. Called by the adapter exactly once per
 * `fetch()` — success or failure. Every KV step is guarded; the worst case is
 * a silently unwritten counter, never a broken capture.
 */
export function recordGoogleAdsCaptureAttempt(
  env: AppEnv,
  outcome: { failed: boolean },
  now: Date = new Date(),
): Promise<void> {
  return recordCaptureAttempt(env, SOURCE_ID, outcome, now);
}

/**
 * Attempted/failed/rate for the 24h window, read as the union of today's and
 * yesterday's UTC day counters (two bounded reads; honest to the hour:
 * 24–48h depending on the time of day, which the /status copy states). Not
 * counted when the KV binding is absent or the read throws — the caller
 * omits the measured line rather than inventing a rate.
 */
export function getGoogleAdsCaptureStats24h(
  env: AppEnv,
  now: Date = new Date(),
): Promise<GoogleAdsCaptureStats> {
  return getCaptureStats24h(env, SOURCE_ID, now);
}
