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

describe("guides how-to-monitor-meta-ad-library route (issue #2867)", () => {
  it("renders the honest monitoring routine: find the URL, pick a cadence, log, and the break points", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.how-to-monitor-meta-ad-library"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    // The manual routine — never hidden that it is free.
    expect(markup).toContain("Find the Ad Library URL");
    expect(markup).toContain("Choose a check cadence");
    expect(markup).toContain("Log what is running");
    expect(markup).toContain("This method is free");
    // Where manual monitoring breaks (accept #2: no history, geo variance,
    // interactive gates, no unattended check).
    expect(markup).toContain("No history — active ads only");
    expect(markup).toContain("Locale and geo variance");
    expect(markup).toContain("Interactive gates interrupt the routine");
    expect(markup).toContain("No unattended check");
    // The free first check positioned as the automated answer.
    expect(markup).toContain("The automated answer: a free first check and brief.");
    expect(markup).toContain("One competitor, free: one first check, one first brief");
    expect(markup).not.toContain("watched weekly");
    expect(markup).not.toContain("weekly email brief");
    expect(markup).toContain("scheduled checks and recurring briefs are a paid plan");
    // CTA is the public /search preview carrying the allowlisted marker.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="source"');
    expect(markup).toContain('value="guide-monitor-ad-library"');
    expect(markup).toContain('href="/search?source=guide-monitor-ad-library"');
    // Honest scope: Meta Ad Library only — no multi-platform coverage claim.
    expect(markup).toContain("Meta Ad Library only");
    expect(markup).not.toMatch(/multi-platform/iu);
    expect(markup).not.toMatch(/all (major )?platforms/iu);
    // The guide's own copy names no competitor tools (the shared nav/footer
    // chrome links the compare/switch cluster site-wide, so scope the check
    // to the page body between the header and footer).
    const body = markup.split("</header>")[1]?.split("<footer")[0] ?? markup;
    expect(body).not.toMatch(/Panoramata|Foreplay|Spyder|Visualping|AdSpyder/iu);
    // Shared marketing chrome.
    expect(markup).toContain("Named for 05:09");
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import(
      "~/routes/guides.how-to-monitor-meta-ad-library"
    );

    const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
    expect(links()).toEqual([
      {
        rel: "canonical",
        href: "https://0509.io/guides/how-to-monitor-meta-ad-library",
      },
      ...buyerSurfaceHreflangLinks("guides/how-to-monitor-meta-ad-library"),
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe(
      "How to monitor a competitor's Meta Ad Library | Five to Nine",
    );
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/guides/how-to-monitor-meta-ad-library",
    });
  });

  it("is registered as a route and published in the sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain(
      'route("guides/how-to-monitor-meta-ad-library", "routes/guides.how-to-monitor-meta-ad-library.tsx")',
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/guides/how-to-monitor-meta-ad-library</loc>",
    );
  });

  it("emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries", async () => {
    const { default: GuideRoute, monitorAdLibraryFaqEntries } = await import(
      "~/routes/guides.how-to-monitor-meta-ad-library"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    const ldBlocks = [
      ...markup.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ];
    const faqBlocks = ldBlocks
      .map((match) => JSON.parse(match[1] ?? "{}"))
      .filter((data) => data["@type"] === "FAQPage");

    expect(faqBlocks).toHaveLength(1);
    const mainEntity = faqBlocks[0].mainEntity as Array<{ name: string }>;
    expect(mainEntity).toHaveLength(monitorAdLibraryFaqEntries.length);
    expect(mainEntity.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(monitorAdLibraryFaqEntries.map((e) => e.question)),
    );
  });

  it("allowlists the guide-monitor-ad-library signup source marker", async () => {
    const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
      "~/lib/signup-source"
    );
    expect(ALLOWED_SIGNUP_SOURCES).toContain("guide-monitor-ad-library");
    expect(allowlistedSignupSource("guide-monitor-ad-library")).toBe(
      "guide-monitor-ad-library",
    );
    expect(allowlistedSignupSource("guide-monitor-ad-library&x=1")).toBeNull();
  });

  it("is internally linked from /docs and /competitor-monitoring", async () => {
    const { readFileSync } = await import("node:fs");
    const docs = readFileSync("app/routes/docs.tsx", "utf8");
    const monitoring = readFileSync(
      "app/routes/competitor-monitoring.tsx",
      "utf8",
    );
    expect(docs).toContain('to="/guides/how-to-monitor-meta-ad-library"');
    expect(monitoring).toContain('to="/guides/how-to-monitor-meta-ad-library"');
  });
});
