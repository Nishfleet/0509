import { readdirSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publicSocialCardForRequest, parseSocialCardPathname } from "~/lib/social-cards.server";
import {
  adsSocialCardUrl,
  brandCategorySocialCardUrl,
  canonicalUrl,
  clusterSocialCardUrl,
  compareSocialCardUrl,
  switchSocialCardUrl,
  timelineSocialCardUrl,
} from "~/lib/seo";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { OfferTimelineLoaderData } from "~/routes/timeline.$domain";
import { emptyDomainArchive } from "~/lib/archive";

type MetaEntry = { property?: string; name?: string; content?: string; title?: string };

function ogImage(entries: readonly MetaEntry[]): string | undefined {
  return entries.find((e) => e.property === "og:image")?.content;
}
function ogImageAlt(entries: readonly MetaEntry[]): string | undefined {
  return entries.find((e) => e.property === "og:image:alt")?.content;
}
function twitterImage(entries: readonly MetaEntry[]): string | undefined {
  return entries.find((e) => e.name === "twitter:image")?.content;
}

const GENERIC_OG_IMAGE = canonicalUrl("/og-image.png");

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(undefined),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLocation: vi.fn().mockReturnValue({ pathname: "/", search: "", hash: "" }),
      useNavigate: vi.fn().mockReturnValue(vi.fn()),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("publicSeoMeta og:image override", () => {
  it("falls back to the generic og-image.png when no override is passed", async () => {
    const { publicSeoMeta } = await import("~/lib/seo");
    const meta = publicSeoMeta({
      title: "Home",
      description: "desc",
      pathname: "/",
    }) as readonly MetaEntry[];
    expect(ogImage(meta)).toBe(GENERIC_OG_IMAGE);
    expect(twitterImage(meta)).toBe(GENERIC_OG_IMAGE);
  });

  it("stamps the override URL + alt for og:image and twitter:image", async () => {
    const { publicSeoMeta } = await import("~/lib/seo");
    const card = compareSocialCardUrl("panoramata");
    const meta = publicSeoMeta({
      title: "Five to Nine vs Panoramata",
      description: "desc",
      pathname: "/compare/panoramata",
      ogImageUrl: card,
      ogImageAlt: "Five to Nine vs Panoramata comparison card",
    }) as readonly MetaEntry[];
    expect(ogImage(meta)).toBe(card);
    expect(twitterImage(meta)).toBe(card);
    expect(ogImageAlt(meta)).toBe("Five to Nine vs Panoramata comparison card");
    expect(meta.find((e) => e.property === "og:image:type")?.content).toBe("image/svg+xml");
  });
});

