import { afterEach, describe, expect, it, vi } from "vitest";

import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import {
  buildKeywordProbeCacheKey,
  buildOwnDomainCacheKey,
  extractLandingPageProbeKeywords,
  extractProbeKeywords,
  seedAutoCompetitors,
} from "~/lib/auto-competitor-seed.server";
import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Phase 5 of the auto-competitor-watch epic (Nishfleet/0509#1366, issue
 * #1373). When the customer's own domain has NO cached Meta ads, the seed
 * function falls back to crawling that domain's landing page (via the
 * existing landing-page-signals extractor), extracts value-prop keywords
 * (CTA / offer), and runs keyword-expanded probes to surface candidate
 * competitors.
 *
 * The deterministic contract pinned here (issue acceptance):
 *  - a no-ads domain whose landing page has known CTA/offer text returns
 *    candidates sourced from those extracted keywords, each with provenance
 *    naming "landing_page" as the seed source;
 *  - a no-ads domain whose landing page yields no usable keywords returns
 *    ZERO candidates (honesty eval 3.4 — no fabrication);
 *  - a domain that DOES have ads does NOT use the landing-page fallback (the
 *    ads path takes precedence; provenance names the ad-sourced keywords).
 *
 * These are integration tests on real workerd + D1. The crawl is exercised
 * end-to-end through the SSRF-hardened public-URL helpers (DNS resolution via
 * cloudflare-dns.com + the page fetch), so `globalThis.fetch` is mocked here
 * to return a public DNS answer and the fixture HTML — no real network is
 * contacted.
 */

const PROVIDER = resolveCommercialDiscoveryProvider(appEnv);
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** A landing page with a real CTA ("Book a demo") and a price/offer signal. */
const CTA_FIXTURE_HTML = `<html><head>
  <title>Allbirds — Wool runners</title>
</head><body>
  <main>
    <h1>Superfine wool shoes</h1>
    <p>Starting at $19.99 per pair. Free shipping.</p>
  </main>
  <button>Book a demo</button>
</body></html>`;

/** A blank landing page with no CTA candidates and no price — no usable keywords. */
const BLANK_FIXTURE_HTML = `<html><head><title></title></head><body>
  <script>window.__spa_boot__ = true;</script>
</body></html>`;

interface FixtureAd {
  metaAdId: string;
  advertiser: string;
  advertiserPageId?: string | null;
  body: string;
  previewHeadline: string;
  cta: string;
  landingPageUrl: string | null;
  countries: string[];
}

function fixtureAd(ad: FixtureAd) {
  return {
    metaAdId: ad.metaAdId,
    advertiser: ad.advertiser,
    advertiserPageId: ad.advertiserPageId ?? null,
    body: ad.body,
    previewHeadline: ad.previewHeadline,
    previewSubhead: "",
    hook: ad.previewHeadline,
    offer: "",
    cta: ad.cta,
    format: "image" as const,
    languageLabel: "English",
    destinationType: "website" as const,
    landingPageUrl: ad.landingPageUrl,
    adSnapshotUrl: null,
    countries: ad.countries,
    platforms: ["Instagram"],
    firstSeenAt: ISO_T0,
    lastSeenAt: ISO_T0,
    active: true,
    researchSummary: "",
    source: "meta_library_browser" as const,
    analysisFields: [],
  };
}

async function seedCacheEntry(cacheKey: string, ads: ReturnType<typeof fixtureAd>[]) {
  await upsertDiscoveryCacheEntry(appEnv, {
    cacheKey,
    provider: PROVIDER,
    routeContext: "public_search",
    queryFingerprint: `fp-${cacheKey}`,
    country: "all",
    cursor: null,
    payload: {
      ads,
      nextCursor: null,
      source: "meta_library_browser",
      provider: PROVIDER,
      cacheStatus: "hit",
    },
    fetchedAt: ISO_T0,
    expiresAt: FAR_FUTURE,
    browserMsUsed: 0,
  });
}

/**
 * Mock the global fetch used by the SSRF-hardened crawl: the DNS lookup to
 * cloudflare-dns.com returns a public address, and the domain's landing page
 * URL returns `pageHtml`. Any other URL is a 404.
 */
