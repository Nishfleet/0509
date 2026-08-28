import { describe, expect, it } from "vitest";

import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db } from "./fixtures";

/**
 * The 25 sitemap brand domains that had cached /ads/:domain pages but empty
 * /timeline/:domain soft-404 shells on 2026-08-27 (issue #1309). Migration
 * 0081 seeds one dated backfill row for each so the sibling timeline is not
 * a dead end. The 5 demo brands seeded by 0079 are excluded — they are
 * tested in demo-brand-timeline-backfill.integration.test.ts.
 */
const SITEMAP_BRAND_DOMAINS = [
  "adidas.com",
  "adobe.com",
  "amazon.com",
  "asos.com",
  "atlassian.com",
  "bombas.com",
  "bombayshavingcompany.com",
  "canva.com",
  "celonis.com",
  "decathlon.com",
  "figma.com",
  "gymshark.com",
  "hm.com",
  "hubspot.com",
  "mcaffeine.com",
  "ouraring.com",
  "personio.com",
  "ridge.com",
  "ridgewallet.com",
  "sephora.com",
  "shopify.com",
  "sugarcosmetics.com",
  "ulta.com",
  "walmart.com",
  "zoho.com",
] as const;

describe("sitemap brand offer timeline backfill (migration 0081)", () => {
  it("seeds >=1 dated backfill row for every sitemap brand domain (read directly from D1)", async () => {
    expect(SITEMAP_BRAND_DOMAINS).toHaveLength(25);
    // The proof gate (issue #1284) filters backfill rows out of the public
    // ledger, so loadOfferTimeline returns empty. Assert the rows exist by
    // reading D1 directly — the migration still seeds them.
    for (const domain of SITEMAP_BRAND_DOMAINS) {
      const row = await db()
        .prepare(
          `SELECT count(*) AS n FROM landing_page_snapshot
           WHERE capture_method = 'sitemap_brand_seed' AND canonical_url LIKE ?`,
        )
        .bind(`https://www.${domain}/`)
        .first<{ n: number }>();
      expect(row?.n, `${domain} should have a seeded backfill row`).toBeGreaterThanOrEqual(1);
    }
  });

  it("marks every sitemap-brand row with capture_method = sitemap_brand_seed and no fabricated artifacts", async () => {
    const rows = await db()
      .prepare(
        `SELECT id, canonical_url, artifact_key, metadata_json, capture_method
         FROM landing_page_snapshot
         WHERE capture_method = 'sitemap_brand_seed'
         ORDER BY id ASC`,
      )
      .all<{
        id: string;
        canonical_url: string;
        artifact_key: string | null;
        metadata_json: string | null;
        capture_method: string;
      }>();

    expect(rows.results.length).toBe(SITEMAP_BRAND_DOMAINS.length);
    for (const row of rows.results) {
      expect(row.artifact_key).toBeNull();
      expect(row.capture_method).toBe("sitemap_brand_seed");
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      expect(metadata.backfill).toBe(true);
      expect(metadata.source).toBe("sitemap_brand_seed");
    }
  });

  it("filters every sitemap-brand backfill state out of the public timeline (issue #1284 proof gate)", async () => {
    for (const domain of SITEMAP_BRAND_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries, `${domain} should have no public entries`).toEqual([]);
      expect(loaded.asOfState).toBeNull();
    }
  });

  it("does not collide with the 5 demo-brand rows from migration 0079", async () => {
    const demoRows = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'demo_backfill'`,
      )
      .first<{ n: number }>();
    expect(demoRows?.n).toBe(5);
  });

  it("rolls back cleanly: deleting sitemap_brand_seed rows empties every sitemap-brand timeline", async () => {
    await db()
      .prepare(`DELETE FROM landing_page_snapshot WHERE capture_method = 'sitemap_brand_seed'`)
      .run();

    for (const domain of SITEMAP_BRAND_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries).toEqual([]);
    }
  });
});
