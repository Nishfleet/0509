import type { AppEnv } from "~/lib/env.server";
import {
  getCaptureStats24h,
  recordCaptureAttempt,
  type CaptureCounters,
  type CaptureStats,
} from "~/lib/sources/capture-usage.server";

/**
 * LinkedIn Ads (Ad Library) capture counters (issue #3196) — a thin binding
 * of the shared `capture-usage.server.ts` helper to this source's
 * `linkedin_ads` key prefix.
 *
 * One counted attempt per Library READ: the #2193 quota-deny returns before
 * any read happens and is not counted, so the rate measures Library-read
 * failures only.
 */

export type LinkedInAdsCaptureCounters = CaptureCounters;
export type LinkedInAdsCaptureStats = CaptureStats;

const SOURCE_ID = "linkedin_ads";

/**
 * Record one Library-read attempt. Called by the adapter exactly once per
 * Ad Library read — success or failure. Every KV step is guarded; the worst
 * case is a silently unwritten counter, never a broken capture.
 */
export function recordLinkedInAdsCaptureAttempt(
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
export function getLinkedInAdsCaptureStats24h(
  env: AppEnv,
  now: Date = new Date(),
): Promise<LinkedInAdsCaptureStats> {
  return getCaptureStats24h(env, SOURCE_ID, now);
}
