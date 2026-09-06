import { readdirSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publicSocialCardForRequest, parseSocialCardPathname } from "~/lib/social-cards.server";
import {
  adsSocialCardUrl,
  canonicalUrl,
  clusterSocialCardUrl,
  compareSocialCardUrl,
  switchSocialCardUrl,
} from "~/lib/seo";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";

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
    expect(url).toContain("/social-card/ads/nike.com.svg?");
    expect(url).toContain("n=Nike");
    expect(url).toContain("s=72");
  });

  it("adsSocialCardUrl omits the score when null (deferred < 14-day floor)", () => {
    const url = adsSocialCardUrl("nike.com", "Nike", null);
    expect(url).toContain("/social-card/ads/nike.com.svg?");
    expect(url).toContain("n=Nike");
    expect(url).not.toContain("s=");
  });

  it("compareSocialCardUrl and switchSocialCardUrl build the card path", () => {
    expect(compareSocialCardUrl("panoramata")).toBe(canonicalUrl("/social-card/compare/panoramata.svg"));
    expect(switchSocialCardUrl("magicbrief")).toBe(canonicalUrl("/social-card/switch/magicbrief.svg"));
  });

  it("clusterSocialCardUrl builds the standalone surface card path", () => {
    expect(clusterSocialCardUrl("sneaker-resale")).toBe(canonicalUrl("/social-card/sneaker-resale.svg"));
    expect(clusterSocialCardUrl("competitor-monitoring")).toBe(
      canonicalUrl("/social-card/competitor-monitoring.svg"),
    );
  });
});

describe("parseSocialCardPathname", () => {
  it("parses ads / compare / switch / cluster card paths", () => {
    expect(parseSocialCardPathname("/social-card/ads/nike.com.svg")).toEqual({
      kind: "ads",
      slug: "nike.com",
    });
    expect(parseSocialCardPathname("/social-card/compare/panoramata.svg")).toEqual({
      kind: "compare",
      slug: "panoramata",
    });
    expect(parseSocialCardPathname("/social-card/switch/magicbrief.svg")).toEqual({
      kind: "switch",
      slug: "magicbrief",
    });
    expect(parseSocialCardPathname("/social-card/sneaker-resale.svg")).toEqual({
      kind: "cluster",
      slug: "sneaker-resale",
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
      new Request("https://0509.io/social-card/ads/nike.com.svg?n=Nike&s=72"),
    );
    expect(res?.contentType).toBe("image/svg+xml; charset=utf-8");
    expect(res?.body).toContain("Nike");
    expect(res?.body).toContain("Ad Aggression Score 72");
    expect(res?.body).toContain("Five to Nine");
  });

  it("renders an ads card without a score when s is omitted", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/ads/nike.com.svg?n=Nike"),
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
      new Request("https://0509.io/social-card/switch/magicbrief.svg"),
    );
    expect(res?.body).toContain("Switch from MagicBrief");
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

  it("returns null for an unknown compare slug", () => {
    expect(
      publicSocialCardForRequest(new Request("https://0509.io/social-card/compare/unknown.svg")),
    ).toBeNull();
  });

  it("XML-escapes brand text so it cannot break the SVG", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/ads/x.svg?n=A%26B%3Cscript%3E"),
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

  it.each(["switch.magicbrief", "switch.panoramata", "switch.visualping"])(
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
    verifiedLinkedAds: [],
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
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
  };

  it("stamps a branded ads card URL with the brand name + score", async () => {
    const routeModule = (await import("~/routes/ads.$domain")) as unknown as {
      meta: (args: { loaderData: BrandPageLoaderData }) => readonly MetaEntry[];
    };
    const meta = routeModule.meta({ loaderData: baseData });
    const img = ogImage(meta);
    expect(img).not.toBe(GENERIC_OG_IMAGE);
    expect(img).toMatch(/^https:\/\/0509\.io\/social-card\/ads\/nike\.com\.svg\?/);
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