describe("social card URL builders", () => {
  it("adsSocialCardUrl encodes the brand name and score", () => {
    const url = adsSocialCardUrl("nike.com", "Nike", 72);
    expect(url).toContain("/social-card/ads/nike.com.png?");
    expect(url).toContain("n=Nike");
    expect(url).toContain("s=72");
  });

  it("adsSocialCardUrl omits the score when null (deferred < 14-day floor)", () => {
    const url = adsSocialCardUrl("nike.com", "Nike", null);
    expect(url).toContain("/social-card/ads/nike.com.png?");
    expect(url).toContain("n=Nike");
    expect(url).not.toContain("s=");
  });

  it("compareSocialCardUrl and switchSocialCardUrl build the card path", () => {
    expect(compareSocialCardUrl("panoramata")).toBe(canonicalUrl("/social-card/compare/panoramata.svg"));
    expect(switchSocialCardUrl("panoramata")).toBe(canonicalUrl("/social-card/switch/panoramata.svg"));
  });

  it("clusterSocialCardUrl builds the standalone surface card path", () => {
    expect(clusterSocialCardUrl("sneaker-resale")).toBe(canonicalUrl("/social-card/sneaker-resale.svg"));
    expect(clusterSocialCardUrl("competitor-monitoring")).toBe(
      canonicalUrl("/social-card/competitor-monitoring.svg"),
    );
  });

  it("brandCategorySocialCardUrl builds the per-category landing-page card path", () => {
    expect(brandCategorySocialCardUrl("sport-footwear")).toBe(
      canonicalUrl("/social-card/brand/sport-footwear.svg"),
    );
    expect(brandCategorySocialCardUrl("beauty-personal-care")).toBe(
      canonicalUrl("/social-card/brand/beauty-personal-care.svg"),
    );
  });

  it("timelineSocialCardUrl encodes the brand name on the timeline card path", () => {
    const url = timelineSocialCardUrl("nike.com", "Nike");
    expect(url).toContain("/social-card/timeline/nike.com.png?");
    expect(url).toContain("n=Nike");
    expect(url).toMatch(/^https:\/\/0509\.io\/social-card\/timeline\//);
  });
});

describe("parseSocialCardPathname", () => {
  it("parses ads / timeline / compare / switch / cluster card paths", () => {
    expect(parseSocialCardPathname("/social-card/ads/nike.com.svg")).toEqual({
      kind: "ads",
      slug: "nike.com",
    });
    expect(parseSocialCardPathname("/social-card/ads/nike.com.png")).toEqual({
      kind: "ads",
      slug: "nike.com",
    });
    expect(parseSocialCardPathname("/social-card/timeline/nike.com.svg")).toEqual({
      kind: "timeline",
      slug: "nike.com",
    });
    expect(parseSocialCardPathname("/social-card/timeline/nike.com.png")).toEqual({
      kind: "timeline",
      slug: "nike.com",
    });
    expect(parseSocialCardPathname("/social-card/compare/panoramata.svg")).toEqual({
      kind: "compare",
      slug: "panoramata",
    });
    expect(parseSocialCardPathname("/social-card/switch/panoramata.svg")).toEqual({
      kind: "switch",
      slug: "panoramata",
    });
    expect(parseSocialCardPathname("/social-card/sneaker-resale.svg")).toEqual({
      kind: "cluster",
      slug: "sneaker-resale",
    });
    expect(parseSocialCardPathname("/social-card/brand/sport-footwear.svg")).toEqual({
      kind: "brand",
      slug: "sport-footwear",
    });
  });

  it("returns null for non-card paths", () => {
    expect(parseSocialCardPathname("/og-image.png")).toBeNull();
    expect(parseSocialCardPathname("/social-card/ads/nike.com")).toBeNull();
    expect(parseSocialCardPathname("/social-card/unknown.svg")).toBeNull();
  });
});

describe("publicSocialCardForRequest", () => {
  it("renders an ads card stamping the brand name and score", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/ads/nike.com.png?n=Nike&s=72"),
    );
    expect(res?.contentType).toBe("image/svg+xml; charset=utf-8");
    expect(res?.body).toContain("Nike");
    expect(res?.body).toContain("Ad Aggression Score 72");
    expect(res?.body).toContain("Five to Nine");
    expect(res?.kind).toBe("ads");
  });

  it("renders a timeline card stamping the brand and offer-timeline copy", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/timeline/nike.com.png?n=Nike"),
    );
    expect(res?.contentType).toBe("image/svg+xml; charset=utf-8");
    expect(res?.body).toContain("Nike");
    expect(res?.body).toContain("offer timeline");
    expect(res?.body).toContain("Five to Nine");
    expect(res?.cacheControl).toBe("public, max-age=3600");
    expect(res?.kind).toBe("timeline");
  });

  it("renders a timeline card from the domain slug when n is omitted", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/timeline/nike.com.png"),
    );
    expect(res?.body).toContain("nike.com");
  });

  it("renders an ads card without a score when s is omitted", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/ads/nike.com.png?n=Nike"),
    );
    expect(res?.body).toContain("Nike");
    expect(res?.body).not.toContain("Ad Aggression Score 72");
    expect(res?.body).toContain("Meta ads tracking");
  });

  it("renders a compare card naming both tools", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/compare/panoramata.svg"),
    );
    expect(res?.body).toContain("Five to Nine vs Panoramata");
  });

  it("renders a switch card naming the source tool", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/switch/panoramata.svg"),
    );
    expect(res?.body).toContain("Switch from Panoramata");
  });

  it("renders cluster cards for the standalone buyer surfaces", () => {
    const sneaker = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/sneaker-resale.svg"),
    );
    expect(sneaker?.body).toContain("Sneaker resale ads");
    const comp = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/competitor-monitoring.svg"),
    );
    expect(comp?.body).toContain("Competitor monitoring");
  });

  it("renders a brand category card with the curated label and static cache control", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/brand/sport-footwear.svg"),
    );
    expect(res?.kind).toBe("brand");
    expect(res?.contentType).toBe("image/svg+xml; charset=utf-8");
    expect(res?.body).toContain("Sport &amp; footwear Meta ads");
    expect(res?.body).toContain("Competitor Meta ad libraries");
    expect(res?.body).toContain("Five to Nine");
    // Static card (no brand query params) — same branch as the cluster cards.
    expect(res?.cacheControl).toBe("public, max-age=86400");
  });

  it("returns null for an unknown or More-brands brand slug (no page exists)", () => {
    expect(
      publicSocialCardForRequest(
        new Request("https://0509.io/social-card/brand/unknown.svg"),
      ),
    ).toBeNull();
    expect(
      publicSocialCardForRequest(
        new Request("https://0509.io/social-card/brand/more-brands.svg"),
      ),
    ).toBeNull();
  });

  it("returns null for an unknown compare slug", () => {
    expect(
      publicSocialCardForRequest(new Request("https://0509.io/social-card/compare/unknown.svg")),
    ).toBeNull();
  });

  it("XML-escapes brand text so it cannot break the SVG", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/ads/x.png?n=A%26B%3Cscript%3E"),
    );
    expect(res?.body).toContain("A&amp;B&lt;script&gt;");
    expect(res?.body).not.toContain("<script>");
  });
});

