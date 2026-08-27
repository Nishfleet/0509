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
  it("seeds >=1 dated state for every sitemap brand domain", async () => {
    expect(SITEMAP_BRAND_DOMAINS).toHaveLength(25);
    for (const domain of SITEMAP_BRAND_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(
        loaded.entries.length,
        `${domain} should have a non-empty timeline`,
      ).toBeGreaterThanOrEqual(1);
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

  it("labels each sitemap-brand state with the honest no-screenshot evidence note", async () => {
    const loaded = await loadOfferTimeline(appEnv, {
      domain: "gymshark.com",
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
      domain: "adidas.com",
      asOf: null,
    });
    expect(loaded.entries.length).toBe(1);
    expect(loaded.entries[0]?.transition).toBeNull();
    expect(loaded.entries[0]?.headline).toBe("adidas. Athletic footwear and apparel.");
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
