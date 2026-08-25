import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";
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
    teaser,
    aggression,
    changeEvents,
    adLibraryCountry: "India",
    noindex: false,
    canonicalPath: "/ads/nike.com",
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
      "Ad Aggression Score",
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

  it("names the all-countries view as a single ALL-countries query, not worldwide coverage", async () => {
    const markup = await render(populated({ adLibraryCountry: "all countries" }));

    // The wall source line names the single all-countries query — it must
    // not claim worldwide coverage ("across all countries").
    expect(markup).toContain(
      "real creatives from the Meta Ad Library&#x27;s all-countries query · cached about 2 hours ago",
    );
    expect(markup).toContain(
      '"description":"See 6 Meta ads from Nike (nike.com), from a public check of the Meta Ad Library\'s all-countries query about 2 hours ago. Get an email when their ads or offer change."',
    );
    // The false worldwide claim never renders on any surface.
    expect(markup).not.toContain("across all countries");
    // No single country is implied anywhere in the source lines.
    expect(markup).not.toContain("the India Ad Library");
    expect(markup).not.toContain("the public India Ad Library");
  });

  it("regression: adLibrarySourcePhrase never revives the worldwide claim", async () => {
    const { adLibrarySourcePhrase, publicAdLibrarySourcePhrase } = await import(
      "~/routes/ads.$domain"
    );

    // The all-countries value is a single `country=ALL` query, not a union
    // of every market — the phrase must name it as one query and must never
    // bring back "across all countries".
    expect(adLibrarySourcePhrase("all countries")).toBe(
      "the Meta Ad Library's all-countries query",
    );
    expect(adLibrarySourcePhrase("all countries")).not.toContain("across all countries");
    // The null fallback (no country on the snapshot) gets the same honest
    // phrasing rather than implying worldwide coverage.
    expect(adLibrarySourcePhrase(null)).toBe("the Meta Ad Library's all-countries query");
    expect(adLibrarySourcePhrase(null)).not.toContain("across all countries");

    // The public closer-line variant follows the same rule.
    expect(publicAdLibrarySourcePhrase("all countries")).toBe(
      "the public Meta Ad Library's all-countries query",
    );
    expect(publicAdLibrarySourcePhrase("all countries")).not.toContain("across all countries");
    expect(publicAdLibrarySourcePhrase(null)).toBe(
      "the public Meta Ad Library's all-countries query",
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
    expect(markup).toContain("here&#x27;s what you&#x27;d wake up to");
    expect(markup).toContain("Run a free live search");
    expect(markup).toContain("Example");
    // Never the old apologetic empty state, and no ticker without cached ads.
    expect(markup).not.toContain("haven&#x27;t checked");
    expect(markup).not.toContain("ld-ticker");
    // The signup CTA still carries the domain.
    expect(markup).toContain("website%3Dnike.com");
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

    // No brand-owned claim anywhere — the headline attributes to the domain.
    expect(stale).toContain("The last check found ");
    expect(stale).toContain("6 Meta ads");
    expect(stale).toContain("pointing at nike.com");
    expect(stale).toContain("nike.com · on record");
    expect(stale).not.toContain("Nike was running ");
    expect(stale).not.toContain("Nike is running ");
    expect(stale).not.toContain("Nike · live");

    // Fresh capture: same attribution, honest present tense for the capture.
    expect(fresh).toContain("6 Meta ads");
    expect(fresh).toContain("are pointing at nike.com right now.");
    expect(fresh).toContain("Other advertisers are testing");
    expect(fresh).toContain("nike.com · live");

    // Closer never calls the creatives Nike's own ads.
    expect(stale).toContain(
      "Ad creatives are real ads from the public India Ad Library, run by other advertisers linking to nike.com",
    );
    expect(stale).toContain("The advertisers linking to nike.com will change their next ad.");
    expect(stale).not.toContain("Nike's real ads");
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
    const stale = await render(
      populated({
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
    expect(stale).toContain(
      "Another 5 ads matched the search without a verified link to nike.com.",
    );
    // The wall still carries every cached creative.
    expect(stale).toContain("All 6 ads, on the wall");
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
});

describe("/ads/:domain — truthful WebPage JSON-LD", () => {
  it("emits WebPage JSON-LD on an indexable page, mirroring the visible claims", async () => {
    const markup = await render(populated());

    expect(markup).toContain('type="application/ld+json"');
    expect(markup).toContain('"@type":"WebPage"');
    // name and description must match the meta title/description exactly.
    expect(markup).toContain(
      '"name":"Nike Facebook & Instagram ads — checked about 2 hours ago | Five to Nine"',
    );
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

  it("flips the JSON-LD name to the live-claim title only while the capture is fresh", async () => {
    const markup = await render(
      populated({ checkedAgo: "moments ago", freshForLiveClaim: true }),
    );

    expect(markup).toContain(
      '"name":"Nike Facebook & Instagram ads right now | Five to Nine"',
    );
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
});
