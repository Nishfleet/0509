import type { AppEnv } from "~/lib/env.server";

/**
 * Per-source capture counters (consolidated from the linkedin-ads and
 * google-ads usage modules, issue #3775).
 *
 * The /status capture-failure rate needs a denominator: the seam's
 * `source_snapshot` rows only record successes, so a failed source read
 * leaves no trace anywhere. This module mirrors the #2181
 * `decodo-budget.server.ts` KV pattern — one JSON counter per UTC day per
 * source in the seam's own KV namespace (the DECODO_BUDGET binding, the only
 * KV the competitor-monitoring seam has):
 *
 *   <sourceId>:captures:YYYY-MM-DD  →  {"attempted": n, "failed": m}
 *
 * Best-effort by design: KV is eventually consistent, every KV operation is
 * wrapped in one try/catch, and a counter failure never blocks or fails the
 * capture itself. When the binding is absent (it is not wired in
 * wrangler.jsonc yet — #2181's wiring decision) nothing is written and
 * /status omits the measured line entirely (the #2200 rule: missing = no
 * false claim). The 35-day TTL lets stale day counters expire, exactly like
 * the #2181 month counters.
 */

export interface CaptureCounters {
  attempted: number;
  failed: number;
}

export interface CaptureStats extends CaptureCounters {
  /**
   * failed / attempted, or null when no capture was attempted in the window
   * (a fabricated 0% would hide a dead source).
   */
  rate: number | null;
  /** False when the KV binding is absent or the read failed — /status omits. */
  counted: boolean;
}

const DAY_TTL_SECONDS = 35 * 24 * 60 * 60;

function dayKey(sourceId: string, date: Date): string {
  const iso = date.toISOString();
  return `${sourceId}:captures:${iso.slice(0, 10)}`;
}

function parseCounters(raw: string | null): CaptureCounters {
  if (!raw) return { attempted: 0, failed: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<CaptureCounters>;
    return {
      attempted: typeof parsed.attempted === "number" ? parsed.attempted : 0,
      failed: typeof parsed.failed === "number" ? parsed.failed : 0,
    };
  } catch {
    return { attempted: 0, failed: 0 };
  }
}

/**
 * Record one source-read attempt. Called by the adapter exactly once per
 * read — success or failure. Every KV step is guarded; the worst case is a
 * silently unwritten counter, never a broken capture.
 */
export async function recordCaptureAttempt(
  env: AppEnv,
  sourceId: string,
  outcome: { failed: boolean },
  now: Date = new Date(),
): Promise<void> {
  const kv = env.DECODO_BUDGET;
  if (!kv) return;
  try {
    const key = dayKey(sourceId, now);
    const current = parseCounters(await kv.get(key));
    const next: CaptureCounters = {
      attempted: current.attempted + 1,
      failed: current.failed + (outcome.failed ? 1 : 0),
    };
    await kv.put(key, JSON.stringify(next), { expirationTtl: DAY_TTL_SECONDS });
  } catch {
    // Best-effort by contract: a KV hiccup must never fail the capture.
  }
}

/**
 * Attempted/failed/rate for the 24h window, read as the union of today's and
 * yesterday's UTC day counters (two bounded reads; honest to the hour:
 * 24–48h depending on the time of day, which the /status copy states). Not
 * counted when the KV binding is absent or the read throws — the caller
 * omits the measured line rather than inventing a rate.
 */
export async function getCaptureStats24h(
  env: AppEnv,
  sourceId: string,
  now: Date = new Date(),
): Promise<CaptureStats> {
  const kv = env.DECODO_BUDGET;
  if (!kv) {
    return { attempted: 0, failed: 0, rate: null, counted: false };
  }
  try {
    const today = parseCounters(await kv.get(dayKey(sourceId, now)));
    const yesterday = parseCounters(
      await kv.get(dayKey(sourceId, new Date(now.getTime() - 24 * 60 * 60 * 1000))),
    );
    const attempted = today.attempted + yesterday.attempted;
    const failed = today.failed + yesterday.failed;
    return {
      attempted,
      failed,
      rate: attempted > 0 ? failed / attempted : null,
      counted: true,
    };
  } catch {
    return { attempted: 0, failed: 0, rate: null, counted: false };
  }
}
