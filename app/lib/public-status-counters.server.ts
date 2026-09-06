/**
 * Public /status health counters — aggregate, non-tenant monitoring facts.
 *
 * These are the only monitoring numbers surfaced on the public buyer-facing
 * status page: how many watchlist runs happened, how many failed, and the
 * last digest-sent timestamp. No per-account or per-competitor data is
 * ever read here. Every query is a cheap aggregate or a single MAX/LIMIT 1
 * scan over an indexed column.
 */

import { queryOne as one } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

export const DIGEST_STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Honest digest-pipeline state for /status.
 *
 * `recent`: a digest was sent within the staleness threshold. The
 * Cloudflare Email channel records a delivery as `sent` at provider-accept
 * time (`created_at`); see the note on `lastDigestSentAt` below.
 *
 * `stalled`: no digest has been sent for more than the 7-day threshold while
 * watchlist monitoring is otherwise healthy. This is the contradiction the
 * trust surface must never render silently — monitoring alive but the brief
 * pipeline silent.
 *
 * `unknown`: either we have no digest record at all and monitoring is also
 * silent, or this is the pre-send bootstrap. Not a contradiction, so the page
 * shows honest prose instead of a fabricated stall.
 */
export type DigestHealthState = "recent" | "stalled" | "unknown";

export function digestHealthState(counters: {
  runsInLast24h: number;
  failedRunsInLast24h: number;
  lastDigestSentAt: string | null;
}): DigestHealthState {
  // "Monitoring healthy" = at least one run succeeded in the last 24h. A
  // digest stall is only a contradiction (the thing the detector exists to
  // surface) when monitoring is genuinely succeeding — if every run is
  // failing the whole pipeline is down, not just digests.
  const monitoringHealthy =
    counters.runsInLast24h - counters.failedRunsInLast24h > 0;
  if (!counters.lastDigestSentAt) {
    // Without a send record, a stall claim would need healthy monitoring to
    // support it (the product has been sending since before this page existed).
    return monitoringHealthy ? "stalled" : "unknown";
  }
  const ageMs = Date.now() - new Date(counters.lastDigestSentAt).getTime();
  if (ageMs <= DIGEST_STALENESS_THRESHOLD_MS) {
    return "recent";
  }
  return monitoringHealthy ? "stalled" : "unknown";
}

export interface PublicStatusCounters {
  /** ISO timestamp of the most recently started watchlist run, any status. */
  lastWatchlistRunAt: string | null;
  /** Number of watchlist runs started in the last 24 hours. */
  runsInLast24h: number;
  /** Number of watchlist runs in the last 24 hours whose status is `failed`. */
  failedRunsInLast24h: number;
  /** ISO timestamp of the most recently sent digest, or null. */
  lastDigestSentAt: string | null;
  /**
   * Derived contradiction state (see {@link digestHealthState}): `recent` when
   * a digest was sent recently, `stalled` when digests are silent while
   * monitoring is healthy, `unknown` otherwise.
   */
  digestHealth: DigestHealthState;
}

/**
 * Read the aggregate monitoring counters for /status. Returns null when the
 * database is not configured so the route can degrade to static prose. A
 * live D1 read error propagates so the route's loader can catch it and
 * degrade explicitly (requirement: a stale number is never rendered without
 * its timestamp).
 */
export async function getPublicStatusCounters(
  env: AppEnv,
): Promise<PublicStatusCounters | null> {
  if (!env.DB) {
    return null;
  }

  const dayAgoIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const [lastRunRow, countsRow, digestRow] = await Promise.all([
    one<{ last_started_at: string | null }>(
      env,
      `SELECT MAX(started_at) AS last_started_at FROM watchlist_run`,
    ),
    one<{ total: number; failed: number }>(
      env,
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM watchlist_run
        WHERE started_at >= ?
      `,
      dayAgoIso,
    ),
    one<{ last_digest_sent_at: string | null }>(
      env,
      `
        SELECT MAX(created_at) AS last_digest_sent_at
        FROM digest_delivery
        WHERE status = 'sent'
      `,
    ),
  ]);

  const counters = {
    lastWatchlistRunAt: lastRunRow?.last_started_at ?? null,
    runsInLast24h: Number(countsRow?.total ?? 0),
    failedRunsInLast24h: Number(countsRow?.failed ?? 0),
    lastDigestSentAt: digestRow?.last_digest_sent_at ?? null,
  };

  // The `lastDigestSentAt` timestamp MUST never be read from `delivered_at`:
  // the Cloudflare Email channel records a digest as `sent` at provider-accept
  // time and has no delivery-confirmation webhook, so `delivered_at` is NULL
  // for email digests (issue #1780). `MAX(delivered_at)` therefore freezes at
  // the last confirmed delivery — a stale date that contradicts the healthy
  // watchlist counters right beside it on the same page. Reading `created_at`
  // across `status = 'sent'` returns the true last-sent timestamp. If email
  // confirmation is ever wired, switch this back to `MAX(delivered_at)`.
  return {
    ...counters,
    digestHealth: digestHealthState(counters),
  };
}
