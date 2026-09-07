import { describe, expect, it } from "vitest";

import { SNEAKER_RESALE_BRAND_PAGES } from "~/components/sneaker-resale-landing";
import sneakerResaleSeedList from "../data/seed-lists/sneaker-resale.json";
import indexableSnapshot from "./fixtures/sneaker-resale-indexable-domains.snapshot.json";

/**
 * Issue #1762 regression guard. The /sneaker-resale SEO hub is the landing
 * page for the market's strongest signal cluster, but its brand-link array
 * (SNEAKER_RESALE_BRAND_PAGES) was last updated when only 4 /ads/:domain
 * pages existed and was never refreshed as the cluster scaled to 18+
 * sitemap-listed pages. The hub linked 4 of 18 live cluster pages, starving
 * 14 of internal link equity. Each cluster /ads/ page links back to the hub;
 * the reciprocal was missing on the hub side.
 *
 * This pins the array to the cluster's sitemap snapshot: the array must
 * cover every sneaker-resale domain whose /ads/ page is live and indexable
 * in the production sitemap today. A domain whose /ads/ page is absent from
 * the sitemap (goat.com, on.com, reebok.com, solesavy.com, sneakerping.com)
 * is intentionally excluded so the hub never ships a dead link. When the
 * cluster scales further, refresh the snapshot fixture AND the array
 * together — the length assertion below fails until both are updated.
 */

const INDEXABLE_SNAPSHOT_DOMAINS = new Set(
  (indexableSnapshot.domains as string[]).map((domain) => domain.toLowerCase()),
);
const indexableSeedDomains = new Set(
  sneakerResaleSeedList.domains
    .map((entry) => entry.domain.toLowerCase())
    .filter((domain) => INDEXABLE_SNAPSHOT_DOMAINS.has(domain)),
);

// Live + indexable sneaker-resale cluster /ads/ domains per the sitemap
// snapshot. This is the coverage floor: the hub must link EVERY one of them.
// The snapshot is sitemap-derived and can include domains (asos.com,
// decathlon.com) that predate the seed list; the seed list is the cluster
// source of truth, the snapshot is the indexable filter applied to it.
const indexableClusterDomains = [...INDEXABLE_SNAPSHOT_DOMAINS].sort();

describe("sneaker-resale hub links (issue #1762)", () => {
  it("the sitemap snapshot reference is non-empty", () => {
    expect(indexableClusterDomains.length).toBeGreaterThan(0);
  });

  it("the hub array covers every live, indexable cluster domain in the sitemap snapshot", () => {
    const arrayDomains = SNEAKER_RESALE_BRAND_PAGES.map((entry) => entry.domain.toLowerCase());
    const arraySet = new Set(arrayDomains);

    for (const domain of indexableClusterDomains) {
      expect(
        arraySet.has(domain),
        `hub array is missing live, indexable cluster domain ${domain}`,
      ).toBe(true);
    }
  });

  it("the hub array length never falls below the live, indexable cluster count", () => {
    expect(SNEAKER_RESALE_BRAND_PAGES.length).toBeGreaterThanOrEqual(indexableClusterDomains.length);
  });

  it("every hub entry is sitemap-indexable (no dead /ads/ links)", () => {
    for (const entry of SNEAKER_RESALE_BRAND_PAGES) {
      expect(
        INDEXABLE_SNAPSHOT_DOMAINS.has(entry.domain.toLowerCase()),
        `hub entry ${entry.domain} is not in the indexable sitemap snapshot`,
      ).toBe(true);
    }
  });

  it("the hub array has no duplicate domains", () => {
    const domains = SNEAKER_RESALE_BRAND_PAGES.map((entry) => entry.domain.toLowerCase());
    expect(new Set(domains).size).toBe(domains.length);
  });
});
