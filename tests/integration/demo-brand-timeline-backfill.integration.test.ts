import { describe, expect, it } from "vitest";

import { DEMO_BRAND_SEED_SQL } from "../../scripts/seed-demo-brands.mjs";
import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db } from "./fixtures";

/**
 * Migration 0079 originally baked 5 demo-brand offer-timeline rows into every
 * fresh D1. Issue #2344 moved those rows into `scripts/seed-demo-brands.mjs`
 * so integration-test DBs stay schema-only (0079 is skipped by name in
 * apply-migrations.ts). This file drives the replacement seed onto real
 * local D1 (real workerd via Miniflare) and asserts the same honest-evidence
 * contract the migration used to guarantee.
 */
describe("demo brand offer timeline seed (replaces migration 0079 seed)", () => {
  it("starts schema-only: migration 0079 did not bake demo rows into the test DB", async () => {
    expect(DEMO_BRAND_PAGE_DOMAINS).toHaveLength(5);
    const row = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'demo_backfill'`,
      )
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("seeds >=1 dated backfill row for every flagship demo brand after the runbook runs", async () => {
    await db().prepare(DEMO_BRAND_SEED_SQL).run();
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const row = await db()
        .prepare(
          `SELECT count(*) AS n FROM landing_page_snapshot
           WHERE capture_method = 'demo_backfill' AND canonical_url LIKE ?`,
        )
        .bind(`https://www.${domain}/`)
        .first<{ n: number }>();
      expect(row?.n, `${domain} should have a seeded backfill row`).toBeGreaterThanOrEqual(1);
    }
  });

  it("marks every seeded row with capture_method = demo_backfill and no fabricated artifacts", async () => {
    await db().prepare(DEMO_BRAND_SEED_SQL).run();
    const rows = await db()
      .prepare(
        `SELECT id, canonical_url, artifact_key, metadata_json, capture_method
         FROM landing_page_snapshot
         WHERE capture_method = 'demo_backfill'
         ORDER BY id ASC`,
      )
      .all<{
        id: string;
        canonical_url: string;
        artifact_key: string | null;
        metadata_json: string | null;
        capture_method: string;
      }>();

    expect(rows.results.length).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
    for (const row of rows.results) {
      expect(row.artifact_key).toBeNull();
      expect(row.capture_method).toBe("demo_backfill");
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      expect(metadata.backfill).toBe(true);
      expect(metadata.source).toBe("demo_brand_seed");
    }
  });

  it("is idempotent: re-running the runbook never replicates the seed rows", async () => {
    await db().prepare(DEMO_BRAND_SEED_SQL).run();
    await db().prepare(DEMO_BRAND_SEED_SQL).run();
    const rows = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'demo_backfill'`,
      )
      .first<{ n: number }>();
    expect(rows?.n).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
  });

  it("filters every seeded state out of the public timeline (issue #1284 proof gate)", async () => {
    await db().prepare(DEMO_BRAND_SEED_SQL).run();
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries, `${domain} should have no public entries`).toEqual([]);
      expect(loaded.asOfState).toBeNull();
    }
  });

  it("rolls back cleanly: deleting demo_backfill rows empties every demo timeline", async () => {
    await db().prepare(DEMO_BRAND_SEED_SQL).run();
    await db()
      .prepare(`DELETE FROM landing_page_snapshot WHERE capture_method = 'demo_backfill'`)
      .run();

    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries).toEqual([]);
    }
  });
});
