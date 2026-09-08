import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { setupMigrations } from "./setup";

/**
 * P10-A job 1 — migration-chain integration test.
 *
 * The recos doc (§1.5/§1.6) names migration-sensitive queries as a
 * highest-risk path: the fleet's most dangerous change class is a schema
 * migration, and under the old mock-only suite nothing verifies the chain
 * applies cleanly or that the final schema is queryable. This test applies
 * the real `migrations/*.sql` chain to a fresh local D1 (via the
 * `applyD1Migrations` test API) and asserts:
 *
 *   1. every migration is recorded in `d1_migrations` (so a later `apply`
 *      is a no-op — the idempotency the production `wrangler d1 migrations
 *      apply` path relies on);
 *   2. the core tables the product depends on exist with the columns the
 *      data layer reads/writes;
 *   3. a representative migration-sensitive query (the watchlist → run →
 *      event join the dashboard feed uses) runs without error against the
 *      migrated schema.
 *
 * This is the spec-gate foundation: any future migration that breaks the
 * chain or renames a column the data layer reads fails here, before deploy.
 */

type AppEnv = typeof env;

describe("D1 migration chain (real workerd, real migrations/*.sql)", () => {
  beforeEach(async () => {
    await setupMigrations();
  });

  it("every migration is recorded in d1_migrations and re-applying is a no-op", async () => {
    const recorded = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM d1_migrations`,
    ).first<{ n: number }>();
    expect(recorded?.n).toBeGreaterThan(0);

    // Idempotency: applying the same chain again must not throw and must
    // not duplicate rows. This is the property `wrangler d1 migrations
    // apply` relies on in CI.
    await setupMigrations();
    const reRecorded = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM d1_migrations`,
    ).first<{ n: number }>();
    expect(reRecorded?.n).toBe(recorded?.n);
  });

  it("the core tables the data layer depends on exist", async () => {
    const tables = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
    ).all<{ name: string }>();
    const names = new Set(tables.results.map((r) => r.name));
    // A representative slice of the tables the data layer reads/writes.
    // If a migration renames or drops one, this fails before deploy.
    for (const table of [
      "watchlist",
      "watchlist_run",
      "watch_event",
      "event_candidate",
      "ad",
      "landing_page_snapshot",
      "ad_observation",
      "analysis_field",
      "proof_target",
      "proof_capture",
    ]) {
      expect(names.has(table), `table ${table} missing after migration chain`).toBe(true);
    }
  });

  it("the dashboard feed join runs against the migrated schema", async () => {
    // Seed the minimum rows the listRecentWorkspaceWatchEvents join needs:
    // user → watchlist → watchlist_run → watch_event. Then run the exact
    // join shape the dashboard feed uses and assert it returns the row.
    const now = "2026-08-25T10:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u_j', 'J', 'j@example.com', 1, ?, ?)`,
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at) VALUES ('wl_j', 'u_j', 'J', 'advertiser', 't_j', 'fp_j', 'J', 1, ?, ?)`,
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at) VALUES ('run_j', 'wl_j', 'scheduled', 'succeeded', 3, 1, '{}', ?, ?, ?)`,
    )
      .bind(now, now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO watch_event (id, watchlist_id, run_id, event_type, title, summary, metadata_json, created_at) VALUES ('we_j', 'wl_j', 'run_j', 'ad_new', 'New', 'first', '{}', ?)`,
    )
      .bind(now)
      .run();

    // The join from listRecentWorkspaceWatchEvents: watch_event INNER JOIN
    // watchlist, filtered to active watchlists and non-suppressed events.
    const rows = await env.DB.prepare(
      `SELECT watch_event.id, watch_event.event_type
         FROM watch_event
         INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
        WHERE watchlist.user_id = ?
          AND watchlist.is_active = 1
          AND watch_event.status NOT IN ('suppressed', 'invalidated')
        ORDER BY watch_event.created_at DESC, watch_event.id DESC
        LIMIT ?`,
    )
      .bind("u_j", 8)
      .all<{ id: string; event_type: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].id).toBe("we_j");
    expect(rows.results[0].event_type).toBe("ad_new");
  });
});
