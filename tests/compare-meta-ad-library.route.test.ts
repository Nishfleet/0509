import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("compare meta-ad-library route", () => {
  it("renders the honest Ad Library comparison with a /search start CTA", async () => {
    const { default: CompareMetaAdLibraryRoute } = await import(
      "~/routes/compare.meta-ad-library"
    );
    const markup = renderToStaticMarkup(createElement(CompareMetaAdLibraryRoute));

    // Generous and honest about the free source we build on.
    expect(markup).toContain("What the Ad Library gives you free.");
    expect(markup).toContain("It is a genuinely good research surface.");
    expect(markup).toContain("the same public archive Five to Nine reads");
    // Manual-checking costs.
    expect(markup).toContain("What manual checking costs you.");
    expect(markup).toContain("You have to remember to check");
    expect(markup).toContain("No memory, no diffs");
    expect(markup).toContain("No evidence trail, no alerts");
    // What Five to Nine adds — claims verified against plan-entitlements.ts.
    expect(markup).toContain("Scheduled checks");
    expect(markup).toContain("every 3–6 hours");
    expect(markup).toContain("Before/after diffs");
    expect(markup).toContain("Saved evidence");
    expect(markup).toContain("Email briefs");
    expect(markup).toContain("daily on Starter and Agency, weekly on Scout");
    // Start CTA goes to the free public search preview.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('href="/search"');
    // Shared marketing footer with the compare group and brand line.
    expect(markup).toContain("Named for 05:09");
    expect(markup).toContain('href="/compare/magicbrief"');
    // No invented numbers, testimonials, or non-GA channel claims.
    expect(markup).not.toMatch(/\b\d+% of\b/);
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("WhatsApp");
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import("~/routes/compare.meta-ad-library");

    expect(links()).toEqual([
      { rel: "canonical", href: "https://0509.io/compare/meta-ad-library" },
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("Five to Nine vs checking the Meta Ad Library by hand");
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/compare/meta-ad-library",
    });
  });

  it("is registered as a route and published in the sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain(
      'route("compare/meta-ad-library", "routes/compare.meta-ad-library.tsx")',
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/compare/meta-ad-library</loc>",
    );
  });
});
