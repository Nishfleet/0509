import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import { CAPTURE_RULES_PUBLIC_PATH } from "~/lib/capture-validity-public-rules";
import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";
import type { AdRecord } from "~/lib/types";

// The default export reads `useLoaderData`; a mutable fixture lets each test
// render the route with a specific loader payload.
let currentData: BrandPageLoaderData;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function render(data: BrandPageLoaderData): Promise<string> {
  currentData = data;
  const { default: BrandAdsRoute } = await import("~/routes/ads.$domain");
  return renderToStaticMarkup(createElement(BrandAdsRoute));
}

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    body: "Run through summer.",
    previewHeadline: "Run through summer with gear that can take the heat.",
    previewSubhead: "",
    hook: "Shop Now",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/launch",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

const teaser = {
  totalCount: 6,
  activeCount: 6,
  longestRunningDays: 126,
  longestRunningHook: "Charge shin guards",
  formats: ["image", "video", "carousel"],
};

const aggression = {
  score: 78,
  components: { velocity: 22, testing: 19, freshness: 20, persistence: 17 },
  bandId: "all_out" as const,
  bandLabel: "All-out",
  bandInterpretation: "Running an all-out launch and testing push.",
  formulaVersion: 1 as const,
  windowDays: 21,
  adsPerWeek: 6,
  adCount: 6,
  activeCount: 6,
};

const changeEvents = [
  {
    id: "evt-1",
    dayLabel: "Today",
    isToday: true,
    source: "AD LIBRARY",
    move: "New ad entered rotation — a fresh summer creative",
    why: "Launched with 4 variants — they're testing which creative wins.",
    variantCount: 4,
  },
];

function populated(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` })),
    // Every fixture creative links to nike.com (landing page), so the whole
    // capture carries verified link evidence by default — mirror the loader's
    // verifiedLinkedAds output for the same fixture set.
    verifiedLinkedAds: Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` })),
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-08-09T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    // Every fixture creative links to nike.com (landing page), so the whole
    // capture carries verified link evidence by default.
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser,
    aggression,
    observationDays: null,
    changeEvents,
    offerTimelineEntries: [],
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    ...overrides,
  };
}

