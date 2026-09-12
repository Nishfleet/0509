import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FREE_PREVIEW_SEARCH_DOMAIN } from "~/lib/demo-brand-pages";
import { ROOT_SITEMAP_STATIC_ENTRIES, SITEMAP_PATHS } from "~/lib/seo";
import { buildSitemapXml } from "~/lib/sitemap.server";
import { SWITCH_PAGES, switchPageForDomain } from "~/lib/switch-pages";
import routes from "~/routes";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function visibleText(markup: string) {
  return markup
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "'");
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
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

async function renderSwitchMagicbrief(): Promise<string> {
  const { default: Route } = await import("~/routes/switch.magicbrief");
  return renderToStaticMarkup(createElement(Route));
}

/**
 * Issue #2887 — the /switch/magicbrief wind-down page (BET 8). MagicBrief shut
 * down 2026-07-31 and its successor (Canva Grow) gates its highest usage tiers
 * inside the US$250/seat-yr Canva Business bundle — the only named
 * demand-capture event in the category. The page must anchor only on verified
 * public facts, stay honest about the transfer boundary, and end in the free
 * /search preview.
 */
describe("/switch/magicbrief wind-down page (issue #2887)", () => {
  it("is registered as a real EN route; the locale twin is gone (issue #2962 Branch B)", () => {
    const top = routes as unknown as Array<{ path?: string; file?: string; children?: unknown[] }>;
    const topMatch = top.filter((node) => node.path === "switch/magicbrief");
    expect(topMatch.map((node) => node.file)).toEqual(["routes/switch.magicbrief.tsx"]);
    // Issue #2962 (Branch B): the $locale.switch.magicbrief.tsx twin was
    // deleted with the untranslated buyer-surface locale cluster —
    // /de/switch/magicbrief now 301s to this EN page via the $locale.tsx
    // splat redirect, which must still be registered.
    const splat = top.filter((node) => node.path === ":locale/*");
    expect(splat.map((node) => node.file)).toEqual(["routes/$locale.tsx"]);
  });

  it("renders the shutdown anchor with its own FAQ as the quoted source", async () => {
    const markup = await renderSwitchMagicbrief();
    const text = visibleText(markup);

    // The verified shutdown fact, in MagicBrief's own words.
    expect(text).toContain("With Canva Grow now live, MagicBrief will close on July 31, 2026.");
    expect(markup).toContain('href="https://magicbrief.com/faqs"');
    // The verified bundle price, linked to Canva's own pricing page.
    expect(text).toContain("US$250");
    expect(markup).toContain('href="https://www.canva.com/pricing/"');
  });

  it("states the honest transfer boundary — list imports, archive does not", async () => {
    const markup = await renderSwitchMagicbrief();
    const text = visibleText(markup);

    expect(markup).toContain("What transfers.");
    expect(markup).toContain("What does not transfer.");
    expect(text).toContain("The competitor list");
    expect(text).toContain("Inspire collections and boards");
    expect(text).toContain("Their historical archive");
  });

  it("ends in the free /search preview, not a demo form", async () => {
    const markup = await renderSwitchMagicbrief();

    expect(markup).toContain(`href="/search?q=${FREE_PREVIEW_SEARCH_DOMAIN}"`);
    expect(markup).toMatch(/no demo form/i);
    expect(markup).not.toContain("Start migration");
    expect(markup).not.toMatch(/calendly|book a demo/i);
    // The dead vendor domain must never be the CTA target — it renders "0 ads found".
    expect(markup).not.toContain('href="/search?q=magicbrief.com"');
  });

  it("is in the sitemap source list and the rendered production sitemap XML", () => {
    expect(SITEMAP_PATHS as readonly string[]).toContain("/switch/magicbrief");
    const rootPaths = ROOT_SITEMAP_STATIC_ENTRIES.map((entry) => entry.path);
    expect(rootPaths).toContain("/switch/magicbrief");
    expect(buildSitemapXml([])).toContain("<loc>https://0509.io/switch/magicbrief</loc>");
  });

  it("is linked from the /compare hub", async () => {
    const { default: CompareIndexRoute } = await import("~/routes/compare");
    const markup = renderToStaticMarkup(createElement(CompareIndexRoute));
    expect(markup).toContain('href="/switch/magicbrief"');
  });

  it("resolves a magicbrief.com search to the switch page", () => {
    expect(switchPageForDomain("magicbrief.com")?.pathname).toBe("/switch/magicbrief");
    expect(switchPageForDomain("www.magicbrief.com")?.pathname).toBe("/switch/magicbrief");
  });

  it("emits canonical self, SEO title/description, and WebPage JSON-LD", async () => {
    const page = SWITCH_PAGES.magicbrief;
    const routeModule = (await import("~/routes/switch.magicbrief")) as unknown as {
      links: () => Array<{ rel?: string; href?: string }>;
      meta: () => Array<{ title?: string; name?: string; content?: string }>;
    };

    expect(routeModule.links()).toEqual([
      { rel: "canonical", href: "https://0509.io/switch/magicbrief" },
    ]);

    const tags = routeModule.meta();
    expect(tags.find((tag) => "title" in tag)?.title).toBe(page.title);
    const description = tags.find((tag) => tag.name === "description")?.content;
    expect(description).toBe(page.description);
    expect(description?.length ?? 0).toBeLessThanOrEqual(155);

    const markup = await renderSwitchMagicbrief();
    const blocks = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1] ?? "") as Record<string, unknown>,
    );
    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);
    expect(webPages[0]?.url).toBe("https://0509.io/switch/magicbrief");
    expect(webPages[0]?.mainEntity).toEqual({
      "@type": "SoftwareApplication",
      name: "MagicBrief",
    });
  });
});
