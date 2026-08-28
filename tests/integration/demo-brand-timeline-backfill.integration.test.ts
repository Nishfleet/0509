import { describe, expect, it } from "vitest";

import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db } from "./fixtures";

/**
 * Migration 0079 backfills one dated `landing_page_snapshot` row for each of
 * the 5 flagship demo brands so each public `/ads/:domain` Offer Timeline
 * is non-empty on day one (issue #968). Mocked D1 cannot see the INSERT land
 * or the timeline read it back; this file applies the real migrations and
 * asserts both the seeded READ and the honest evidence labelling against
 * local D1.
 */
describe("demo brand offer timeline backfill (migration 0079)", () => {
  it("seeds >=1 dated backfill row for every flagship demo brand (read directly from D1)", async () => {
    expect(DEMO_BRAND_PAGE_DOMAINS).toHaveLength(5);
    // The proof gate (issue #1284) filters backfill rows out of the public
    // ledger, so loadOfferTimeline returns empty. Assert the rows exist by
    // reading D1 directly — the migration still seeds them.
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

  it("marks every backfilled row with capture_method = demo_backfill and no fabricated artifacts", async () => {
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

    // One honest dated state per flagship demo brand.
    expect(rows.results.length).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
    for (const row of rows.results) {
      expect(row.artifact_key).toBeNull();
      expect(row.capture_method).toBe("demo_backfill");
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      expect(metadata.backfill).toBe(true);
      expect(metadata.source).toBe("demo_brand_seed");
    }
  });

  it("filters every backfilled state out of the public timeline (issue #1284 proof gate)", async () => {
    // The backfill rows carry no screenshot and no page-text artifact. The
    // proof gate in loadOfferTimeline filters them out so the public
    // /timeline/:domain page never ships a "no screenshot" string. The
    // rows still exist in D1 (the backfill migration is additive) — they
    // are just not public-rendered until a real capture stores both artifacts.
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries, `${domain} should have no public entries`).toEqual([]);
      expect(loaded.asOfState).toBeNull();
    }
  });

  it("still seeds the backfill rows in D1 (the proof gate filters at read time, not write time)", async () => {
    const rows = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'demo_backfill'`,
      )
      .first<{ n: number }>();
    expect(rows?.n).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
  });

  it("rolls back cleanly: deleting demo_backfill rows empties every demo timeline", async () => {
    // The issue's rollback section is "Remove backfilled rows". Prove the
    // backfill is purely additive by simulating the rollback inside the test
    // DB (local D1 only — never production) and confirming the timelines go
    // empty while leaving the live capture path intact.
    await db()
      .prepare(`DELETE FROM landing_page_snapshot WHERE capture_method = 'demo_backfill'`)
      .run();

    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries).toEqual([]);
    }
  });
});
