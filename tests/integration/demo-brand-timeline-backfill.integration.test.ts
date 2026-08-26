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
  it("seeds >=1 dated state for every flagship demo brand", async () => {
    expect(DEMO_BRAND_PAGE_DOMAINS).toHaveLength(5);
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(
        loaded.entries.length,
        `${domain} should have a non-empty timeline`,
      ).toBeGreaterThanOrEqual(1);
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

  it("labels each backfilled state with the honest no-screenshot evidence note", async () => {
    const loaded = await loadOfferTimeline(appEnv, {
      domain: "nike.com",
      asOf: null,
    });
    expect(loaded.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of loaded.entries) {
      expect(entry.screenshotHref).toBeNull();
      expect(entry.pageTextHref).toBeNull();
      expect(entry.evidenceNote).toContain("no screenshot");
      expect(entry.evidenceNote).toContain("25 Aug 2026");
    }
  });

  it("does not invent a before/after transition from a single seeded state", async () => {
    const loaded = await loadOfferTimeline(appEnv, {
      domain: "nykaa.com",
      asOf: null,
    });
    expect(loaded.entries.length).toBe(1);
    expect(loaded.entries[0]?.transition).toBeNull();
    expect(loaded.entries[0]?.headline).toBe("Nykaa. Beauty and wellness.");
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
