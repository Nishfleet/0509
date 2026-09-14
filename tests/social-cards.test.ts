import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publicSocialCardForRequest, parseSocialCardPathname } from "~/lib/social-cards.server";
import {
  adsSocialCardUrl,
  brandCategorySocialCardUrl,
  canonicalUrl,
  clusterSocialCardUrl,
  compareSocialCardUrl,
  guideSocialCardUrl,
  STATIC_SURFACE_SOCIAL_CARDS,
  switchSocialCardUrl,
  timelineSocialCardUrl,
} from "~/lib/seo";

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
    expect(meta.find((e) => e.property === "og:image:type")?.content).toBe("image/png");
  });

  it("auto-derives a page-specific guide card for /guides/<slug> pathnames (issue #3098)", async () => {
    const { publicSeoMeta } = await import("~/lib/seo");
    const meta = publicSeoMeta({
      title: "How to track competitor ads | Five to Nine",
      description: "desc",
      pathname: "/guides/how-to-track-competitor-ads",
    }) as readonly MetaEntry[];
    const img = ogImage(meta);
    expect(img).not.toBe(GENERIC_OG_IMAGE);
    expect(img).toMatch(
      /^https:\/\/0509\.io\/social-card\/guides\/how-to-track-competitor-ads\.png\?/,
    );
    expect(img).toContain("n=How+to+track+competitor+ads");
    expect(twitterImage(meta)).toBe(img);
    expect(ogImageAlt(meta)).toBe("How to track competitor ads — Five to Nine how-to guide");
    expect(meta.find((e) => e.property === "og:image:type")?.content).toBe("image/png");
  });

  it("keeps the generic og-image.png on the /guides index and lets an explicit override win", async () => {
    const { publicSeoMeta } = await import("~/lib/seo");
    const indexMeta = publicSeoMeta({
      title: "Guides | Five to Nine",
      description: "desc",
      pathname: "/guides",
    }) as readonly MetaEntry[];
    expect(ogImage(indexMeta)).toBe(GENERIC_OG_IMAGE);

    const card = compareSocialCardUrl("panoramata");
    const meta = publicSeoMeta({
      title: "How to track competitor ads | Five to Nine",
      description: "desc",
      pathname: "/guides/how-to-track-competitor-ads",
      ogImageUrl: card,
      ogImageAlt: "explicit alt",
    }) as readonly MetaEntry[];
    expect(ogImage(meta)).toBe(card);
    expect(ogImageAlt(meta)).toBe("explicit alt");
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
    // Compare/switch cards are served as PNG (issue #3414) — social scrapers
    // refuse SVG og:images (the #2101, #3098, #3104 finding).
    expect(compareSocialCardUrl("panoramata")).toBe(canonicalUrl("/social-card/compare/panoramata.png"));
    expect(switchSocialCardUrl("panoramata")).toBe(canonicalUrl("/social-card/switch/panoramata.png"));
  });

  it("clusterSocialCardUrl builds the standalone surface card path", () => {
    // Cluster cards are served as PNG (issue #2101) — social scrapers refuse
    // SVG og:images, so the topical pages advertise the rasterized URL.
    expect(clusterSocialCardUrl("sneaker-resale")).toBe(canonicalUrl("/social-card/sneaker-resale.png"));
    expect(clusterSocialCardUrl("competitor-monitoring")).toBe(
      canonicalUrl("/social-card/competitor-monitoring.png"),
    );
  });

  it("brandCategorySocialCardUrl builds the per-category landing-page card path", () => {
    // Served as PNG (issue #3104) — social scrapers refuse SVG og:images;
    // the .svg URL stays as an alias that also serves PNG bytes.
    expect(brandCategorySocialCardUrl("sport-footwear")).toBe(
      canonicalUrl("/social-card/brand/sport-footwear.png"),
    );
    expect(brandCategorySocialCardUrl("beauty-personal-care")).toBe(
      canonicalUrl("/social-card/brand/beauty-personal-care.png"),
    );
  });

  it("timelineSocialCardUrl encodes the brand name on the timeline card path", () => {
    const url = timelineSocialCardUrl("nike.com", "Nike");
    expect(url).toContain("/social-card/timeline/nike.com.png?");
    expect(url).toContain("n=Nike");
    expect(url).toMatch(/^https:\/\/0509\.io\/social-card\/timeline\//);
  });

  it("guideSocialCardUrl encodes the guide headline on the card path", () => {
    const url = guideSocialCardUrl(
      "how-to-track-competitor-ads",
      "How to track competitor ads",
    );
    expect(url).toContain("/social-card/guides/how-to-track-competitor-ads.png?");
    expect(url).toContain("n=How+to+track+competitor+ads");
    expect(url).toMatch(/^https:\/\/0509\.io\/social-card\/guides\//);
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
    expect(parseSocialCardPathname("/social-card/compare/panoramata.png")).toEqual({
      kind: "compare",
      slug: "panoramata",
    });
    expect(parseSocialCardPathname("/social-card/switch/panoramata.svg")).toEqual({
      kind: "switch",
      slug: "panoramata",
    });
    expect(parseSocialCardPathname("/social-card/switch/panoramata.png")).toEqual({
      kind: "switch",
      slug: "panoramata",
    });
    expect(parseSocialCardPathname("/social-card/sneaker-resale.svg")).toEqual({
      kind: "cluster",
      slug: "sneaker-resale",
    });
    expect(parseSocialCardPathname("/social-card/sneaker-resale.png")).toEqual({
      kind: "cluster",
      slug: "sneaker-resale",
    });
    expect(parseSocialCardPathname("/social-card/brand/sport-footwear.svg")).toEqual({
      kind: "brand",
      slug: "sport-footwear",
    });
    expect(parseSocialCardPathname("/social-card/brand/sport-footwear.png")).toEqual({
      kind: "brand",
      slug: "sport-footwear",
    });
    expect(
      parseSocialCardPathname("/social-card/guides/how-to-track-competitor-ads.png"),
    ).toEqual({
      kind: "guide",
      slug: "how-to-track-competitor-ads",
    });
    expect(
      parseSocialCardPathname("/social-card/guides/how-to-track-competitor-ads.svg"),
    ).toEqual({
      kind: "guide",
      slug: "how-to-track-competitor-ads",
    });
    expect(parseSocialCardPathname("/social-card/compare.png")).toEqual({
      kind: "surface",
      slug: "compare",
    });
    expect(parseSocialCardPathname("/social-card/methodology-ad-aggression-score.svg")).toEqual({
      kind: "surface",
      slug: "methodology-ad-aggression-score",
    });
    // Issue #3383: the fixed surfaces also resolve under their page's own
    // path — the guides precedent, where the card URL mirrors the page
    // path. The parse returns the CANONICAL registry slug so the renderer
    // (which looks the copy up by slug) finds the same card.
    expect(parseSocialCardPathname("/social-card/briefs/weekly.png")).toEqual({
      kind: "surface",
      slug: "briefs-weekly",
    });
    expect(
      parseSocialCardPathname("/social-card/methodology/ad-aggression-score.png"),
    ).toEqual({
      kind: "surface",
      slug: "methodology-ad-aggression-score",
    });
  });

  it("returns null for non-card paths", () => {
    expect(parseSocialCardPathname("/og-image.png")).toBeNull();
    expect(parseSocialCardPathname("/social-card/ads/nike.com")).toBeNull();
    expect(parseSocialCardPathname("/social-card/unknown.svg")).toBeNull();
    // Same top-level shape as the surface/cluster cards, but not a registry
    // slug — must 404, not render a made-up card.
    expect(parseSocialCardPathname("/social-card/not-a-surface.png")).toBeNull();
    // The page-path alias only kinds registry hits too — a multi-segment
    // rest that joins to no registry slug stays a 404 (issue #3383).
    expect(parseSocialCardPathname("/social-card/briefs/unknown.png")).toBeNull();
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
    // The canonical `.png` URL (issue #3414) and the legacy `.svg` alias
    // both resolve through the same read path.
    const png = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/compare/panoramata.png"),
    );
    expect(png?.body).toContain("Five to Nine vs Panoramata");
    const legacy = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/compare/panoramata.svg"),
    );
    expect(legacy?.body).toBe(png?.body);
  });

  it("renders a switch card naming the source tool", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/switch/panoramata.png"),
    );
    expect(res?.body).toContain("Switch from Panoramata");
    const legacy = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/switch/panoramata.svg"),
    );
    expect(legacy?.body).toBe(res?.body);
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
    // Same parsed card as .svg; PNG output is proven by the integration test.
    const resPng = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/brand/sport-footwear.png"),
    );
    expect(resPng?.kind).toBe("brand");
    expect(resPng?.body).toContain("Sport &amp; footwear Meta ads");
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

  it("renders a guide card stamping the guide headline and how-to subline", () => {
    const res = publicSocialCardForRequest(
      new Request(
        "https://0509.io/social-card/guides/how-to-track-competitor-ads.png?n=How+to+track+competitor+ads",
      ),
    );
    expect(res?.kind).toBe("guide");
    expect(res?.contentType).toBe("image/svg+xml; charset=utf-8");
    expect(res?.body).toContain("How to track competitor ads");
    expect(res?.body).toContain("How-to guide");
    expect(res?.body).toContain("Five to Nine");
    // Static page copy (no live-data params) — same branch as cluster cards.
    expect(res?.cacheControl).toBe("public, max-age=86400");
  });

  it("renders a guide card from the humanized slug when n is omitted", () => {
    const res = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/guides/how-to-monitor-meta-ad-library.png"),
    );
    expect(res?.body).toContain("How to monitor meta ad library");
  });

  it("renders each fixed-surface card with its registry copy and static cache (issue #3114)", () => {
    for (const card of Object.values(STATIC_SURFACE_SOCIAL_CARDS)) {
      const res = publicSocialCardForRequest(
        new Request(`https://0509.io/social-card/${card.slug}.png`),
      );
      expect(res?.kind, card.slug).toBe("surface");
      expect(res?.body, card.slug).toContain(card.headline);
      expect(res?.body, card.slug).toContain(card.subline);
      expect(res?.body, card.slug).toContain("Five to Nine");
      // Static page copy (no live-data params) — same branch as the cluster
      // and guide cards.
      expect(res?.cacheControl, card.slug).toBe("public, max-age=86400");
    }
  });

  it("resolves each fixed-surface card under its page's own path too (issue #3383)", () => {
    for (const [pathname, card] of Object.entries(STATIC_SURFACE_SOCIAL_CARDS)) {
      // Single-segment page paths (/compare, /brands, /sample-brief): their
      // page-path URL IS the canonical slug URL, covered by the registry
      // sweep above. Only the nested pages get a distinct alias.
      if (!pathname.slice(1).includes("/")) continue;
      const viaPagePath = publicSocialCardForRequest(
        new Request(`https://0509.io/social-card${pathname}.png`),
      );
      const canonical = publicSocialCardForRequest(
        new Request(`https://0509.io/social-card/${card.slug}.png`),
      );
      expect(viaPagePath?.kind, pathname).toBe("surface");
      // The alias serves the SAME card bytes as the canonical URL — the
      // og:image the page stamps and the aliased unfurl cannot drift.
      expect(viaPagePath?.body, pathname).toBe(canonical?.body);
      expect(viaPagePath?.cacheControl, pathname).toBe("public, max-age=86400");
    }
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
