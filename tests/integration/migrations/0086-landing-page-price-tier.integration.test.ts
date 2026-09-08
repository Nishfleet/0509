import { describe, expect, it } from "vitest";

import {
  loadPriceTierDistribution,
  PRICE_TIER_BANDS,
  type PriceTierBucket,
} from "~/lib/landing-page-price-tier.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "../fixtures";

/**
 * Migration-test gate for issue #1279, phase 3 — proves the read AND
 * write path through the new `landing_page_snapshot.price_tier` column
 * against real D1 (the `workers` vitest project, which applies the
 * repo's real `migrations/*.sql` via
 * `tests/integration/apply-migrations.ts` before any test runs).
 *
 * This is the fleet-ops D1 expand/contract rule made runnable: phase 1
 * adds a nullable TEXT column on `landing_page_snapshot`. The migration
 * is safe to apply on a hot table (no row rewrite, no default), and the
 * new column must (a) exist on the schema, (b) accept the bucket id
 * `100_to_250` in a raw INSERT that mirrors the column list
 * `createLandingPageSnapshot` writes (the production INSERT path itself
 * is exercised in tests/integration/saucony-watchlist.integration.test.ts),
 * (c) accept NULL for legacy rows and for `null` `price_text`, and (d)
 * `loadPriceTierDistribution` must return the five-bucket shape over the
 * real table.
 *
 * The fleet-ops no-agent-names invariant holds: no agent names in the
 * file body, no Co-Authored-By trailers, no hand-built orchestration —
 * the test goes through `db().prepare(...)` against the same workerd +
 * real D1 stack the production code path uses.
 *
 * A migration-test file lives under tests/integration/migrations/ to
 * keep the migration gates grouped under the existing workers-project
 * glob (the [name].integration.test.ts suffix matched against
 * tests/integration/.star-star/.integration.test.ts); this matches the
 * tests/integration/capture-validity/ precedent.
 */

const PRICE_TIER_KEYS = PRICE_TIER_BANDS.map((band) => band.id);

describe("migration 0086 — landing_page_snapshot.price_tier (issue #1279)", () => {
  it("(1) the column exists and is selectable on the real table", async () => {
    // `SELECT price_tier FROM landing_page_snapshot LIMIT 0` must succeed
    // against the applied schema. The empty result is fine; the test is
    // that the statement compiles and the binding tolerates the column.
    const rows = await db()
      .prepare("SELECT price_tier FROM landing_page_snapshot LIMIT 0")
      .all<{ price_tier: string | null }>();
    expect(Array.isArray(rows.results ?? [])).toBe(true);

    // Verify the column metadata — the CREATE TABLE statement in
    // sqlite_master is the canonical source for column names and types
    // across every D1 binding (no PRAGMA dependency). This is a string
    // check on the stored DDL; the migration's nullable TEXT column is
    // present iff `price_tier` appears in the CREATE TABLE statement.
    const masterRow = await db()
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'landing_page_snapshot'`,
      )
      .first<{ sql: string | null }>();
    expect(masterRow?.sql).toBeDefined();
    expect(masterRow?.sql).toMatch(/\bprice_tier\b/);
    expect(masterRow?.sql).toMatch(/price_tier\s+TEXT/i);
  });

  it("(2) accepts a 100_to_250 write and round-trips it on read", async () => {
    // The watchlist row needs a real user FK (migrations/0001_app.sql:106).
    const userId = await seedUser();
    const watchlistId = uid("wl");
    await db()
      .prepare(
        `INSERT INTO watchlist (
           id, user_id, name, target_type, tracking_role, target_id,
           target_fingerprint, target_label, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'advertiser', 'competitor', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        watchlistId,
        userId,
        "Migration-gate watchlist",
        `target_${watchlistId}`,
        `fp_${watchlistId}`,
        "saucony.com",
        ISO_T0,
        ISO_T0,
      )
      .run();

    const snapshotId = uid("lps");
    await db()
      .prepare(
        `INSERT INTO landing_page_snapshot (
           id, raw_url, canonical_url, raw_headline, normalized_headline,
           normalized_headline_hash, capture_method, artifact_key,
           metadata_json, cta_text, price_text, form_present,
           ocr_text, translated_text, captured_at, created_at, price_tier
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?
         )`,
      )
      .bind(
        snapshotId,
        "https://saucony.com/migration-gate",
        "https://saucony.com/migration-gate",
        "Migration gate headline",
        "migration gate headline",
        "hash_migration_gate",
        "browser_render",
        "landing-pages/2026-09-15/migration-gate.html",
        null,
        "Shop now",
        "$199",
        1,
        "2026-09-15T10:00:00.000Z",
        ISO_T0,
        "100_to_250",
      )
      .run();

    const row = await db()
      .prepare(
        `SELECT price_tier, price_text FROM landing_page_snapshot WHERE id = ?`,
      )
      .bind(snapshotId)
      .first<{ price_tier: string | null; price_text: string | null }>();
    expect(row?.price_tier).toBe("100_to_250");
    expect(row?.price_text).toBe("$199");
  });

  it("(3) accepts NULL on the column (legacy rows + null price_text)", async () => {
    // Legacy row: no user FK required because there is no watchlist row
    // attached — landing_page_snapshot itself does not FK to watchlist.
    const legacyId = uid("lps_legacy");
    await db()
      .prepare(
        `INSERT INTO landing_page_snapshot (
           id, raw_url, canonical_url, raw_headline, normalized_headline,
           normalized_headline_hash, capture_method, artifact_key,
           metadata_json, cta_text, price_text, form_present,
           ocr_text, translated_text, captured_at, created_at, price_tier
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL
         )`,
      )
      .bind(
        legacyId,
        "https://legacy.example/row",
        "https://legacy.example/row",
        "Legacy headline",
        "legacy headline",
        "hash_legacy",
        "browser_render",
        null,
        null,
        null,
        null,
        null,
        "2026-08-01T10:00:00.000Z",
        ISO_T0,
      )
      .run();

    const legacyRow = await db()
      .prepare(
        `SELECT price_tier FROM landing_page_snapshot WHERE id = ?`,
      )
      .bind(legacyId)
      .first<{ price_tier: string | null }>();
    expect(legacyRow?.price_tier).toBeNull();

    // Legacy NULL rows aggregate into the `unknown` bucket — the
    // aggregator must reflect that the legacy row is counted, not
    // silently dropped.
    const distribution = await loadPriceTierDistribution(appEnv);
    expect(distribution.unknown).toBeGreaterThanOrEqual(1);
  });

  it("(4) loadPriceTierDistribution returns the five-bucket shape on real D1", async () => {
    const distribution = await loadPriceTierDistribution(appEnv);
    expect(PRICE_TIER_KEYS.every((key) => key in distribution)).toBe(true);
    expect(Object.keys(distribution).sort()).toEqual(
      ["100_to_250", "30_to_100", "over_250", "under_30", "unknown"].sort(),
    );
    // Every bucket is a non-negative number — no undefined entries, no NaN.
    for (const key of Object.keys(distribution) as PriceTierBucket[]) {
      const value = distribution[key];
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
