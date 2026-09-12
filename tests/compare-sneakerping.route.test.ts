import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUYER_SURFACE_LOCALE_IDS } from "~/lib/locale-markets";
import { FREE_PREVIEW_SEARCH_DOMAIN } from "~/lib/demo-brand-pages";
import { mockReactRouter } from "./helpers/mock-react-router";

/**
 * Issue #3302: /compare/sneakerping — the 15th compare surface, aimed at the
 * sneaker-resale demand cluster the 2026-09-12 market signal leads with
 * (SneakerPing's 59.5%-below-retail study is back; the Nike r/stocks thread
 * still growing). The route follows the existing compare.keeptabz pattern:
 * only what SneakerPing's own public pages state, every SneakerPing claim
 * carrying its citation, 0509-side wording factual and neutral, and the
 * switch framing ending in the free /search preview — not a demo form.
 */

beforeEach(() => {
  vi.resetModules();
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRoute() {
  return import("~/routes/compare.sneakerping");
}

describe("compare sneakerping route (issue #3302)", () => {
  it("is registered as the 15th compare surface and renders the cited, honest comparison", async () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("compare/sneakerping", "routes/compare.sneakerping.tsx")');
    expect(routes).toContain('route("compare/sneakerping", "routes/$locale.compare.sneakerping.tsx")');

    const mod = await loadRoute();
    const markup = renderToStaticMarkup(createElement(mod.default));

    // The compare family's one-plain-h1 convention.
    expect(markup).toContain("<h1");
    const h1Matches = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches[0][1]).not.toMatch(/<[^>]+>/);
    expect(h1Matches[0][1].trim().length).toBeGreaterThan(0);

    // Every SneakerPing claim traces to its cited public source: the 40+
    // store price-alert job, the published 3,538-release study (59.5% below
    // retail, median 10.6% under, figures as of 18 August 2026), and the
    // free 5-pair tier. SneakerPing's paid tiers are hedged — no uncited
    // price numbers.
    expect(markup).toContain("SneakerPing");
    expect(markup).toContain("40+ online stores");
    expect(markup).toContain("3,538");
    expect(markup).toContain("59.5%");
    expect(markup).toContain("10.6%");
    expect(markup).toContain("5 pairs");
    expect(markup).toContain("Confirm current plans on SneakerPing's site");

    // The #1863 posture: the primary claim section points its
    // data-source-url at SneakerPing's own first-party page, and both cited
    // public sources render in the citation footer.
    expect(markup).toContain('data-source-url="https://sneakerping.com/"');
    expect(markup).toContain('href="https://sneakerping.com/"');
    expect(markup).toContain('href="https://sneakerping.com/sneaker-resale-market-report"');

    // Structured data: a WebPage plus exactly one FAQPage sized to the
    // exported entries (the compare family's #2085 posture).
    const ldBlocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(ldBlocks.length).toBeGreaterThanOrEqual(1);
    const parsed = ldBlocks.map((match) => JSON.parse(match[1]));
    expect(parsed.some((data) => data["@type"] === "WebPage")).toBe(true);
    const faqBlocks = parsed.filter((data) => data["@type"] === "FAQPage");
    expect(faqBlocks).toHaveLength(1);
    expect(faqBlocks[0].mainEntity).toHaveLength(mod.faqEntries.length);
  });

  it("ends the switch framing in the free /search preview, not a demo form", async () => {
    const mod = await loadRoute();
    const markup = renderToStaticMarkup(createElement(mod.default));

    // Exactly one form: the hero's public search preview, pre-filled with
    // the free-preview domain — the compare family's #2141 CTA posture.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('method="get"');
    expect(markup).toContain('aria-label="Public search preview"');
    expect(markup).toContain(FREE_PREVIEW_SEARCH_DOMAIN);
    expect(markup).toContain("Try it free, no account");
    const forms = markup.match(/<form\b/g) ?? [];
    expect(forms).toHaveLength(1);
  });

  it("publishes the sitemap <loc> and the llms.txt entry", async () => {
    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain("<loc>https://0509.io/compare/sneakerping</loc>");
    expect(sitemap?.body).not.toContain("<changefreq>");
    expect(sitemap?.body).not.toContain("<priority>");

    const { LLMS_TEXT } = await import("~/lib/public-markdown");
    expect(LLMS_TEXT).toContain("https://0509.io/compare/sneakerping");
  });

  it("keeps canonical→EN on the EN route and the $locale wrapper (per #1562)", async () => {
    const mod = await loadRoute();
    expect(mod.links()).toEqual([{ rel: "canonical", href: "https://0509.io/compare/sneakerping" }]);
    const tags = (mod.meta({} as never) ?? []) as Array<Record<string, string>>;
    expect(tags.find((tag) => "title" in tag)?.title).toBe("Five to Nine vs SneakerPing");

    // The $locale wrapper re-exports the EN meta and keeps the #1562
    // canonicalisation: canonical→EN, plus the buyer-surface hreflang
    // cluster — exactly the compare.keeptabz wrapper's shape.
    const wrapper = await import("~/routes/$locale.compare.sneakerping");
    const wrapperLinks = wrapper.links() as Array<Record<string, string>>;
    expect(wrapperLinks[0]).toEqual({ rel: "canonical", href: "https://0509.io/compare/sneakerping" });
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      expect(wrapperLinks).toContainEqual({
        rel: "alternate",
        hreflang: locale,
        href: `https://0509.io/${locale}/compare/sneakerping`,
      });
    }
    expect(wrapperLinks).toContainEqual({
      rel: "alternate",
      hreflang: "x-default",
      href: "https://0509.io/compare/sneakerping",
    });
    const wrapperTags = (wrapper.meta({} as never) ?? []) as Array<Record<string, string>>;
    expect(wrapperTags.find((tag) => "title" in tag)?.title).toBe("Five to Nine vs SneakerPing");
  });

  it("is internally linked from the sneaker-resale cluster + /brands surfaces, and its og:image card resolves", async () => {
    // #3167 rail: the marketing footer renders on every /sneaker-resale/*
    // and /brands/* page, so its compare link puts the 15th surface one hop
    // from the sneaker-resale cluster this issue targets.
    const { MarketingFooter } = await import("~/components/marketing-footer");
    const footerMarkup = renderToStaticMarkup(createElement(MarketingFooter));
    expect(footerMarkup).toContain('href="/compare/sneakerping"');
    // The demanded surfaces really render that footer.
    expect(readFileSync("app/components/sneaker-resale-landing.tsx", "utf8")).toContain("<MarketingFooter");
    expect(readFileSync("app/routes/brands.$category.tsx", "utf8")).toContain("<MarketingFooter");

    // #3167 reciprocity: the new page cross-links the compare family.
    const mod = await loadRoute();
    const markup = renderToStaticMarkup(createElement(mod.default));
    expect(markup).toContain('href="/compare/keeptabz"');
    expect(markup).toContain('href="/compare/meta-ad-library"');

    // The og:image the route stamps must actually resolve — an unstamped
    // COMPARE_PRODUCT_NAMES row 404s the card (the #3237 404 disease).
    const { publicSocialCardForRequest } = await import("~/lib/social-cards.server");
    const card = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/compare/sneakerping.svg"),
    );
    expect(card).not.toBeNull();
    expect(card?.body).toContain("Five to Nine vs SneakerPing");
    const tags = (mod.meta({} as never) ?? []) as Array<{ property?: string; content?: string }>;
    const ogImage = tags.find((entry) => entry.property === "og:image")?.content;
    expect(ogImage).toBe("https://0509.io/social-card/compare/sneakerping.svg");
  });
});