describe("/ads/:domain — Case File render", () => {
  it("renders every section of the populated page in the briefed order", async () => {
    const markup = await render(populated());

    // Sections present.
    expect(markup).toContain("ld-ticker"); // capture ticker
    expect(markup).toContain("Nike was running");
    expect(markup).toContain("6 Meta ads");
    expect(markup).toContain("Ad Aggression Score");
    expect(markup).toContain(`href="${AD_AGGRESSION_METHODOLOGY_PATH}"`);
    expect(markup).toContain("f9-ads-watch-strip");
    expect(markup).toContain("f9-ads-statline");
    expect(markup).toContain("What changed this week");
    expect(markup).toContain("All 6 ads, on the wall");
    expect(markup).toContain("Be the first to know");

    // Order: ticker → hero headline → score → CTA strip → stat line →
    // what-changed → ad wall → closer.
    const order = [
      "ld-ticker",
      "Nike was running",
      "Ad Aggression Score · last",
      "f9-ads-watch-strip",
      "f9-ads-statline",
      "What changed this week",
      "All 6 ads, on the wall",
      "Be the first to know",
    ].map((needle) => markup.indexOf(needle));
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it("links the methodology page from every /ads/:domain state, including the five live demo brands", async () => {
    const methodologyHref = `href="${AD_AGGRESSION_METHODOLOGY_PATH}"`;
    const demoDomains = ["nike.com", "nykaa.com", "allbirds.com", "lenskart.com", "mamaearth.com"] as const;

    const scored = await render(populated());
    const thin = await render(populated({ aggression: null }));
    const shell = await render(
      populated({
        hasCachedAds: false,
        ads: [],
        checkedAgo: null,
        teaser: null,
        aggression: null,
        changeEvents: [],
        noindex: true,
      }),
    );
    expect(scored).toContain(methodologyHref);
    expect(thin).toContain(methodologyHref);
    expect(shell).toContain(methodologyHref);

    for (const domain of demoDomains) {
      const markup = await render(populated({ domain, canonicalPath: `/ads/${domain}` }));
      expect(markup).toContain(methodologyHref);
      expect(markup).toContain(`"url":"https://0509.io/ads/${domain}"`);
    }
  });

  it("names the country of the Ad Library the cached creatives came from", async () => {
    const markup = await render(populated());

    // The wall source line names the India Ad Library, never a bare
    // "the Meta Ad Library" that hides the country-scoped source.
    expect(markup).toContain(
      "real creatives from the India Ad Library · cached about 2 hours ago",
    );
    // The closer honesty line names it too.
    expect(markup).toContain(
      "Ad creatives are Nike&#x27;s real ads from the public India Ad Library, cached about 2 hours ago.",
    );
    // And the meta description / JSON-LD description.
    expect(markup).toContain(
      '"description":"See 6 Meta ads from Nike (nike.com), from a public check of the India Ad Library about 2 hours ago. Get an email when their ads or offer change."',
    );
  });

  it("names the all-countries view in plain buyer language, not worldwide coverage", async () => {
    const markup = await render(populated({ adLibraryCountry: "all countries" }));

    // The wall source line names the source in plain buyer language — the
    // API-jargon "all-countries query" never renders (issue #1464), and the
    // copy must not claim worldwide coverage ("across all countries").
    expect(markup).toContain(
      "real creatives from Meta&#x27;s global ad library · cached about 2 hours ago",
    );
    expect(markup).toContain(
      '"description":"See 6 Meta ads from Nike (nike.com), from a public check of Meta\'s global ad library about 2 hours ago. Get an email when their ads or offer change."',
    );
    expect(markup).not.toContain("all-countries query");
    // The false worldwide claim never renders on any surface.
    expect(markup).not.toContain("across all countries");
    // No single country is implied anywhere in the source lines.
    expect(markup).not.toContain("the India Ad Library");
    expect(markup).not.toContain("the public India Ad Library");
  });

  it("regression: adLibrarySourcePhrase stays buyer language and never revives the worldwide claim", async () => {
    const { adLibrarySourcePhrase, publicAdLibrarySourcePhrase } = await import(
      "~/routes/ads.$domain"
    );

    // The all-countries value is a single `country=ALL` query, not a union
    // of every market — the phrase names the global library in plain buyer
    // language (issue #1464) and must never bring back the "all-countries
    // query" jargon or the "across all countries" worldwide claim.
    expect(adLibrarySourcePhrase("all countries")).toBe(
      "Meta's global ad library",
    );
    expect(adLibrarySourcePhrase("all countries")).not.toContain("all-countries query");
    expect(adLibrarySourcePhrase("all countries")).not.toContain("across all countries");
    // The null fallback (no country on the snapshot) gets the same honest
    // phrasing rather than implying worldwide coverage.
    expect(adLibrarySourcePhrase(null)).toBe("Meta's global ad library");
    expect(adLibrarySourcePhrase(null)).not.toContain("across all countries");

    // The public closer-line variant follows the same rule.
    expect(publicAdLibrarySourcePhrase("all countries")).toBe(
      "Meta's public global ad library",
    );
    expect(publicAdLibrarySourcePhrase("all countries")).not.toContain("all-countries query");
    expect(publicAdLibrarySourcePhrase("all countries")).not.toContain("across all countries");
    expect(publicAdLibrarySourcePhrase(null)).toBe(
      "Meta's public global ad library",
    );

    // Named-country copy is unchanged.
    expect(adLibrarySourcePhrase("India")).toBe("the India Ad Library");
    expect(publicAdLibrarySourcePhrase("India")).toBe("the public India Ad Library");
  });

  it("shows the honest overflow tile and the signup CTA carrying the domain", async () => {
    const markup = await render(populated());

    // 6 total − 5 shown = +1 more.
    expect(markup).toContain("+1");
    expect(markup).toContain("more ads on record");
    // Primary CTA carries the domain into the Overview setup card.
    expect(markup).toContain(
      "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnike.com%23setup-checklist",
    );
  });

  it("dates every visible wall card with its own capture date, so months-old creatives read as old", async () => {
    const markup = await render(populated());

    // Each of the 5 visible cards carries the date its creative was first
    // observed (its firstSeenAt), not just a page-level "cached N ago" stamp
    // — a Diwali/Navratri/Pay Day creative from months back is visibly dated.
    // Exactly 5: the 6th ad hides behind the overflow tile, which is a
    // conversion cell, not a card.
    expect((markup.match(/Since 1 Jun 2026/g) ?? []).length).toBe(5);
    expect(markup).toContain("+1");
  });

  it("renders no capture-date pill when the creative's first-seen proof is missing", async () => {
    const ads = [ad({ metaAdId: "ad-no-date", firstSeenAt: null })];
    const markup = await render(
      populated({ ads, brandOwnedAdCount: 1, teaser: { ...teaser, totalCount: 1 } }),
    );

    // The card still renders — but never invents a date it does not know.
    expect(markup).toContain("Run through summer with gear that can take the heat.");
    expect(markup).not.toContain("Since ");
  });

  it("hides the score card and states why when the evidence floor is not met", async () => {
    const markup = await render(populated({ aggression: null }));

    expect(markup).toContain("Not enough history yet to score");
    expect(markup).toContain(`href="${AD_AGGRESSION_METHODOLOGY_PATH}"`);
    // No score band leaks through.
    expect(markup).not.toContain("f9-ads-score-num");
    // Stat line still renders from the teaser, minus the score-derived cell.
    expect(markup).toContain("f9-ads-statline");
    expect(markup).toContain("Ads on record");
    expect(markup).not.toContain("New this week");
  });

  it("hides 'What changed this week' entirely when there are no change events", async () => {
    const markup = await render(populated({ changeEvents: [] }));

    expect(markup).not.toContain("What changed this week");
    // The rest of the page still renders.
    expect(markup).toContain("All 6 ads, on the wall");
  });

  it("labels a partner campaign with a 'via partner' pill so the buyer sees the disambiguation (issue #1566)", async () => {
    // ad-0 is a verified-linked creative that is NOT the brand's own (a
    // partner/creator campaign under a different Meta Page ID). The loader
    // exposes it in partnerCampaignAdIds and the wall must label it.
    const markup = await render(
      populated({
        ads: Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` })),
        verifiedLinkedAds: Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` })),
        brandOwnedAdCount: 5,
        partnerCampaignAdIds: ["ad-0"],
      }),
    );

    expect(markup).toContain("via partner");
  });

  it("renders no 'via partner' pill when every verified-linked ad is the brand's own", async () => {
    const markup = await render(populated({ partnerCampaignAdIds: [] }));
    expect(markup).not.toContain("via partner");
  });

  it("hides Offer timeline entirely when there are no stored offer states", async () => {
    const markup = await render(populated({ offerTimelineEntries: [] }));

    expect(markup).not.toContain("brand-offer-timeline-title");
    expect(markup).not.toContain("Full offer timeline");
  });

  it("renders a non-empty Offer Timeline without the no-screenshot string (issue #1284)", async () => {
    const markup = await render(
      populated({
        offerTimelineEntries: [
          {
            id: "backfill-nike-20260825",
            capturedAt: "2026-08-25T00:00:00.000Z",
            dateLabel: "25 Aug 2026",
            canonicalUrl: "https://www.nike.com/",
            headline: "Nike. Just Do It.",
            ctaText: null,
            priceText: null,
            formPresent: null,
            screenshotHref: null,
            pageTextHref: null,
            evidenceNote: "Captured on 25 Aug 2026, no screenshot",
            transition: null,
          },
        ],
      }),
    );

    expect(markup).toContain("brand-offer-timeline-title");
    expect(markup).toContain("Offer timeline");
    expect(markup).toContain("Nike. Just Do It.");
    // The "no screenshot" string must never appear on a public surface.
    expect(markup).not.toContain("no screenshot");
    expect(markup).toContain("/timeline/nike.com");
    expect(markup).not.toContain("Screenshot ·");
    expect(markup).not.toContain("Page text ·");
  });

  it("renders the /timeline cross-link for a non-demo brand with a stored timeline (not gated to demo brands)", async () => {
    // Regression for #1296: the /ads -> /timeline cross-link must render for
    // ANY domain with a stored timeline, not just the original demo brands
    // (nike, allbirds, mamaearth, nykaa, lenskart). gymshark.com is a
    // sitemap-scale-out brand that was observed missing the link.
    const markup = await render(
      populated({
        domain: "gymshark.com",
        brandName: "Gymshark",
        canonicalPath: "/ads/gymshark.com",
        offerTimelineEntries: [
          {
            id: "snap-gymshark-20260827",
            capturedAt: "2026-08-27T00:00:00.000Z",
            dateLabel: "27 Aug 2026",
            canonicalUrl: "https://www.gymshark.com/",
            headline: "Train hard. Rest harder.",
            ctaText: "Shop Now",
            priceText: null,
            formPresent: false,
            screenshotHref: null,
            pageTextHref: null,
            evidenceNote: null,
            transition: null,
          },
        ],
      }),
    );

    expect(markup).toContain('href="/timeline/gymshark.com"');
    expect(markup).toContain("Full offer timeline for gymshark.com");
  });

  it("renders no /timeline cross-link when the brand has no stored timeline (no broken link)", async () => {
    // Regression for #1296: a domain with no timeline must not emit a link to
    // /timeline/:domain — that would point at a 410 Gone page (see
    // timeline.$domain.tsx). The whole section hides instead.
    const markup = await render(
      populated({
        domain: "gymshark.com",
        brandName: "Gymshark",
        canonicalPath: "/ads/gymshark.com",
        offerTimelineEntries: [],
      }),
    );

    expect(markup).not.toContain('href="/timeline/');
    expect(markup).not.toContain("Full offer timeline");
    expect(markup).not.toContain("brand-offer-timeline-title");
  });

  it("renders the teaching shell (not a dotted apology) on a cache miss", async () => {
    const markup = await render(
      populated({
        hasCachedAds: false,
        ads: [],
        checkedAgo: null,
        teaser: null,
        aggression: null,
        changeEvents: [],
        noindex: true,
      }),
    );

    expect(markup).toContain("We haven&#x27;t watched nike.com yet");
    expect(markup).toContain(`href="${AD_AGGRESSION_METHODOLOGY_PATH}"`);
    expect(markup).toContain("here&#x27;s what you&#x27;d wake up to");
    expect(markup).toContain("Run a free live search");
    expect(markup).toContain("Example");
    // Never the old apologetic empty state, and no ticker without cached ads.
    expect(markup).not.toContain("haven&#x27;t checked");
    expect(markup).not.toContain("ld-ticker");
    // The signup CTA still carries the domain.
    expect(markup).toContain("website%3Dnike.com");
  });

  it("still shows the real Offer Timeline on the cache-miss shell", async () => {
    const markup = await render(
      populated({
        hasCachedAds: false,
        ads: [],
        checkedAgo: null,
        teaser: null,
        aggression: null,
        changeEvents: [],
        noindex: true,
        offerTimelineEntries: [
          {
            id: "backfill-nike-20260825",
            capturedAt: "2026-08-25T00:00:00.000Z",
            dateLabel: "25 Aug 2026",
            canonicalUrl: "https://www.nike.com/",
            headline: "Nike. Just Do It.",
            ctaText: null,
            priceText: null,
            formPresent: null,
            screenshotHref: null,
            pageTextHref: null,
            evidenceNote: "Captured on 25 Aug 2026, no screenshot",
            transition: null,
          },
        ],
      }),
    );

    expect(markup).toContain("Offer timeline");
    expect(markup).toContain("Nike. Just Do It.");
    expect(markup).not.toContain("no screenshot");
    expect(markup).toContain("/timeline/nike.com");
  });

  it("claims right now/live only while the capture is fresh, and flips to past-tense honesty when it is hours old", async () => {
    const fresh = await render(
      populated({ checkedAgo: "moments ago", freshForLiveClaim: true }),
    );
    const stale = await render(populated());

    // Fresh capture: the present-tense acquisition claims are kept.
    expect(fresh).toContain("Nike is running ");
    expect(fresh).toContain("right now.");
    expect(fresh).toContain("Running right now");
    expect(fresh).toContain("Nike · live");
    expect(fresh).toContain("Ads live");
    expect(fresh).toContain("more ads live");

    // Hours-old capture: every claim flips to an honest past tense, and the
    // freshness stamp stays the page's only time claim.
    expect(stale).toContain("Nike was running ");
    expect(stale).toContain("at the last check.");
    expect(stale).toContain("From the last check");
    expect(stale).toContain("Nike · on record");
    expect(stale).toContain("Ads on record");
    expect(stale).toContain("more ads on record");
    expect(stale).not.toContain("Nike is running ");
    expect(stale).not.toContain("Running right now");
    expect(stale).not.toContain("Nike · live");
    expect(stale).not.toContain("Ads live");
    expect(stale).not.toContain("more ads live");
  });

  it("keeps the stat-strip context public (no signed-in 'marked active' language)", async () => {
    const fresh = await render(
      populated({ checkedAgo: "moments ago", freshForLiveClaim: true }),
    );
    const stale = await render(populated());

    // "Active" is the ad's observed Ad Library status, stated publicly —
    // never "marked active", which implies a signed-in viewer action.
    expect(fresh).not.toContain("marked active");
    expect(stale).not.toContain("marked active");

    // Fresh capture reads present tense; stale capture reads "at the last
    // check", mirroring the hero line and the caption flip above.
    expect(fresh).toContain(">6 active<");
    expect(stale).toContain("6 active at last check");
    expect(stale).not.toContain(">6 active<");
  });

  it("stops telling visitors the brand is running ads when the creatives are other advertisers'", async () => {
    const stale = await render(populated({ brandOwnedAdCount: 0 }));
    const fresh = await render(
      populated({ brandOwnedAdCount: 0, checkedAgo: "moments ago", freshForLiveClaim: true }),
    );

    // No brand-owned claim anywhere. The score card renders (the capture has
    // verified link evidence), so the headline speaks the verified "linking
    // to" phrasing, never the hedged "pointing at" (issue #1447).
    expect(stale).toContain("The last check found ");
    expect(stale).toContain("6 Meta ads");
    expect(stale).toContain("linking to nike.com");
    expect(stale).not.toContain("pointing at nike.com");
    expect(stale).toContain("nike.com · on record");
    expect(stale).not.toContain("Nike was running ");
    expect(stale).not.toContain("Nike is running ");
    expect(stale).not.toContain("Nike · live");

    // Fresh capture: same attribution, honest present tense for the capture.
    expect(fresh).toContain("6 Meta ads");
    expect(fresh).toContain("are linking to nike.com right now.");
    expect(fresh).not.toContain("are pointing at nike.com");
    expect(fresh).toContain("Other advertisers are testing");
    expect(fresh).toContain("nike.com · live");

    // Closer never calls the creatives Nike's own ads.
    expect(stale).toContain(
      "Ad creatives are real ads from the public India Ad Library, run by other advertisers linking to nike.com",
    );
    expect(stale).toContain("The advertisers linking to nike.com will change their next ad.");
    expect(stale).not.toContain("Nike's real ads");
  });

  it("regression: the description hedge and the Aggression Score card are mutually exclusive (issue #1447)", async () => {
    // The two states of the /ads/:domain page must never co-occur: a page
    // that renders the score card (verified link evidence exists) must not
    // say "could not verify" in its description, and a page whose description
    // hedges must not render the score card. This is the gate that would have
    // caught the merged hedge PR (hedge added to the verified none-brand-owned
    // state while the score card kept rendering on it).
    const scored = await render(populated({ brandOwnedAdCount: 0 }));
    const strip = await render(
      populated({
        brandOwnedAdCount: 0,
        verifiedLinkCount: 6,
        aggression: null,
        changeEvents: [],
      }),
    );

    // State 1 — score card renders: no hedge anywhere (description JSON-LD
    // ships from the same brandPageDescription as the meta description).
    expect(scored).toContain("f9-ads-score-num");
    expect(scored).not.toContain("could not verify from the cached capture");
    // H1 pairing: verified "linking to" H1, never the hedged "pointing at".
    const scoredH1 = scored.match(/<h1[^>]*id="brand-ads-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    expect(scoredH1).toContain("linking to nike.com");
    expect(scoredH1).not.toContain("pointing at nike.com");

    // State 2 — no score card (the cache-miss strip): hedge present, no score.
    expect(strip).not.toContain("f9-ads-score-num");
    expect(strip).toContain("could not verify from the cached capture");
    const stripH1 = strip.match(/<h1[^>]*id="brand-ads-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    expect(stripH1).toContain("pointing at nike.com");
    expect(stripH1).not.toContain("linking to nike.com");
  });

  it("names the split when the cache mixes the brand's own ads with other advertisers'", async () => {
    const stale = await render(populated({ brandOwnedAdCount: 2 }));
    const fresh = await render(
      populated({ brandOwnedAdCount: 2, checkedAgo: "moments ago", freshForLiveClaim: true }),
    );

    expect(stale).toContain("Nike was running ");
    expect(stale).toContain("2 of these 6 Meta ads");
    expect(stale).toContain("at the last check.");
    expect(fresh).toContain("Nike is running ");
    expect(fresh).toContain("2 of these 6 Meta ads");
    expect(fresh).toContain("right now.");

    // The closer states exactly who runs what.
    expect(stale).toContain(
      "2 run by Nike and 4 by other advertisers",
    );
    expect(stale).toContain(
      "Nike and the other advertisers linking to nike.com will change their next ad.",
    );
    // Mixed copy never over-claims a full brand-owned wall or the reverse.
    expect(stale).not.toContain("Nike's real ads");
    expect(stale).not.toContain("6 Meta ads are pointing at");
  });

  it("uses the full brand-owned headline when every verified-linked ad is the brand's (unverified extras on the wall)", async () => {
    // Mirrors live nike.com: 15 verified brand-owned creatives + 1 unverified
    // wall match. The H1 must not use split "X of these Y" copy — every
    // verified-linked ad is Nike's; the extra match belongs in the subline.
    const ads = Array.from({ length: 16 }, (_v, i) => ad({ metaAdId: `ad-${i}` }));
    const verifiedLinkedAds = ads.slice(0, 15);
    const markup = await render(
      populated({
        ads,
        verifiedLinkedAds,
        brandOwnedAdCount: 15,
        verifiedLinkCount: 15,
        unverifiedMatchCount: 1,
        teaser: { ...teaser, totalCount: 15, activeCount: 15 },
      }),
    );

    const h1 = markup.match(/<h1[^>]*id="brand-ads-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    expect(h1).toContain("Nike was running ");
    expect(h1).toContain("15 Meta ads");
    expect(h1).toContain("at the last check.");
    expect(h1).not.toContain("of these");
    expect(markup).toContain(
      "Another 1 ad matched the search without a verified link to nike.com.",
    );
  });

  it("mixes verified and search-only cards with a per-card signal, split header, and verified-first order", async () => {
    // Mirrors live notion.so: a wall where only some creatives carry verified
    // link evidence. The loader annotates the wall copies with
    // linkVerifiedDomain; BrandAdCard must badge exactly those, the header
    // must report BOTH counts, and the verified cards must render first.
    const ads = [
      ad({ metaAdId: "ad-v1", advertiser: "Notion", linkVerifiedDomain: "nike.com" }),
      ad({ metaAdId: "ad-v2", advertiser: "T-Pain with Notion", linkVerifiedDomain: "nike.com" }),
      ad({ metaAdId: "ad-s1", advertiser: "Notion Press Publishing", landingPageUrl: null }),
      ad({ metaAdId: "ad-s2", advertiser: "Notion Fan Club", landingPageUrl: null }),
      ad({ metaAdId: "ad-s3", advertiser: "Notion Templates", landingPageUrl: null }),
    ];
    const markup = await render(
      populated({
        ads,
        verifiedLinkedAds: ads.slice(0, 2),
        brandOwnedAdCount: 2,
        verifiedLinkCount: 2,
        unverifiedMatchCount: 3,
      }),
    );

    // (a) The header reports both verified and search-only counts.
    expect(markup).toContain(
      "All 5 ads — 2 verified, 3 matched the search",
    );

    // (b) The badge appears only on the two verified cards (never on the
    // search-only ones), rendered FIRST so the verified set leads the wall.
    const badgeCount = (markup.match(/f9-ads-verified-badge/g) ?? []).length;
    expect(badgeCount).toBe(2);
    const firstBadge = markup.indexOf("f9-ads-verified-badge");
    const firstSearchOnly = markup.indexOf("Notion Press Publishing");
    expect(firstBadge).toBeGreaterThan(-1);
    expect(firstSearchOnly).toBeGreaterThan(-1);
    expect(firstBadge).toBeLessThan(firstSearchOnly);
    // The search-only cards must NOT carry the verified badge anywhere in
    // their card markup (each keeps only the "Notion Press Publishing"
    // advertiser label unbadged).
    const searchOnlyCardStart = markup.indexOf("Notion Press Publishing");
    const nextBadgeAfterSearchOnly = markup.indexOf(
      "f9-ads-verified-badge",
      searchOnlyCardStart,
    );
    // Only the two verified cards are badged at all, so nothing after the
    // first search-only card is badged (badge count above is already 2).
    expect(nextBadgeAfterSearchOnly).toBe(-1);
  });

  it("never claims ads POINT AT the domain when no creative has verified link evidence", async () => {
    const stale = await render(
      populated({
        brandOwnedAdCount: 0,
        verifiedLinkCount: 0,
        unverifiedMatchCount: 6,
        teaser: { ...teaser, totalCount: 0, activeCount: 0 },
        aggression: null,
        changeEvents: [],
      }),
    );
    const fresh = await render(
      populated({
        brandOwnedAdCount: 0,
        verifiedLinkCount: 0,
        unverifiedMatchCount: 6,
        checkedAgo: "about 5 minutes ago",
        freshForLiveClaim: true,
        teaser: { ...teaser, totalCount: 0, activeCount: 0 },
        aggression: null,
        changeEvents: [],
      }),
    );

    // The headline says "matching", never "pointing at"/"linking to".
    expect(stale).toContain("The last check found ");
    expect(stale).toContain("6 Meta ads");
    expect(stale).toContain("matching nike.com");
    expect(stale).not.toContain("pointing at nike.com");
    expect(stale).not.toContain("linking to nike.com");
    expect(fresh).toContain("are matching nike.com right now.");
    // The subline says the connection is not verified.
    expect(stale).toContain("Their link to the site is not verified");
    // The closer stays honest about the unverified link.
    expect(stale).toContain("Ad creatives are real Meta Ad Library ads that matched the search for nike.com");
    expect(stale).toContain("The advertisers running ads matching nike.com will change their next ad.");
    // No score is built from text-mention matches.
    expect(stale).not.toContain("f9-ads-score-num");
  });

  it("counts only verified-linked creatives in linking language when the capture mixes matches", async () => {
    // One verified creative leads the wall (annotated by the loader as
    // linkVerifiedDomain); five search-only matches follow.
    const ads = Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` }));
    ads[0] = { ...ads[0], linkVerifiedDomain: "nike.com" };
    const stale = await render(
      populated({
        ads,
        verifiedLinkedAds: [ads[0]],
        brandOwnedAdCount: 1,
        verifiedLinkCount: 1,
        unverifiedMatchCount: 5,
        teaser: { ...teaser, totalCount: 1, activeCount: 1 },
        aggression: null,
      }),
    );

    // The headline speaks about the verified capture; the subline names the
    // unverified matches instead of folding them into the link count.
    expect(stale).toContain("Nike was running ");
    expect(stale).toContain("1 Meta ad");
    expect(stale).toContain("at the last check.");
    expect(stale).not.toContain("of these");
    expect(stale).toContain(
      "Another 5 ads matched the search without a verified link to nike.com.",
    );
    // The wall still carries every cached creative; the mixed header reports
    // BOTH counts and the single verified card leads it badged.
    expect(stale).toContain("All 6 ads — 1 verified, 5 matched the search");
    expect((stale.match(/f9-ads-verified-badge/g) ?? []).length).toBe(1);
    expect(stale.indexOf("f9-ads-verified-badge")).toBeGreaterThan(-1);
    expect(stale.indexOf("f9-ads-verified-badge")).toBeLessThan(stale.indexOf("Nike · nike.com"));
  });

  it("omits 'by other advertisers' in the closer when every verified linking creative is the brand's own (unverified matches only)", async () => {
    // Mirrors the live hubspot.com defect in the visible closer copy: 4
    // verified brand-owned ads + 6 unverified text-matches. The closer split
    // must not fold the 6 unverified matches into "by other advertisers".
    const ads = Array.from({ length: 10 }, (_v, i) => ad({ metaAdId: `ad-${i}` }));
    const stale = await render(
      populated({
        ads,
        brandOwnedAdCount: 4,
        verifiedLinkCount: 4,
        unverifiedMatchCount: 6,
        teaser: { ...teaser, totalCount: 4, activeCount: 4 },
      }),
    );

    // The closer attributes only the verified brand-owned creatives to Nike.
    expect(stale).toContain("4 run by Nike");
    // The unverified text-matches must NOT be attributed to other advertisers.
    expect(stale).not.toContain("6 by other advertisers");
    expect(stale).not.toContain("0 by other advertisers");
    // The unverified matches appear only in the labelled note.
    expect(stale).toContain(
      "Another 6 ads matched the search for nike.com without a verified link.",
    );
  });

  it("never labels a creative with the brand name when its advertiser is unconfirmed", async () => {
    const ads = Array.from({ length: 5 }, (_v, i) =>
      ad({ metaAdId: `ad-${i}`, advertiser: i === 0 ? "" : "Nike" }),
    );
    const markup = await render(
      populated({
        ads,
        brandOwnedAdCount: 4,
        verifiedLinkCount: 5,
        teaser: { ...teaser, totalCount: 5 },
      }),
    );

    // The unconfirmed creative is counted as other advertisers' — never
    // brand-owned — and its card is labeled honestly, not with the brand name.
    expect(markup).toContain("Nike was running ");
    expect(markup).toContain("4 of these 5 Meta ads");
    expect(markup).toContain("Advertiser unconfirmed · nike.com");
    expect((markup.match(/Nike · nike\.com/g) ?? []).length).toBe(4);
  });

  it("renders exactly one plain-text h1 that names the brand", async () => {
    const markup = await render(populated());
    const h1Matches = markup.match(/<h1\b[^>]*>[^<]+<\/h1>/g) ?? [];
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches[0]).toBe(
      '<h1 class="f9-ads-headline" id="brand-ads-title">Nike was running 6 Meta ads at the last check.</h1>',
    );
  });

  it("renders exactly one plain-text h1 on the cache-miss shell", async () => {
    const markup = await render(
      populated({
        hasCachedAds: false,
        ads: [],
        checkedAgo: null,
        teaser: null,
        aggression: null,
        changeEvents: [],
        noindex: true,
      }),
    );
    const h1Matches = markup.match(/<h1\b[^>]*>[^<]+<\/h1>/g) ?? [];
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches[0]).toBe(
      '<h1 class="f9-ads-headline f9-ads-shell-head" id="brand-ads-title">We haven&#x27;t watched nike.com yet — here&#x27;s what you&#x27;d wake up to.</h1>',
    );
  });
});

describe("/ads/:domain — truthful WebPage JSON-LD", () => {
  it("emits WebPage JSON-LD on an indexable page, mirroring the visible claims", async () => {
    const markup = await render(populated());

    expect(markup).toContain('type="application/ld+json"');
    expect(markup).toContain('"@type":"WebPage"');
    // name and description must match the meta title/description exactly.
    expect(markup).toContain(
      '"name":"Nike Facebook & Instagram ads | Five to Nine"',
    );
    // The name is time-stable: the freshness stamp ("checked about N…",
    // "right now") lives in the visible captions and the description, never
    // in the indexed title/JSON-LD name.
    expect(markup).not.toContain('"name":"Nike Facebook & Instagram ads — checked about');
    expect(markup).not.toContain('"name":"Nike Facebook & Instagram ads right now');
    expect(markup).toContain(
      '"description":"See 6 Meta ads from Nike (nike.com), from a public check of the India Ad Library about 2 hours ago. Get an email when their ads or offer change."',
    );
    expect(markup).toContain('"url":"https://0509.io/ads/nike.com"');
    // dateModified is the on-screen "Last checked" stamp, machine-readable.
    expect(markup).toContain('"dateModified":"2026-08-09T10:00:00.000Z"');
    // about names the brand the page is actually about; the publisher stays
    // Five to Nine — the page never claims to BE the brand.
    expect(markup).toContain('"about":{"@type":"Organization","name":"Nike"}');
    expect(markup).toContain('"publisher":{"@type":"Organization","name":"Five to Nine"');
    expect(markup).toContain('"isPartOf":{"@type":"WebSite","name":"Five to Nine"');
  });

  it("keeps the JSON-LD name time-stable even while the capture is fresh (no 'right now' in the title)", async () => {
    const markup = await render(
      populated({ checkedAgo: "moments ago", freshForLiveClaim: true }),
    );

    // The live-scrape "right now" claim stays in the visible page captions and
    // the meta description (which carry their own honesty gate); the indexed
    // name must not churn with the capture clock.
    expect(markup).toContain(
      '"name":"Nike Facebook & Instagram ads | Five to Nine"',
    );
    expect(markup).not.toContain('"name":"Nike Facebook & Instagram ads right now');
  });

  it("emits no JSON-LD on the noindex honest shell", async () => {
    const markup = await render(
      populated({
        hasCachedAds: false,
        ads: [],
        checkedAgo: null,
        lastCheckedAt: null,
        teaser: null,
        aggression: null,
        changeEvents: [],
        noindex: true,
      }),
    );

    expect(markup).not.toContain("application/ld+json");
    expect(markup).not.toContain("@type");
  });

  it("emits no JSON-LD when the emergency noindex brake is on", async () => {
    const markup = await render(populated({ noindex: true }));

    expect(markup).not.toContain("application/ld+json");
    expect(markup).not.toContain("@type");
  });

  it("emits no hasPart on an indexable brand page with no stored timeline (no broken Dataset link)", async () => {
    // Default populated() has offerTimelineEntries: []. The WebPage JSON-LD
    // must NOT carry a hasPart pointing at /timeline/nike.com — that URL is
    // 410 Gone when no snapshots are stored (timeline.$domain.tsx).
    const markup = await render(populated());

    expect(markup).toContain('"@type":"WebPage"');
    expect(markup).not.toContain('"hasPart"');
    expect(markup).not.toContain('"@type":"Dataset"');
  });

  it("links the WebPage hasPart to the Offer Timeline Dataset on an indexable page with a stored timeline (issue #964)", async () => {
    const markup = await render(
      populated({
        offerTimelineEntries: [
          {
            id: "snap-nike-20260825",
            capturedAt: "2026-08-25T00:00:00.000Z",
            dateLabel: "25 Aug 2026",
            canonicalUrl: "https://www.nike.com/",
            headline: "Nike. Just Do It.",
            ctaText: "Shop Now",
            priceText: null,
            formPresent: false,
            screenshotHref: null,
            pageTextHref: null,
            evidenceNote: null,
            transition: null,
          },
        ],
      }),
    );

    // The WebPage JSON-LD carries a hasPart Dataset pointing at the timeline
    // canonical URL — the same /timeline/nike.com link the visible section
    // renders. Answer engines can follow this to the citable change-ledger.
    expect(markup).toContain('"@type":"WebPage"');
    expect(markup).toContain('"hasPart":{');
    expect(markup).toContain('"@type":"Dataset"');
    expect(markup).toContain('"name":"Nike offer timeline"');
    expect(markup).toContain('"url":"https://0509.io/timeline/nike.com"');
  });

  it("emits no hasPart on a noindex brand page even when a stored timeline exists", async () => {
    // The freshness gate: only indexable brand pages get the hasPart link.
    // A noindex page (stale, emergency brake, score-thin) carries no
    // structured data at all, so the Dataset relationship is never advertised
    // for a page answer engines must not index.
    const markup = await render(
      populated({
        noindex: true,
        offerTimelineEntries: [
          {
            id: "snap-nike-20260825",
            capturedAt: "2026-08-25T00:00:00.000Z",
            dateLabel: "25 Aug 2026",
            canonicalUrl: "https://www.nike.com/",
            headline: "Nike. Just Do It.",
            ctaText: "Shop Now",
            priceText: null,
            formPresent: false,
            screenshotHref: null,
            pageTextHref: null,
            evidenceNote: null,
            transition: null,
          },
        ],
      }),
    );

    expect(markup).not.toContain("application/ld+json");
    expect(markup).not.toContain('"hasPart"');
    expect(markup).not.toContain('"@type":"Dataset"');
  });
});

describe("/ads/:domain — capture-validity proof cross-link (issue #1320)", () => {
  it("links the 'what we refuse to alert on' trust page from every sampled /ads/:domain page", async () => {
    const captureRulesHref = `href="${CAPTURE_RULES_PUBLIC_PATH}"`;
    // The issue's evidence domains — the pages a "<brand> facebook ads"
    // buyer actually lands on. All three are indexable populated captures;
    // the trust link (the "no phantom changes" claim) must render on each.
    for (const domain of ["nike.com", "nykaa.com", "figma.com"] as const) {
      const markup = await render(populated({ domain, canonicalPath: `/ads/${domain}` }));
      expect(markup).toContain(captureRulesHref);
      expect(markup).toContain("What we refuse to alert on");
      expect(markup).toContain("No phantom changes");
    }
  });

  it("keeps the trust link on the score-thin state (no aggression data), still rendered from the hero", async () => {
    const markup = await render(populated({ aggression: null }));

    expect(markup).toContain(`href="${CAPTURE_RULES_PUBLIC_PATH}"`);
    expect(markup).toContain("What we refuse to alert on");
  });
});

describe("/ads/:domain — ad-aggression methodology footer cross-link (issue #1552)", () => {
  const anchor = "How the Ad Aggression Score is calculated";

  it("links the methodology page from the ad wall footer on every populated page, including the five live demo brands", async () => {
    const methodologyHref = `href="${AD_AGGRESSION_METHODOLOGY_PATH}"`;
    // Evidence domains from the issue — the pages a "<brand> facebook ads"
    // buyer lands on. All five are populated captures with ≥1 verified ad;
    // the methodology cross-link must render on each and sit after the wall.
    for (const domain of ["nike.com", "nykaa.com", "allbirds.com", "lenskart.com", "mamaearth.com"] as const) {
      const markup = await render(populated({ domain, canonicalPath: `/ads/${domain}` }));
      expect(markup).toContain(methodologyHref);
      expect(markup).toContain(anchor);
      expect(markup.indexOf(anchor)).toBeGreaterThan(markup.indexOf("All 6 ads, on the wall"));
    }
  });

  it("hides the methodology footer on an unverified wall with no verified-linked ad (no score exists to explain)", async () => {
    const markup = await render(
      populated({ verifiedLinkedAds: [], verifiedLinkCount: 0, aggression: null }),
    );

    expect(markup).not.toContain(anchor);
  });
});

describe("/ads/:domain — related-brand cross-links (issue #1417)", () => {
  const other = [
    { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas" },
    { domain: "asos.com", path: "/ads/asos.com", name: "ASOS" },
    { domain: "hm.com", path: "/ads/hm.com", name: "H&M" },
    { domain: "nykaa.com", path: "/ads/nykaa.com", name: "Nykaa" },
  ] as const;

  it("cross-links every populated page to OTHER /ads pages and never to itself", async () => {
    for (const domain of ["nike.com", "adidas.com", "asos.com", "hm.com"] as const) {
      // Mirror pickRelatedBrandLinks: the current domain is always excluded
      // from the related set — a page must never link to itself.
      const others = other.filter((link) => link.domain !== domain);
      const markup = await render(
        populated({ domain, canonicalPath: `/ads/${domain}`, relatedBrands: others }),
      );
      // At least one cross-link to another /ads/:domain page renders.
      const adsHrefCount = (markup.match(/href="\/ads\//g) ?? []).length;
      expect(adsHrefCount).toBeGreaterThan(0);
      // The page never links to itself.
      expect(markup).not.toContain(`href="/ads/${domain}"`);
      // Every other brand in the set is linked.
      for (const link of others) {
        expect(markup).toContain(`href="${link.path}"`);
      }
    }
  });

  it("hides the related-brand section when no OTHER indexable brand pages exist, and never links /brands without real links", async () => {
    const markup = await render(populated({ relatedBrands: [] }));
    expect(markup).not.toContain("Browse tracked competitors");
  });
});

/**
 * Issue #1417 regression: the sitemap /ads pages were orphaned — none linked
 * to another /ads page. The related-brand selection must guarantee that any
 * brand page with at least one other indexable brand in the sitemap gets a
 * non-empty cross-link set (never a link to itself).
 */
describe("pickRelatedBrandLinks — no /ads page is an orphan", () => {
  it("excludes the current domain and returns a deterministic capped set of OTHER brands", async () => {
    const { pickRelatedBrandLinks } = await import("~/lib/ads-internal-links");
    const links = [
      { domain: "nike.com", path: "/ads/nike.com", name: "Nike" },
      { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas" },
      { domain: "asos.com", path: "/ads/asos.com", name: "ASOS" },
      { domain: "hm.com", path: "/ads/hm.com", name: "H&M" },
      { domain: "nykaa.com", path: "/ads/nykaa.com", name: "Nykaa" },
      { domain: "zara.com", path: "/ads/zara.com", name: "Zara" },
    ];

    const set = pickRelatedBrandLinks(links, "nike.com");
    // Default cap of 4.
    expect(set).toHaveLength(4);
    // Never the page itself.
    expect(set.some((link) => link.domain === "nike.com")).toBe(false);
    // Deterministic across calls (stable internal-link set, no crawl churn).
    expect(pickRelatedBrandLinks(links, "nike.com")).toEqual(set);

    // Every other brand in a small sitemap still gets cross-links when count
    // exceeds the remaining set size.
    const two = links.slice(0, 2);
    const fromAdidas = pickRelatedBrandLinks(two, "adidas.com", 4);
    expect(fromAdidas.map((link) => link.domain)).toEqual(["nike.com"]);
  });
});

describe("ads.cross.link.breadcrumb.canary — combined conditional rule (issue #1454)", () => {
  // Issue #1454 ties the two sibling fixes (1417 cross-links, 1418 breadcrumb)
  // into ONE conditional rule: every populated /ads/:domain page must render
  // BOTH the sibling cross-link block AND the BreadcrumbList JSON-LD, and a
  // page with verifiedLinkCount = 0 must render NEITHER. The two sibling
  // tests each cover one block; this guard asserts the two can never drift
  // out of step for the same page shape.
  const otherBrands = [
    { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas" },
    { domain: "asos.com", path: "/ads/asos.com", name: "ASOS" },
  ];

  it("renders BOTH the sibling cross-link block and the BreadcrumbList on a populated indexable page", async () => {
    const markup = await render(
      populated({ verifiedLinkCount: 6, relatedBrands: otherBrands }),
    );

    // BreadcrumbList JSON-LD present on a populated indexable page.
    expect(markup).toContain('"@type":"BreadcrumbList"');

    // Sibling cross-link block present: ≥2 links to OTHER /ads pages.
    expect(markup).toContain("Browse tracked competitors");
    const adsHrefCount = (markup.match(/href="\/ads\/(?=.)/g) ?? []).length;
    expect(adsHrefCount).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('href="/ads/adidas.com"');
    expect(markup).toContain('href="/ads/asos.com"');
    // The page never cross-links to itself.
    expect(markup).not.toContain('href="/ads/nike.com"');
  });

  it("renders NEITHER the sibling cross-link block NOR the BreadcrumbList when verifiedLinkCount = 0", async () => {
    const markup = await render(
      populated({
        verifiedLinkedAds: [],
        verifiedLinkCount: 0,
        relatedBrands: [],
        noindex: true,
      }),
    );

    expect(markup).not.toContain('"@type":"BreadcrumbList"');
    expect(markup).not.toContain("Browse tracked competitors");
    expect(markup.match(/href="\/ads\/(?=.)/g) ?? []).toHaveLength(0);
  });
});

describe("brand categories — /brands hub grouping (issue #1417)", () => {
  it("classifies known domains and buckets unknowns under 'More brands'", async () => {
    const mod = await import("~/lib/brand-categories");
    expect(mod.brandCategoryForDomain("nike.com")).toBe("Sport & footwear");
    expect(mod.brandCategoryForDomain("hm.com")).toBe("E-commerce");
    expect(mod.brandCategoryForDomain("www.hm.com")).toBe("E-commerce");
    expect(mod.brandCategoryForDomain("unknownbrand.example")).toBe("More brands");
  });

  it("groups indexable links into categories with the 'More brands' bucket last", async () => {
    const mod = await import("~/lib/brand-categories");
    const links = [
      { domain: "nike.com" },
      { domain: "mybrand.com" },
      { domain: "adidas.com" },
      { domain: "other.example" },
    ];
    const groups = mod.groupBrandRecordsByCategory(links);
    const cats = groups.map((group) => group.category);
    expect(cats).toContain("Sport & footwear");
    expect(cats[cats.length - 1]).toBe("More brands");
    const sport = groups.find((group) => group.category === "Sport & footwear");
    expect(sport?.items.map((item: { domain: string }) => item.domain).sort()).toEqual([
      "adidas.com",
      "nike.com",
    ]);
  });
});
