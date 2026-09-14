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

// Issue #3421 — /guides/can-ChatGPT-monitor-competitor-ads, the buyer's
// first-question explainer ("can my AI just check this?"). The PATH slug is
// EXACT: uppercase `ChatGPT` stays in the path; only the signup-source MARKER
// is lowercase (`/^[a-z0-9][a-z0-9-]{0,39}$/` forbids uppercase). Every
// slug-bearing assertion below pins that exact casing.
describe("guides can-ChatGPT-monitor-competitor-ads route", () => {
  const SLUG_PATH = "/guides/can-ChatGPT-monitor-competitor-ads";
  const CANONICAL = `https://0509.io${SLUG_PATH}`;
  const SOURCE_MARKER = "guide-can-chatgpt-monitor-ads";

  it("renders the honest guide: three structural limits, AI strengths, watch ownership, free /search preview CTA", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.can-ChatGPT-monitor-competitor-ads"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    // The three fact blocks — structural, not effort problems.
    expect(markup).toContain("Three things an AI chat structurally cannot do.");
    expect(markup).toContain("A plain HTTP client gets a 403");
    expect(markup).toContain("One point in time — history is not in the window");
    expect(markup).toContain("Unattended vigilance — somebody has to be there at 03:00");
    // The 403 fact carries its checked date and linked source (#3019 pattern).
    expect(markup).toContain("re-checked live on 13 September 2026");
    expect(markup).toContain('href="https://www.facebook.com/ads/library/"');
    // The one-point-in-time fact and the 03:00 vigilance fact.
    expect(markup).toContain("what the offer said on 12 June");
    expect(markup).toContain("We checked 24 ads at 03:00 and nothing moved");
    // The honest AI-strengths and watch-ownership halves.
    expect(markup).toContain("What an AI chat does well.");
    expect(markup).toContain("Summarising what it finds");
    expect(markup).toContain("Drafting angles");
    expect(markup).toContain("What only an always-on watch owns.");
    expect(markup).toContain("Before/after evidence with source links");
    // Honest plan truth: free first check + first brief, scheduled is paid.
    expect(markup).toContain("free plan watches one competitor");
    expect(markup).toContain("scheduled checks are a paid plan");
    // CTA is the public /search preview carrying the lowercase marker.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="source"');
    expect(markup).toContain(`value="${SOURCE_MARKER}"`);
    expect(markup).toContain(`href="/search?source=${SOURCE_MARKER}"`);
    // Honest scope: Meta Ad Library only — no multi-platform claim.
    expect(markup).toContain("Meta Ad Library only");
    expect(markup).not.toMatch(/multi-platform/iu);
    expect(markup).not.toMatch(/all (major )?platforms/iu);
    // Shared marketing chrome.
    expect(markup).toContain("Named for 05:09");
  });

  it("declares the canonical URL and public SEO meta with the exact uppercase slug", async () => {
    const { links, meta } = await import(
      "~/routes/guides.can-ChatGPT-monitor-competitor-ads"
    );

    const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
    expect(links()).toEqual([
      { rel: "canonical", href: CANONICAL },
      ...buyerSurfaceHreflangLinks(SLUG_PATH.slice(1)),
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("Can ChatGPT monitor competitor ads? | Five to Nine");
    expect(tags).toContainEqual({ property: "og:url", content: CANONICAL });
  });

  it("emits WebPage + Article + FAQPage JSON-LD whose entities match the visible page", async () => {
    const {
      default: GuideRoute,
      canChatGPTMonitorCompetitorAdsFaqEntries,
    } = await import("~/routes/guides.can-ChatGPT-monitor-competitor-ads");
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    const ldBlocks = [
      ...markup.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ];
    const entities = ldBlocks.map((match) => JSON.parse(match[1] ?? "{}"));
    const byType = (type: string) =>
      entities.filter((data) => data["@type"] === type);

    // Exactly one WebPage, one Article, one FAQPage — and nothing else.
    expect(byType("WebPage")).toHaveLength(1);
    expect(byType("Article")).toHaveLength(1);
    expect(byType("FAQPage")).toHaveLength(1);

    // The WebPage entity's @id/url is the canonical URL with the exact
    // uppercase slug — the rendered HTML itself pins the casing.
    const webPage = byType("WebPage")[0];
    expect(webPage["@id"]).toBe(CANONICAL);
    expect(webPage.url).toBe(CANONICAL);

    // The Article headline is the rendered h1 (issue #2855: no drift).
    // React escapes ' as &#x27; in markup — normalise before comparing.
    const article = byType("Article")[0];
    const h1 = (markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");
    expect(h1).toContain(article.headline as string);

    // The FAQPage mainEntity count matches the visible FAQ entries.
    const faq = byType("FAQPage")[0];
    expect(faq.mainEntity).toHaveLength(
      canChatGPTMonitorCompetitorAdsFaqEntries.length,
    );
  });

  it("is registered as a route (EN + locale cluster) and published in the sitemap with the exact uppercase slug", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain(
      `route("guides/can-ChatGPT-monitor-competitor-ads", "routes/guides.can-ChatGPT-monitor-competitor-ads.tsx")`,
    );
    expect(routes).toContain(
      `route("guides/can-ChatGPT-monitor-competitor-ads", "routes/$locale.guides.can-ChatGPT-monitor-competitor-ads.tsx")`,
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(`<loc>${CANONICAL}</loc>`);
    // The all-lowercase variant must never appear — the uppercase ChatGPT
    // path IS the pinned contract.
    expect(sitemap?.body).not.toContain(
      "<loc>https://0509.io/guides/can-chatgpt-monitor-competitor-ads</loc>",
    );
  });

  it("carries the allowlisted guide-can-chatgpt-monitor-ads signup source marker", async () => {
    const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
      "~/lib/signup-source"
    );
    expect(ALLOWED_SIGNUP_SOURCES).toContain(SOURCE_MARKER);
    expect(allowlistedSignupSource(SOURCE_MARKER)).toBe(SOURCE_MARKER);
    expect(allowlistedSignupSource(`${SOURCE_MARKER}&x=1`)).toBeNull();
  });
});
