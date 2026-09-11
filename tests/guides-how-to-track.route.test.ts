import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "./helpers/mock-react-router";

beforeEach(() => {
  vi.resetModules();
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("guides how-to-track-competitor-ads route", () => {
  it("renders the honest guide: free manual workflow, priced DIY route, and the break points", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.how-to-track-competitor-ads"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    // The manual Monday workflow — never hidden that it is free.
    expect(markup).toContain("The manual Monday workflow.");
    expect(markup).toContain("This method is free");
    expect(markup).toContain("Open the Meta Ad Library");
    expect(markup).toContain("Screenshot what is running");
    expect(markup).toContain("Log it in a sheet");
    // The n8n / Apify DIY option with the real Apify price cited.
    expect(markup).toContain("n8n, self-hosted");
    expect(markup).toContain("Apify actors");
    expect(markup).toContain("$29/month");
    expect(markup).toContain("apify.com/pricing");
    // Where both break.
    expect(markup).toContain("Inactive ads disappear");
    expect(markup).toContain("Skipped weeks are permanent gaps");
    expect(markup).toContain("No landing-page diff");
    // The free weekly watch positioned as the automated answer.
    expect(markup).toContain("The automated answer: a free weekly watch.");
    expect(markup).toContain("One competitor, watched weekly, free");
    // CTA is the public /search preview carrying the allowlisted marker.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="source"');
    expect(markup).toContain('value="guide_track_ads"');
    expect(markup).toContain('href="/search?source=guide_track_ads"');
    // Honest scope: Meta Ad Library only — no multi-platform coverage claim.
    expect(markup).toContain("Meta Ad Library only");
    expect(markup).not.toMatch(/multi-platform/iu);
    expect(markup).not.toMatch(/all (major )?platforms/iu);
    // The guide's own copy names no competitor tools (the shared nav/footer
    // chrome links the compare/switch cluster site-wide, so scope the check
    // to the page body between the header and footer).
    const body = markup.split("</header>")[1]?.split("<footer")[0] ?? markup;
    expect(body).not.toMatch(/Panoramata|Foreplay|Spyder|Visualping|AdSpyder/iu);
    expect(body).not.toMatch(/WhatsApp/iu);
    // Shared marketing chrome.
    expect(markup).toContain("Named for 05:09");
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import("~/routes/guides.how-to-track-competitor-ads");

    const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
    expect(links()).toEqual([
      { rel: "canonical", href: "https://0509.io/guides/how-to-track-competitor-ads" },
      ...buyerSurfaceHreflangLinks("guides/how-to-track-competitor-ads"),
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("How to track competitor ads | Five to Nine");
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/guides/how-to-track-competitor-ads",
    });
  });

  it("is registered as a route and published in the sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain(
      'route("guides/how-to-track-competitor-ads", "routes/guides.how-to-track-competitor-ads.tsx")',
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/guides/how-to-track-competitor-ads</loc>",
    );
  });

  it("emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries", async () => {
    const { default: GuideRoute, trackAdsFaqEntries } = await import(
      "~/routes/guides.how-to-track-competitor-ads"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    const ldBlocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const faqBlocks = ldBlocks
      .map((match) => JSON.parse(match[1]))
      .filter((data) => data["@type"] === "FAQPage");

    expect(faqBlocks).toHaveLength(1);
    const mainEntity = faqBlocks[0].mainEntity as Array<{ name: string }>;
    expect(mainEntity).toHaveLength(trackAdsFaqEntries.length);
    expect(mainEntity.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(trackAdsFaqEntries.map((entry) => entry.question)),
    );
  });

  it("allowlists the guide_track_ads signup source marker", async () => {
    const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
      "~/lib/signup-source"
    );
    expect(ALLOWED_SIGNUP_SOURCES).toContain("guide_track_ads");
    expect(allowlistedSignupSource("guide_track_ads")).toBe("guide_track_ads");
    expect(allowlistedSignupSource("guide_track_ads&x=1")).toBeNull();
  });
});
