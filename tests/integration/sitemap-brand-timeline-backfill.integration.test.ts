import { describe, expect, it } from "vitest";

import { SITEMAP_BRAND_SEED_SQL } from "../../scripts/seed-demo-brands.mjs";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db } from "./fixtures";

/**
 * The 25 sitemap brand domains that had cached /ads/:domain pages but empty
 * /timeline/:domain soft-404 shells on 2026-08-27 (issue #1309). Migration
 * 0081 seeded one dated row for each; the 5 demo brands seeded by 0079 are
 * excluded (they are covered by demo-brand-timeline-backfill.integration.test.ts).
 *
 * Issue #2344 moves these rows out of the schema chain into the
 * `scripts/seed-demo-brands.mjs` runbook, so integration-test DBs are
 * schema-only. This file drives the replacement sitemap INSERT onto the real
 * migration set (real workerd + local D1) and asserts the honest-evidence
 * contract the migration used to guarantee.
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

describe("sitemap brand offer timeline seed (replaces migration 0081 seed)", () => {
  it("starts schema-only: migration 0081 did not bake sitemap rows into the test DB", async () => {
    expect(SITEMAP_BRAND_DOMAINS).toHaveLength(25);
    const row = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'sitemap_brand_seed'`,
      )
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("seeds >=1 dated backfill row for every sitemap brand domain after the runbook runs", async () => {
    await db().prepare(SITEMAP_BRAND_SEED_SQL).run();
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
    await db().prepare(SITEMAP_BRAND_SEED_SQL).run();
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

  it("is idempotent: re-running the runbook never replicates the seed rows", async () => {
    await db().prepare(SITEMAP_BRAND_SEED_SQL).run();
    await db().prepare(SITEMAP_BRAND_SEED_SQL).run();
    const rows = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'sitemap_brand_seed'`,
      )
      .first<{ n: number }>();
    expect(rows?.n).toBe(SITEMAP_BRAND_DOMAINS.length);
  });

  it("filters every sitemap-brand backfill state out of the public timeline (issue #1284 proof gate)", async () => {
    await db().prepare(SITEMAP_BRAND_SEED_SQL).run();
    for (const domain of SITEMAP_BRAND_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries, `${domain} should have no public entries`).toEqual([]);
      expect(loaded.asOfState).toBeNull();
    }
  });

  it("does not collide with the 5 demo-brand rows (they are a separate runbook batch)", async () => {
    await db().prepare(SITEMAP_BRAND_SEED_SQL).run();
    const demoRows = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'demo_backfill'`,
      )
      .first<{ n: number }>();
    expect(demoRows?.n).toBe(0);

    const rows = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE capture_method = 'sitemap_brand_seed'`,
      )
      .first<{ n: number }>();
    expect(rows?.n).toBe(SITEMAP_BRAND_DOMAINS.length);
  });

  it("rolls back cleanly: deleting sitemap_brand_seed rows empties every sitemap-brand timeline", async () => {
    await db().prepare(SITEMAP_BRAND_SEED_SQL).run();
    await db()
      .prepare(`DELETE FROM landing_page_snapshot WHERE capture_method = 'sitemap_brand_seed'`)
      .run();

    for (const domain of SITEMAP_BRAND_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries).toEqual([]);
    }
  });
});
