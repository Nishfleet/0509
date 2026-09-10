import { describe, expect, it } from "vitest";

import { persistCompetitorUpdate } from "~/lib/sources/run.server";
import { appEnv, db, seedUser, uid } from "./fixtures";

/**
 * Seam #2218 — migration 0088 integration test.
 *
 * Asserts the migration applies on a fresh D1 (the `workers` project applies
 * the real migrations) and that the new read/write paths work:
 *   1. the four nullable columns exist on `watchlist` and default to NULL;
 *   2. the `source_snapshot` table accepts and returns rows for every
 *      registered source_id.
 */

describe("migration 0088 — competitor source fields", () => {
  it("adds the four nullable columns to watchlist (all default to NULL)", async () => {
    const userId = await seedUser(uid("user"));
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(watchlistId, userId, "Test", "t1", "fp1", "Test Co", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    const row = await db()
      .prepare(
        `SELECT tiktok_advertiser, job_board_provider, job_board_slug, job_board_verified
         FROM watchlist WHERE id = ?`,
      )
      .bind(watchlistId)
      .first();

    expect(row).not.toBeNull();
    expect(row?.tiktok_advertiser).toBeNull();
    expect(row?.job_board_provider).toBeNull();
    expect(row?.job_board_slug).toBeNull();
    expect(row?.job_board_verified).toBeNull();
  });

  it("allows writing the new columns", async () => {
    const userId = await seedUser(uid("user"));
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(watchlistId, userId, "Test2", "t2", "fp2", "Test Co2", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    await db()
      .prepare(
        `UPDATE watchlist SET tiktok_advertiser = ?, job_board_provider = ?, job_board_slug = ?, job_board_verified = 1 WHERE id = ?`,
      )
      .bind("tt-adv-1", "greenhouse", "test-co", watchlistId)
      .run();

    const row = await db()
      .prepare(
        `SELECT tiktok_advertiser, job_board_provider, job_board_slug, job_board_verified FROM watchlist WHERE id = ?`,
      )
      .bind(watchlistId)
      .first();

    expect(row?.tiktok_advertiser).toBe("tt-adv-1");
    expect(row?.job_board_provider).toBe("greenhouse");
    expect(row?.job_board_slug).toBe("test-co");
    expect(row?.job_board_verified).toBe(1);
  });
});

describe("migration 0088 — source_snapshot table", () => {
  it("accepts and returns rows for every registered source_id", async () => {
    const userId = await seedUser(uid("user"));
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(watchlistId, userId, "Test3", "t3", "fp3", "Test Co3", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    const sourceIds = ["google", "google_ads", "linkedin", "tiktok", "subdomains", "hiring"];
    for (const sourceId of sourceIds) {
      const id = `ss_${sourceId}_${watchlistId}`;
      await db()
        .prepare(
          `INSERT INTO source_snapshot (id, watchlist_id, source_id, fetched_at, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, watchlistId, sourceId, "2026-09-10T00:00:00Z", `{"test":"${sourceId}"}`, "2026-09-10T00:00:00Z")
        .run();
    }

    const rows = await db()
      .prepare(
        `SELECT source_id, payload_json FROM source_snapshot WHERE watchlist_id = ? ORDER BY source_id`,
      )
      .bind(watchlistId)
      .all();

    expect(rows.results.map((r) => r.source_id)).toEqual([...sourceIds].sort());
    const googleRow = rows.results.find((r) => r.source_id === "google");
    expect(JSON.parse(String(googleRow?.payload_json ?? "{}"))).toEqual({ test: "google" });
  });

  it("rejects an invalid source_id via CHECK constraint", async () => {
    const userId = await seedUser(uid("user"));
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(watchlistId, userId, "Test4", "t4", "fp4", "Test Co4", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    await expect(
      db()
        .prepare(
          `INSERT INTO source_snapshot (id, watchlist_id, source_id, fetched_at, payload_json, created_at)
           VALUES (?, ?, 'invalid_source', ?, '{}', ?)`,
        )
        .bind(`ss_bad_${watchlistId}`, watchlistId, "2026-09-10T00:00:00Z", "2026-09-10T00:00:00Z")
        .run(),
    ).rejects.toThrow();
  });
});

describe("migration 0088 — competitorUpdate write-back (runSources)", () => {
  it("persistCompetitorUpdate writes the tiktok_advertiser column", async () => {
    const userId = await seedUser(uid("user"));
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(watchlistId, userId, "TikTok Co", "t5", "fp5", "TikTok Co", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    await persistCompetitorUpdate(appEnv, watchlistId, {
      tiktok_advertiser: "tt-adv-from-fetch",
    });

    const row = await db()
      .prepare("SELECT tiktok_advertiser FROM watchlist WHERE id = ?")
      .bind(watchlistId)
      .first();
    expect(row?.tiktok_advertiser).toBe("tt-adv-from-fetch");
  });

  it("persistCompetitorUpdate writes the job_board_* triple and coerces verified to 0/1", async () => {
    const userId = await seedUser(uid("user"));
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(watchlistId, userId, "Hiring Co", "t6", "fp6", "Hiring Co", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    await persistCompetitorUpdate(appEnv, watchlistId, {
      job_board_provider: "greenhouse",
      job_board_slug: "hiring-co",
      job_board_verified: 1,
    });

    const row = await db()
      .prepare(
        "SELECT job_board_provider, job_board_slug, job_board_verified FROM watchlist WHERE id = ?",
      )
      .bind(watchlistId)
      .first();
    expect(row?.job_board_provider).toBe("greenhouse");
    expect(row?.job_board_slug).toBe("hiring-co");
    expect(row?.job_board_verified).toBe(1);
  });

  it("persistCompetitorUpdate is a no-op for an empty update", async () => {
    const userId = await seedUser(uid("user"));
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(watchlistId, userId, "Empty Co", "t7", "fp7", "Empty Co", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    // An empty update must not throw and must not change any column.
    await persistCompetitorUpdate(appEnv, watchlistId, {});
    const row = await db()
      .prepare("SELECT tiktok_advertiser, job_board_provider FROM watchlist WHERE id = ?")
      .bind(watchlistId)
      .first();
    expect(row?.tiktok_advertiser).toBeNull();
    expect(row?.job_board_provider).toBeNull();
  });
});
