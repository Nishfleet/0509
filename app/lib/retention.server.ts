import type { AppEnv } from "~/lib/env.server";

// Bounded retention deletes, run from the six-hourly warmup cron. Before
// this, thirteen tables grew forever (the only deletes in the codebase were
// rate-limit cleanup and rebuild deletes). Each step removes a small batch
// per tick via the id-subselect pattern — D1 has no DELETE ... LIMIT — so a
// backlog drains across ticks without blowing the invocation budget.
//
// Deliberately retained forever: digest_run/digest_item (customer-facing
// history), proof_usage_credit and the webhook event ledgers (billing audit
// trail), and the newest runs per watchlist (change-detection baselines).

const DAY_MS = 24 * 60 * 60 * 1000;

const FETCH_LOG_RETENTION_DAYS = 30;
const META_LOG_RETENTION_DAYS = 30;
const EXPIRED_CACHE_GRACE_DAYS = 7;
const MAGIC_LINK_TICKET_GRACE_DAYS = 1;
const WATCHLIST_RUN_RETENTION_DAYS = 90;
const WATCHLIST_RUN_KEEP_NEWEST = 5;
const DELIVERY_ATTEMPT_RETENTION_DAYS = 180;
const SNAPSHOT_RETENTION_DAYS = 90;

export async function runRetentionSweep(env: AppEnv) {
  if (!env.DB) {
    return { deleted: {} as Record<string, number> };
  }

  const now = Date.now();
  const cutoff = (days: number) => new Date(now - days * DAY_MS).toISOString();

  const steps: Array<{ name: string; sql: string; bindings: unknown[] }> = [
    {
      name: "discovery_fetch_log",
      sql: `
        DELETE FROM discovery_fetch_log
        WHERE id IN (
          SELECT id FROM discovery_fetch_log
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(FETCH_LOG_RETENTION_DAYS)],
    },
    {
      name: "discovery_cache_entry",
      sql: `
        DELETE FROM discovery_cache_entry
        WHERE cache_key IN (
          SELECT cache_key FROM discovery_cache_entry
          WHERE expires_at < ?
          LIMIT 200
        )
      `,
      bindings: [cutoff(EXPIRED_CACHE_GRACE_DAYS)],
    },
    {
      name: "better_auth_magic_link_ticket",
      sql: `
        DELETE FROM better_auth_magic_link_ticket
        WHERE id IN (
          SELECT id FROM better_auth_magic_link_ticket
          WHERE expires_at < ?
             OR consumed_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(MAGIC_LINK_TICKET_GRACE_DAYS), cutoff(MAGIC_LINK_TICKET_GRACE_DAYS)],
    },
    {
      name: "meta_integration_log",
      sql: `
        DELETE FROM meta_integration_log
        WHERE id IN (
          SELECT id FROM meta_integration_log
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(META_LOG_RETENTION_DAYS)],
    },
    {
      // Old runs cascade-clean their ad_observation/watch_event/
      // event_candidate children. Kept out of deletion: runs referenced as a
      // change-detection baseline anywhere, and the newest N runs of every
      // watchlist (so a paused watchlist keeps its baseline when reactivated).
      name: "watchlist_run",
      sql: `
        DELETE FROM watchlist_run
        WHERE id IN (
          SELECT id FROM (
            SELECT
              id,
              started_at,
              ROW_NUMBER() OVER (
                PARTITION BY watchlist_id
                ORDER BY started_at DESC
              ) AS recency_rank
            FROM watchlist_run
          )
          WHERE recency_rank > ?
            AND started_at < ?
            AND id NOT IN (
              SELECT baseline_from_run_id FROM watchlist_run
              WHERE baseline_from_run_id IS NOT NULL
              UNION
              SELECT baseline_from_run_id FROM watch_event
              WHERE baseline_from_run_id IS NOT NULL
            )
          LIMIT 100
        )
      `,
      bindings: [WATCHLIST_RUN_KEEP_NEWEST, cutoff(WATCHLIST_RUN_RETENTION_DAYS)],
    },
    {
      // 180 days keeps delivery history through any billing-dispute window.
      name: "delivery_attempt",
      sql: `
        DELETE FROM delivery_attempt
        WHERE id IN (
          SELECT id FROM delivery_attempt
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(DELIVERY_ATTEMPT_RETENTION_DAYS)],
    },
    {
      name: "landing_page_snapshot",
      sql: `
        DELETE FROM landing_page_snapshot
        WHERE id IN (
          SELECT snapshot.id FROM landing_page_snapshot AS snapshot
          WHERE snapshot.created_at < ?
            AND NOT EXISTS (
              SELECT 1 FROM ad_observation
              WHERE ad_observation.landing_page_snapshot_id = snapshot.id
            )
          LIMIT 200
        )
      `,
      bindings: [cutoff(SNAPSHOT_RETENTION_DAYS)],
    },
  ];

  const deleted: Record<string, number> = {};

  for (const step of steps) {
    try {
      const result = await env.DB.prepare(step.sql).bind(...step.bindings).run();
      deleted[step.name] = Number(result.meta?.changes ?? 0);
    } catch (error) {
      // One stuck table must not stop the rest of the sweep.
      console.error(`[retention] delete failed for ${step.name}`, error);
    }
  }

  return { deleted };
}
