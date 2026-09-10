import { describe, expect, it } from "vitest";

import {
  getOrCreatePersonalOrg,
  getOrgIdForUser,
  personalOrgIdForUser,
} from "~/lib/data/org.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "../fixtures";

/**
 * Migration-test gate for issue #2176, phase 1 — the org-scoped ownership
 * foundation. Proves the read AND write path through the new `org` table and
 * the nullable `org_id` columns against real D1 (the `workers` vitest project,
 * which applies the repo's real `migrations/*.sql` via
 * `tests/integration/apply-migrations.ts` before any test runs).
 *
 * This is the fleet-ops D1 expand/contract rule made runnable: phase 1 adds
 * the `org` table, backfills a personal org for every existing user, and adds
 * nullable `org_id` columns to watchlist / share_link / customer_api_key /
 * client_room. The migration is safe to apply on hot tables (no row rewrite,
 * no default, no NOT NULL), and the new columns must (a) exist on the schema,
 * (b) accept an org_id in a raw INSERT that mirrors the column list the
 * production create paths write, (c) accept NULL for legacy rows, and (d) the
 * `getOrCreatePersonalOrg` seam must resolve a user's personal org and create
 * it on demand for users who signed up after the backfill ran.
 *
 * The fleet-ops no-agent-names invariant holds: no agent names in the file
 * body, no Co-Authored-By trailers, no hand-built orchestration — the test
 * goes through `db().prepare(...)` against the same workerd + real D1 stack
 * the production code path uses.
 */

describe("migration 0088 — org-scoped ownership (issue #2176)", () => {
  it("(1) the org table exists with the expected schema", async () => {
    const masterRow = await db()
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'org'`,
      )
      .first<{ sql: string | null }>();
    expect(masterRow?.sql).toBeDefined();
    expect(masterRow?.sql).toMatch(/\borg\b/);
    expect(masterRow?.sql).toMatch(/owner_user_id/);
    expect(masterRow?.sql).toMatch(/FOREIGN KEY \(owner_user_id\)/i);
  });

  it("(2) the nullable org_id columns exist on the four keyed tables", async () => {
    const tables = ["watchlist", "share_link", "customer_api_key", "client_room"];
    for (const table of tables) {
      const masterRow = await db()
        .prepare(
          `SELECT sql FROM sqlite_master
           WHERE type = 'table' AND name = ?`,
        )
        .bind(table)
        .first<{ sql: string | null }>();
      expect(masterRow?.sql, `${table} DDL`).toBeDefined();
      expect(masterRow?.sql, `${table} has org_id`).toMatch(/\borg_id\b/);
    }
  });

  it("(3) accepts an org_id write and round-trips it on read (watchlist)", async () => {
    const userId = await seedUser();
    const orgId = personalOrgIdForUser(userId);
    const watchlistId = uid("wl_org");

    await db()
      .prepare(
        `INSERT INTO watchlist (
           id, user_id, name, target_type, tracking_role, target_id,
           target_fingerprint, target_label, is_active, created_at, updated_at, org_id
         ) VALUES (?, ?, ?, 'advertiser', 'competitor', ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        watchlistId,
        userId,
        `Org watchlist ${watchlistId}`,
        `target_${watchlistId}`,
        `fp_${watchlistId}`,
        `Label ${watchlistId}`,
        ISO_T0,
        ISO_T0,
        orgId,
      )
      .run();

    const row = await db()
      .prepare(`SELECT org_id FROM watchlist WHERE id = ?`)
      .bind(watchlistId)
      .first<{ org_id: string | null }>();
    expect(row?.org_id).toBe(orgId);
  });

  it("(4) accepts NULL on the org_id columns (legacy rows)", async () => {
    const userId = await seedUser();
    const watchlistId = uid("wl_legacy_org");
    await db()
      .prepare(
        `INSERT INTO watchlist (
           id, user_id, name, target_type, tracking_role, target_id,
           target_fingerprint, target_label, is_active, created_at, updated_at, org_id
         ) VALUES (?, ?, ?, 'advertiser', 'competitor', ?, ?, ?, 1, ?, ?, NULL)`,
      )
      .bind(
        watchlistId,
        userId,
        `Legacy watchlist ${watchlistId}`,
        `target_${watchlistId}`,
        `fp_${watchlistId}`,
        `Label ${watchlistId}`,
        ISO_T0,
        ISO_T0,
      )
      .run();

    const row = await db()
      .prepare(`SELECT org_id FROM watchlist WHERE id = ?`)
      .bind(watchlistId)
      .first<{ org_id: string | null }>();
    expect(row?.org_id).toBeNull();
  });

  it("(5) getOrCreatePersonalOrg resolves the backfilled org and creates on demand", async () => {
    // Backfilled user: the org already exists from the migration.
    const backfilledUserId = await seedUser();
    const backfilled = await getOrCreatePersonalOrg(appEnv, backfilledUserId);
    expect(backfilled.id).toBe(personalOrgIdForUser(backfilledUserId));
    expect(backfilled.ownerUserId).toBe(backfilledUserId);

    // A user inserted directly (bypassing the backfill) gets an org on demand.
    const freshUserId = uid("fresh_user");
    await db()
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(freshUserId, `Fresh ${freshUserId}`, `${freshUserId}@example.test`, ISO_T0, ISO_T0)
      .run();

    const fresh = await getOrCreatePersonalOrg(appEnv, freshUserId);
    expect(fresh.id).toBe(personalOrgIdForUser(freshUserId));
    expect(fresh.ownerUserId).toBe(freshUserId);

    // Idempotent: a second call returns the same org.
    const again = await getOrCreatePersonalOrg(appEnv, freshUserId);
    expect(again.id).toBe(fresh.id);

    // getOrgIdForUser resolves the org id.
    expect(await getOrgIdForUser(appEnv, freshUserId)).toBe(fresh.id);
  });
});