function mockPublicCrawl(domainUrl: string, pageHtml: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = type === "A" ? ["93.184.216.34"] : [];
      return new Response(
        JSON.stringify({
          Answer: addresses.map((address) => ({ data: address, type: type === "A" ? 1 : 28 })),
        }),
        { status: 200, headers: { "content-type": "application/dns-json" } },
      );
    }
    if (url === domainUrl) {
      return new Response(pageHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as ReturnType<typeof vi.spyOn>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seedAutoCompetitors — landing-page fallback (auto-competitor-watch #1373)", () => {
  it("seeds from a no-ads landing page's CTA keywords, with landing_page provenance", async () => {
    const userId = await seedUser();
    const domain = "allbirds.com";
    mockPublicCrawl(`https://${domain}/`, CTA_FIXTURE_HTML);

    // No own-domain cache entry is seeded, so the seed must take the
    // landing-page fallback. Compute the EXACT probe keywords the extractor
    // produces from the fixture, then seed a cache entry for the first one
    // that surfaces Adidas — proving the fallback read uses the SAME cache
    // key the seed builds (buildKeywordProbeCacheKey).
    const keywords = extractLandingPageProbeKeywords(CTA_FIXTURE_HTML, 8);
    expect(keywords.length).toBeGreaterThan(0);
    const probeCountry = "United States";
    const probeKey = buildKeywordProbeCacheKey({
      provider: PROVIDER,
      keyword: keywords[0],
      country: probeCountry,
    });
    await seedCacheEntry(probeKey, [
      fixtureAd({
        metaAdId: "ad-landing-adidas-1",
        advertiser: "Adidas",
        advertiserPageId: "2000001",
        body: "Trail-ready footwear.",
        previewHeadline: "Wool runners",
        cta: "Shop",
        landingPageUrl: "https://adidas.com",
        countries: [probeCountry],
      }),
    ]);

    const candidates = await seedAutoCompetitors(appEnv, {
      domain,
      country: probeCountry,
      userId,
    });

    // No fabrication: the candidate is the real cached advertiser surfaced by
    // the landing-page-derived keyword.
    expect(candidates.length).toBeGreaterThan(0);
    const advertisers = candidates.map((c) => c.advertiser);
    expect(advertisers).toContain("Adidas");

    for (const candidate of candidates) {
      expect(typeof candidate.overlapScore).toBe("number");
      expect(candidate.overlapScore).toBeGreaterThan(0);
      // The provenance must name "landing_page" as the seed source.
      expect(candidate.provenance).toContain("landing_page");
      // And still state the Meta Ad Library keyword-search ceiling.
      expect(candidate.provenance).toMatch(/active ads on the searched terms/);
    }

    // Adidas was surfaced by the landing-page-derived keyword in the probe
    // country.
    const adidas = candidates.find((c) => c.advertiser === "Adidas")!;
    expect(adidas.matchedKeywords).toContain(keywords[0]);
    expect(adidas.countries).toContain(probeCountry);
    expect(adidas.registrableDomain).toBe("adidas.com");
  });

  it("returns zero candidates when the no-ads landing page yields no usable keywords (no fabrication)", async () => {
    const userId = await seedUser();
    const domain = "blankbrand.com";
    mockPublicCrawl(`https://${domain}/`, BLANK_FIXTURE_HTML);

    // Blank fixture: no CTA candidates and no price, so the extractor yields
    // no value-prop keywords. The fallback must honestly return zero
    // candidates rather than guess.
    const keywords = extractLandingPageProbeKeywords(BLANK_FIXTURE_HTML, 8);
    expect(keywords).toEqual([]);

    const candidates = await seedAutoCompetitors(appEnv, {
      domain,
      country: "United States",
      userId,
    });
    expect(candidates).toEqual([]);
  });

  it("does NOT use the landing-page fallback when the domain has ads (ads path takes precedence)", async () => {
    const userId = await seedUser();
    const domain = "allbirds.com";

    // 1. Seed the customer's OWN domain ads. The derived hook ("wool
    //    runners") becomes an ads-path probe keyword that surfaces Adidas.
    const ownAds = [
      fixtureAd({
        metaAdId: "ad-allbirds-own-lp",
        advertiser: "Allbirds",
        advertiserPageId: "1000001",
        body: "Wool runners. Free shipping on every pair.",
        previewHeadline: "Wool runners",
        cta: "Shop now",
        landingPageUrl: "https://allbirds.com",
        countries: ["United States"],
      }),
    ];
    const ownKey = buildOwnDomainCacheKey({
      provider: PROVIDER,
      domain,
      country: "United States",
    })!;
    await seedCacheEntry(ownKey, ownAds);
    const adsKeywords = extractProbeKeywords(ownAds, 8);
    expect(adsKeywords.length).toBeGreaterThan(0);
    const probeCountry = "United States";
    await seedCacheEntry(
      buildKeywordProbeCacheKey({
        provider: PROVIDER,
        keyword: adsKeywords[0],
        country: probeCountry,
      }),
      [
        fixtureAd({
          metaAdId: "ad-adidas-lp-prec",
          advertiser: "Adidas",
          advertiserPageId: "2000002",
          body: "Wool runners for trail season.",
          previewHeadline: "Wool runners",
          cta: "Shop",
          landingPageUrl: "https://adidas.com",
          countries: [probeCountry],
        }),
      ],
    );

    // 2. The landing-page fixture WOULD yield a different keyword
    //    ("book a demo"). Seed that probe to a decoy advertiser (Zara). If
    //    the fallback ran, Zara would surface — proving precedence requires
    //    Zara to stay absent.
    const landingKeywords = extractLandingPageProbeKeywords(CTA_FIXTURE_HTML, 8);
    expect(landingKeywords.length).toBeGreaterThan(0);
    await seedCacheEntry(
      buildKeywordProbeCacheKey({
        provider: PROVIDER,
        keyword: landingKeywords[0],
        country: probeCountry,
      }),
      [
        fixtureAd({
          metaAdId: "ad-zara-lp-decoy",
          advertiser: "Zara",
          advertiserPageId: "2000003",
          body: "Fast fashion.",
          previewHeadline: "Wool runners",
          cta: "Shop",
          landingPageUrl: "https://zara.com",
          countries: [probeCountry],
        }),
      ],
    );

    // No fetch mock is installed: the ads path must not crawl, so no network
    // is needed.
    const candidates = await seedAutoCompetitors(appEnv, {
      domain,
      country: probeCountry,
      userId,
    });

    const advertisers = candidates.map((c) => c.advertiser);
    // The ads probe surfaced Adidas; the landing-page decoy (Zara) must stay
    // absent because the fallback was NOT used.
    expect(advertisers).toContain("Adidas");
    expect(advertisers).not.toContain("Zara");
    for (const candidate of candidates) {
      expect(candidate.provenance).toContain("meta_ad_library_keyword_probe");
      expect(candidate.provenance).not.toContain("landing_page");
    }
  });
});
