/**
 * Read-only aggregate queries for the funnel's account/workspace-scoped
 * derived measures (docs/funnel-measurement-spec.md §3.2). These are NOT
 * events and are never written to log records or any new storage: they are
 * counted straight off existing business tables. Leaf module — imports
 * `d1.server` directly (no `~/lib/data.server` cycle).
 */

import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

export interface FunnelDailyDerivedMetrics {
  day: string;
  signupCompletions: number;
  firstWatchlists: number;
  firstProofs: number;
}

interface DayCountRow {
  day: string;
  count: number;
}

/** Read-only daily aggregates over existing D1 records for the last `days`. */
export async function getFunnelDailyDerivedMetrics(
  env: AppEnv,
  days: number,
): Promise<FunnelDailyDerivedMetrics[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [signups, firstWatchlists, firstProofs] = await Promise.all([
    queryAll<DayCountRow>(
      env,
      `
        SELECT substr(createdAt, 1, 10) AS day, COUNT(*) AS count
        FROM user
        WHERE createdAt >= ?
        GROUP BY day
        ORDER BY day ASC
      `,
      since,
    ),
    queryAll<DayCountRow>(
      env,
      `
        SELECT substr(min_created, 1, 10) AS day, COUNT(*) AS count
        FROM (
          SELECT user_id, MIN(created_at) AS min_created
          FROM watchlist
          GROUP BY user_id
        )
        WHERE min_created >= ?
        GROUP BY day
        ORDER BY day ASC
      `,
      since,
    ),
    queryAll<DayCountRow>(
      env,
      `
        SELECT substr(min_succeeded, 1, 10) AS day, COUNT(*) AS count
        FROM (
          SELECT proof_target_id, MIN(succeeded_at) AS min_succeeded
          FROM proof_capture
          WHERE status = 'succeeded'
          GROUP BY proof_target_id
        )
        WHERE min_succeeded >= ?
        GROUP BY day
        ORDER BY day ASC
      `,
      since,
    ),
  ]);

  const byDay = new Map<string, FunnelDailyDerivedMetrics>();
  for (const row of signups) {
    byDay.set(row.day, { day: row.day, signupCompletions: Number(row.count), firstWatchlists: 0, firstProofs: 0 });
  }
  for (const row of firstWatchlists) {
    const entry = byDay.get(row.day) ?? { day: row.day, signupCompletions: 0, firstWatchlists: 0, firstProofs: 0 };
    entry.firstWatchlists = Number(row.count);
    byDay.set(row.day, entry);
  }
  for (const row of firstProofs) {
    const entry = byDay.get(row.day) ?? { day: row.day, signupCompletions: 0, firstWatchlists: 0, firstProofs: 0 };
    entry.firstProofs = Number(row.count);
    byDay.set(row.day, entry);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entry]) => entry);
}
