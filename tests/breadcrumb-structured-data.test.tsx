import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lock test for issue #1463: every programmatic page outside /ads/:domain
 * must carry `BreadcrumbList` JSON-LD (Home → Category → Page, or Home →
 * page on top-level surfaces) PLUS a visible breadcrumb nav, and the two must
 * never drift. A page is only "done" when both the structured data and the
 * visible trail are present and honest.
 *
 * The visible nav is exercised by asserting the `<nav aria-label="Breadcrumb">`
 * element with the same trail names, so markup and JSON-LD are checked
 * together (the shared <Breadcrumbs> component renders both from one array).
 */

let loaderData: unknown = undefined;

function reactRouterMock(custom: Record<string, unknown> = {}) {
  return async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => loaderData,
      useRouteLoaderData: () => undefined,
      useLocation: () => ({ pathname: "/en" }),
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      ...custom,
    };
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", reactRouterMock());
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

function breadcrumb(markup: string): Record<string, unknown> | undefined {
  const blocks = parseLdJsonBlocks(markup);
  return blocks.find((block) => block["@type"] === "BreadcrumbList");
}

function itemsOf(breadcrumb: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!breadcrumb) {
    return [];
  }
  return (breadcrumb["itemListElement"] as Array<Record<string, unknown>>) ?? [];
}

function crumbNames(items: Array<Record<string, unknown>>): string[] {
  return items.map((item) => String(item["name"]));
}

async function renderDefault(route: string, data?: unknown): Promise<string> {
  if (data !== undefined) {
    loaderData = data;
  }
  const { default: Route } = await import(`~/routes/${route}`);
  return renderToStaticMarkup(createElement(Route));
}

describe("BreadcrumbList on /compare/* pages (issue #1463)", () => {
  it.each([
    ["compare.visualping", ["Home", "Competitor monitoring", "Visualping"]],
    ["compare.magicbrief", ["Home", "Competitor monitoring", "MagicBrief"]],
    ["compare.panoramata", ["Home", "Competitor monitoring", "Panoramata"]],
  ])("%s carries an honest BreadcrumbList and visible nav", async (route, names) => {
    const markup = await renderDefault(route);
    const trail = breadcrumb(markup);
    expect(trail?.["@context"]).toBe("https://schema.org");
    expect(crumbNames(itemsOf(trail))).toEqual(names);
    // Visible nav must exist and match the JSON-LD trail.
    expect(markup).toContain('<nav aria-label="Breadcrumb"');
    for (const name of names) {
      expect(markup).toContain(name);
    }
  });
});

describe("BreadcrumbList on /switch/* pages (issue #1463)", () => {
  it("switch/magicbrief carries the shared SwitchLanding trail", async () => {
    const markup = await renderDefault("switch.magicbrief");
    expect(crumbNames(itemsOf(breadcrumb(markup)))).toEqual([
      "Home",
      "Competitor monitoring",
      "Switch from MagicBrief",
    ]);
    expect(markup).toContain('<nav aria-label="Breadcrumb"');
  });
});

describe("BreadcrumbList on category / top-level pages (issue #1463)", () => {
  it.each([
    ["sneaker-resale", ["Home", "Sneaker resale"]],
    ["capture-rules", ["Home", "Capture rules"]],
    ["ad-aggression", ["Home", "Ad Aggression Score"]],
  ])("%s carries a Home → page trail and visible nav", async (route, names) => {
    const markup = await renderDefault(route);
    expect(crumbNames(itemsOf(breadcrumb(markup)))).toEqual(names);
    expect(markup).toContain('<nav aria-label="Breadcrumb"');
  });

  it("competitor-monitoring carries Home → Competitor monitoring", async () => {
    const markup = await renderDefault("competitor-monitoring", {
      proofBrief: null,
      indexableAdsLinks: [],
    });
    expect(crumbNames(itemsOf(breadcrumb(markup)))).toEqual([
      "Home",
      "Competitor monitoring",
    ]);
    expect(markup).toContain('<nav aria-label="Breadcrumb"');
  });
});

describe("Breadcrumbs component integrity (issue #1463)", () => {
  it("renders visible nav and BreadcrumbList from one items array (Home → Pricing)", async () => {
    const { Breadcrumbs } = await import("~/components/breadcrumbs");
    const markup = renderToStaticMarkup(
      createElement(Breadcrumbs, {
        items: [
          { name: "Home", pathname: "/" },
          { name: "Pricing", pathname: "/pricing" },
        ],
      }),
    );

    const trail = breadcrumb(markup);
    expect(crumbNames(itemsOf(trail))).toEqual(["Home", "Pricing"]);
    expect(itemsOf(trail)[0]?.["item"]).toBe("https://0509.io/");
    expect(itemsOf(trail)[1]?.["item"]).toBe("https://0509.io/pricing");
    expect(markup).toContain('<nav aria-label="Breadcrumb"');
    // The last crumb is the current page: plain text, not a link.
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">Home</a>");
    expect(markup).toContain(">Pricing</span>");
  });

  it("renders a Home → Category → Page trail with all intermediate links", async () => {
    const { Breadcrumbs } = await import("~/components/breadcrumbs");
    const markup = renderToStaticMarkup(
      createElement(Breadcrumbs, {
        items: [
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "Visualping", pathname: "/compare/visualping" },
        ],
      }),
    );
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/competitor-monitoring"');
    // Current position renders as text, not a self-link.
    expect(markup).toContain(">Visualping</span>");
    expect(markup).toContain('aria-current="page"');
  });
});
