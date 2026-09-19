import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AdRecord, SearchResponse } from "~/lib/types";

// Issue #1440 — `/search?q=<major-brand>` must label the brand's own rows
// verified (or at least likely), not blanket `Unmatched`, matching
// `/ads/:domain`. The bare keyword is resolved to the real registrable domain
// the returned rows land on; `resolveWebsiteIdentity` is mocked to return
// null so no network fetch happens in the unit test (the landing-page
// hostname match is the load-bearing signal and needs no site-identity
// aliases). The search must still never break on an identity fetch failure.
vi.mock("~/lib/website-identity.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/website-identity.server")>()),
  resolveWebsiteIdentity: vi.fn().mockResolvedValue(null),
}));

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nike",
    body: "Just do it.",
    previewHeadline: "Shop Nike",
    previewSubhead: "New arrivals",
    hook: "Shop Nike",
    offer: "Sale",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["United States"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function result(ads: AdRecord[]): SearchResponse {
  return {
    ads,
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
  };
}

describe("issue #1440 — bare major-brand keyword resolves to brand domain", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("labels a brand's own rows verified when they land on the brand domain", async () => {
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({
        metaAdId: "nike-1",
        advertiser: "Nike",
        landingPageUrl: "https://www.nike.com/shoes",
      }),
      ad({
        metaAdId: "nike-2",
        advertiser: "Nike Official",
        landingPageUrl: "https://www.nike.com/running",
      }),
      ad({
        metaAdId: "reseller-1",
        advertiser: "Sneaker Exchange",
        landingPageUrl: "https://resell.example.com/deals",
      }),
    ]);

    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "nike",
      "exact",
    );

    const verifiedOrHigher = tiered.ads.filter((row) =>
      ["verified", "likely"].includes(domainMatchTier(row.domainMatch?.level)),
    );
    // The brand's own rows (landing on nike.com) are verified, so the free
    // preview no longer disclaims its subject on every row.
    expect(verifiedOrHigher.length).toBeGreaterThan(0);
    expect(tiered.verifiedCount ?? 0).toBeGreaterThan(0);
  });

  it("verifies rows landing on a curated brand's alias hosts for a bare keyword (issue #2075)", async () => {
    // Live 2026-09-09: `q=ridge` returned 5 rows, all unmatched — Ridge's ads
    // land on ridgewallet.com/ridgewallet.eu, so neither the landing-label
    // tally ("ridgewallet" ≠ "ridge") nor the exact-advertiser-stem fallback
    // ("Ridge Wallet" folds to "ridgewallet") promoted the keyword. The
    // curated IDENTITY_OVERRIDES entry for ridge.com carries exactly those
    // alias hosts, so the keyword promotes to ridge.com and the same
    // audited-alias rail from #2012 verifies the landings. The mock identity
    // is the shape applyIdentityOverride produces when the live fetch fails —
    // curated siteName plus the curated domainAliases.
    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    vi.mocked(resolveWebsiteIdentity).mockImplementation(async (url) =>
      url.includes("ridge.com")
        ? {
            registrableDomain: "ridge.com",
            canonicalUrl: null,
            title: null,
            siteName: "Ridge",
            aliases: ["Ridge"],
            domainAliases: ["ridgewallet.com", "ridgewallet.eu"],
            resolvedAt: new Date().toISOString(),
          }
        : null,
    );
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({
        metaAdId: "ridge-eu",
        advertiser: "Ridge Wallet",
        landingPageUrl: "https://ridgewallet.eu/products",
      }),
      ad({
        metaAdId: "ridge-com",
        advertiser: "Ridge",
        landingPageUrl: "https://www.ridgewallet.com/wallets",
      }),
      ad({
        metaAdId: "unrelated",
        advertiser: "Mouth Tape Co",
        landingPageUrl: "https://sleep.example.com/tape",
      }),
    ]);

    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "ridge",
      "exact",
    );

    const byId = new Map(tiered.ads.map((row) => [row.metaAdId, row]));
    expect(domainMatchTier(byId.get("ridge-eu")?.domainMatch?.level)).toBe("verified");
    expect(domainMatchTier(byId.get("ridge-com")?.domainMatch?.level)).toBe("verified");
    expect(domainMatchTier(byId.get("unrelated")?.domainMatch?.level)).toBe("unmatched");
    expect(tiered.verifiedCount ?? 0).toBeGreaterThan(0);
  });

  it("keeps a curated brand keyword unmatched when no row lands on the curated host set", async () => {
    // The promotion is evidence-gated: "ridge" naming a curated brand is not
    // enough on its own — a returned row must land on ridge.com or a curated
    // alias. Rows on unrelated hosts stay on the unmatched fallback exactly
    // like a non-brand keyword, so the curated rail never fabricates a brand
    // domain for a keyword the result set does not support.
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({
        metaAdId: "trail-1",
        advertiser: "Trail Ridge Outfitters",
        landingPageUrl: "https://trail.example.com/gear",
      }),
    ]);

    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "ridge",
      "exact",
    );

    for (const row of tiered.ads) {
      expect(domainMatchTier(row.domainMatch?.level)).toBe("unmatched");
    }
    expect(tiered.verifiedCount ?? 0).toBe(0);
  });

  it("leaves a bare keyword unmatched when no row lands on a matching domain", async () => {
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({
        metaAdId: "goat-1",
        advertiser: "GOAT Mouth Tape",
        landingPageUrl: "https://sleep.example.com/tape",
      }),
      ad({ metaAdId: "goat-2", advertiser: "Sneaker reseller" }),
    ]);

    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "goat",
      "exact",
    );

    for (const row of tiered.ads) {
      expect(domainMatchTier(row.domainMatch?.level)).toBe("unmatched");
    }
    expect(tiered.unmatchedCount).toBe(2);
    expect(tiered.verifiedCount ?? 0).toBe(0);
  });
});