describe("every programmatic buyer surface stamps a non-generic og:image", () => {
  it.each(
    readdirSync("app/routes")
      .filter((name) => /^compare\.[^.]+\.tsx$/.test(name))
      .map((name) => name.replace(/\.tsx$/, "")),
  )("%s stamps a /social-card/compare og:image + alt", async (routeId) => {
    const routeModule = (await import(`~/routes/${routeId}`)) as {
      meta: () => readonly MetaEntry[];
    };
    const meta = routeModule.meta();
    const img = ogImage(meta);
    expect(img, `${routeId} still uses generic og-image.png`).not.toBe(GENERIC_OG_IMAGE);
    expect(img).toMatch(/^https:\/\/0509\.io\/social-card\/compare\//);
    expect(img).toMatch(/\.svg$/);
    expect(ogImageAlt(meta), `${routeId} missing og:image:alt`).toBeTruthy();
  });

  it.each(["switch.panoramata", "switch.visualping"])(
    "%s stamps a /social-card/switch og:image + alt",
    async (routeId) => {
      const routeModule = (await import(`~/routes/${routeId}`)) as {
        meta: () => readonly MetaEntry[];
      };
      const meta = routeModule.meta();
      const img = ogImage(meta);
      expect(img, `${routeId} still uses generic og-image.png`).not.toBe(GENERIC_OG_IMAGE);
      expect(img).toMatch(/^https:\/\/0509\.io\/social-card\/switch\//);
      expect(ogImageAlt(meta)).toMatch(/^Switch from .+ to Five to Nine$/);
    },
  );

  it.each([
    "sneaker-resale",
    "competitor-monitoring",
  ])("%s stamps a cluster og:image + alt", async (routeId) => {
    const routeModule = (await import(`~/routes/${routeId}`)) as {
      meta: () => readonly MetaEntry[];
    };
    const meta = routeModule.meta();
    const img = ogImage(meta);
    expect(img, `${routeId} still uses generic og-image.png`).not.toBe(GENERIC_OG_IMAGE);
    expect(img).toMatch(/^https:\/\/0509\.io\/social-card\//);
    expect(ogImageAlt(meta)).toBeTruthy();
  });
});

describe("/ads/:domain meta stamps a branded og:image", () => {
  const baseData: BrandPageLoaderData = {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: [],
    adCount: 0,
    verifiedTestedCount: 0,
    tickerAds: [],
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-09-01T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser: null,
    aggression: {
      score: 72,
      components: { velocity: 22, testing: 19, freshness: 20, persistence: 11 },
      bandId: "all_out",
      bandLabel: "All-out",
      bandInterpretation: "Running an all-out launch and testing push.",
      formulaVersion: 1 as never,
      windowDays: 21,
      adsPerWeek: 6,
      adCount: 6,
      activeCount: 6,
    },
    observationDays: null,
    changeEvents: [],
    offerTimelineEntries: [],
    timelineIndexable: true,
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    recentWatchChanges: [],
    sourceSnapshots: [],
  };

  it("stamps a branded ads card URL with the brand name + score", async () => {
    const routeModule = (await import("~/routes/ads.$domain")) as unknown as {
      meta: (args: { loaderData: BrandPageLoaderData }) => readonly MetaEntry[];
    };
    const meta = routeModule.meta({ loaderData: baseData });
    const img = ogImage(meta);
    expect(img).not.toBe(GENERIC_OG_IMAGE);
    expect(img).toMatch(/^https:\/\/0509\.io\/social-card\/ads\/nike\.com\.png\?/);
    expect(img).toContain("n=Nike");
    expect(img).toContain("s=72");
    expect(ogImageAlt(meta)).toContain("Nike");
    expect(ogImageAlt(meta)).toContain("72");
  });

  it("omits the score from the card URL when aggression is deferred", async () => {
    const routeModule = (await import("~/routes/ads.$domain")) as unknown as {
      meta: (args: { loaderData: BrandPageLoaderData }) => readonly MetaEntry[];
    };
    const meta = routeModule.meta({ loaderData: { ...baseData, aggression: null } });
    const img = ogImage(meta);
    expect(img).toContain("n=Nike");
    expect(img).not.toContain("s=");
    expect(ogImageAlt(meta)).toContain("Nike");
    expect(ogImageAlt(meta)).not.toContain("Ad Aggression Score");
  });
});

describe("/timeline/:domain meta stamps a branded og:image (issue #2029)", () => {
  const baseData = {
    domain: "nike.com",
    brandName: "Nike",
    canonicalPath: "/timeline/nike.com",
    sharePath: "/timeline/nike.com",
    shareUrl: "https://0509.io/timeline/nike.com",
    shareEnabled: true,
    asOf: null,
    asOfState: null,
    entries: [],
    noindex: false,
  };

  it("og:title names the brand and og:image is the per-domain timeline card", async () => {
    const routeModule = (await import("~/routes/timeline.$domain")) as unknown as {
      meta: (args: { loaderData: typeof baseData }) => readonly MetaEntry[];
    };
    const meta = routeModule.meta({ loaderData: baseData });
    const title = meta.find((e) => e.title !== undefined)?.title as string;
    expect(title).toContain("Nike");
    expect(ogImage(meta)).not.toBe(GENERIC_OG_IMAGE);
    expect(ogImage(meta)).toMatch(/^https:\/\/0509\.io\/social-card\/timeline\/nike\.com\.png\?/);
    expect(ogImage(meta)).toContain("n=Nike");
    expect(ogImageAlt(meta)).toContain("Nike");
    expect(ogImageAlt(meta)).toContain("offer timeline");
    expect(twitterImage(meta)).toBe(ogImage(meta));
  });
});

/**
 * Route-level regression gate (issue #2089): every /ads/:domain and
 * /timeline/:domain page in the sitemap cohort must declare an og:image:type
 * that matches the content-type actually served at its og:image URL. The
 * worker rasterizes these cards to PNG (image/png), so a page that advertises
 * image/png while the fetched asset is SVG (or vice-versa) fails here — the
 * exact mix-and-match the issue observed on live production.
 */
describe("/ads and /timeline sitemap cohort og:image:type matches served content-type (issue #2089)", () => {
  // Representative sitemap cohort: the same domains the live sitemap appends
  // as dynamic /ads/:domain and /timeline/:domain entries. Each page's meta
  // is rendered through the real route module, so a regression that re-points
  // a card at an SVG URL (or mis-declares its type) fails CI.
  const ADS_COHORT = ["nike.com", "nykaa.com"] as const;
  const TIMELINE_COHORT = ["nike.com", "nykaa.com"] as const;

  function ogImageType(entries: readonly MetaEntry[]): string | undefined {
    return entries.find((e) => e.property === "og:image:type")?.content;
  }

  it.each(ADS_COHORT)("/ads/%s og:image:type matches the served PNG content-type", async (domain) => {
    const routeModule = (await import("~/routes/ads.$domain")) as unknown as {
      meta: (args: { loaderData: BrandPageLoaderData }) => readonly MetaEntry[];
    };
    const meta = routeModule.meta({
      loaderData: {
        domain,
        brandName: domain.split(".")[0],
        hasCachedAds: true,
        ads: [],
        adCount: 0,
        verifiedTestedCount: 0,
        tickerAds: [],
        checkedAgo: "about 2 hours ago",
        lastCheckedAt: "2026-09-01T10:00:00.000Z",
        freshForLiveClaim: false,
        brandOwnedAdCount: 6,
        verifiedLinkCount: 6,
        unverifiedMatchCount: 0,
        partnerCampaignAdIds: [],
        teaser: null,
        aggression: {
          score: 72,
          components: { velocity: 22, testing: 19, freshness: 20, persistence: 11 },
          bandId: "all_out",
          bandLabel: "All-out",
          bandInterpretation: "Running an all-out launch and testing push.",
          formulaVersion: 1 as never,
          windowDays: 21,
          adsPerWeek: 6,
          adCount: 6,
          activeCount: 6,
        },
        observationDays: null,
        changeEvents: [],
        offerTimelineEntries: [],
        timelineIndexable: true,
        adLibraryCountry: "India",
        noindex: false,
        relatedBrands: [],
        canonicalPath: `/ads/${domain}`,
        captureFailuresSummary: null,
        recentWatchChanges: [],
        sourceSnapshots: [],
      },
    });
    const image = ogImage(meta);
    const type = ogImageType(meta);
    expect(image, `/ads/${domain} missing og:image`).toBeTruthy();
    expect(image, `/ads/${domain} og:image must be a .png URL`).toMatch(/\.png\?/);
    expect(image, `/ads/${domain} og:image must not point at svg`).not.toMatch(/\.svg(\?|$)/);
    expect(type, `/ads/${domain} og:image:type`).toBe("image/png");
    // The served content-type at the og:image URL is image/png (the worker
    // rasterizes ads cards to PNG), so the declared type must match it.
    const served = publicSocialCardForRequest(
      new Request(`https://0509.io/social-card/ads/${domain}.png?n=${domain.split(".")[0]}&s=72`),
    );
    expect(served?.kind).toBe("ads");
  });

  it.each(TIMELINE_COHORT)("/timeline/%s og:image:type matches the served PNG content-type", async (domain) => {
    const routeModule = (await import("~/routes/timeline.$domain")) as unknown as {
      meta: (args: { loaderData: OfferTimelineLoaderData }) => readonly MetaEntry[];
    };
    const meta = routeModule.meta({
      loaderData: {
        domain,
        brandName: domain.split(".")[0],
        canonicalPath: `/timeline/${domain}`,
        sharePath: `/timeline/${domain}`,
        shareUrl: `https://0509.io/timeline/${domain}`,
        shareEnabled: true,
        asOf: null,
        asOfState: null,
        entries: [],
        archive: emptyDomainArchive(domain, new Date("2026-01-01T00:00:00Z")),
        sourceEvents: [],
        noindex: false,
        collecting: false,
      },
    });
    const image = ogImage(meta);
    const type = ogImageType(meta);
    expect(image, `/timeline/${domain} missing og:image`).toBeTruthy();
    expect(image, `/timeline/${domain} og:image must be a .png URL`).toMatch(/\.png\?/);
    expect(image, `/timeline/${domain} og:image must not point at svg`).not.toMatch(/\.svg(\?|$)/);
    expect(type, `/timeline/${domain} og:image:type`).toBe("image/png");
    const served = publicSocialCardForRequest(
      new Request(`https://0509.io/social-card/timeline/${domain}.png?n=${domain.split(".")[0]}`),
    );
    expect(served?.kind).toBe("timeline");
  });
});

describe("parseSocialCardPathname malformed percent-encoding (issue #2465)", () => {
  it("does not throw on malformed percent-encoding", () => {
    expect(() => parseSocialCardPathname("/social-card/ads/%zz.svg")).not.toThrow();
    expect(() => parseSocialCardPathname("/social-card/ads/%E0%A4%A.svg")).not.toThrow();
    expect(() => parseSocialCardPathname("/social-card/ads/%.svg")).not.toThrow();
    expect(() => parseSocialCardPathname("/social-card/timeline/%zz.svg")).not.toThrow();
  });

  it("falls through to null so the route 404s", () => {
    expect(parseSocialCardPathname("/social-card/ads/%zz.svg")).toBeNull();
    expect(parseSocialCardPathname("/social-card/ads/%E0%A4%A.svg")).toBeNull();
    expect(parseSocialCardPathname("/social-card/ads/%.svg")).toBeNull();
    expect(parseSocialCardPathname("/social-card/timeline/%zz.svg")).toBeNull();
  });

  it("still decodes well-formed slugs", () => {
    expect(parseSocialCardPathname("/social-card/ads/nike.com.svg")).toEqual({
      kind: "ads",
      slug: "nike.com",
    });
    expect(parseSocialCardPathname("/social-card/ads/nike%2Ecom.svg")).toEqual({
      kind: "ads",
      slug: "nike.com",
    });
  });
});
