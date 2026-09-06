/**
 * Public /status health counters — aggregate, non-tenant monitoring facts.
 *
 * These are the only monitoring numbers surfaced on the public buyer-facing
 * status page: how many watchlist runs happened, how many failed, and the
 * last digest-delivery timestamp. No per-account or per-competitor data is
 * ever read here. Every query is a cheap aggregate or a single MAX/LIMIT 1
 * scan over an indexed column.
 */

import { queryOne as one } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

export interface PublicStatusCounters {
  /** ISO timestamp of the most recently started watchlist run, any status. */
  lastWatchlistRunAt: string | null;
  /** Number of watchlist runs started in the last 24 hours. */
  runsInLast24h: number;
  /** Number of watchlist runs in the last 24 hours whose status is `failed`. */
  failedRunsInLast24h: number;
  /** ISO timestamp of the most recently delivered digest, or null. */
  lastDigestSentAt: string | null;
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
    one<{ last_delivered_at: string | null }>(
      env,
      `
        SELECT MAX(delivered_at) AS last_delivered_at
        FROM digest_delivery
        WHERE status = 'sent'
      `,
    ),
  ]);

  return {
    lastWatchlistRunAt: lastRunRow?.last_started_at ?? null,
    runsInLast24h: Number(countsRow?.total ?? 0),
    failedRunsInLast24h: Number(countsRow?.failed ?? 0),
    lastDigestSentAt: digestRow?.last_delivered_at ?? null,
  };
}
