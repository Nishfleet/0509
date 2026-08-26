import { readdirSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const PINNED_COMPARED_PRODUCT: Record<string, string> = {
  "compare.magicbrief": "MagicBrief",
  "compare.meta-ad-library": "Meta Ad Library",
  "compare.visualping": "Visualping",
  "compare.visualping-ad-library": "Visualping",
  "compare.spyland": "Spyland",
  "compare.pulzifi": "Pulzifi",
  "compare.foreplay": "Foreplay",
  "compare.foreplay-spyder": "Foreplay Spyder",
  "compare.panoramata": "Panoramata",
  "compare.adspyder": "AdSpyder",
};

function compareRouteIds(): string[] {
  return readdirSync("app/routes")
    .filter((name) => /^compare\..+\.tsx$/.test(name))
    .map((name) => name.replace(/\.tsx$/, ""))
    .sort();
}

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
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

describe("every /compare/* page emits schema.org JSON-LD", () => {
  const routeIds = compareRouteIds();

  it("discovers the compare route files so a new page cannot skip this suite", () => {
    expect(routeIds.length).toBeGreaterThanOrEqual(6);
    expect(routeIds).toEqual(expect.arrayContaining(Object.keys(PINNED_COMPARED_PRODUCT)));
  });

  it.each(routeIds)("%s emits valid WebPage JSON-LD naming the compared product", async (routeId) => {
    const routeModule = (await import(`~/routes/${routeId}`)) as {
      default: () => ReactNode;
      meta: () => Array<{ title?: string; name?: string; content?: string }>;
    };
    const markup = renderToStaticMarkup(createElement(routeModule.default));
    const blocks = parseLdJsonBlocks(markup);

    expect(blocks.length, `${routeId} is missing application/ld+json`).toBeGreaterThanOrEqual(1);

    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);

    const webPage = webPages[0] ?? {};
    expect(webPage["@context"]).toBe("https://schema.org");
    expect(typeof webPage.name).toBe("string");
    expect(typeof webPage.description).toBe("string");
    expect(webPage.url).toMatch(/^https:\/\/0509\.io\/compare\//);
    expect(webPage.publisher).toEqual({
      "@type": "Organization",
      name: "Five to Nine",
      url: "https://0509.io",
    });

    const head = routeModule.meta();
    const title = head.find((entry) => "title" in entry)?.title ?? "";
    const description = head.find((entry) => entry.name === "description")?.content ?? "";
    expect(webPage.name).toBe(title);
    expect(webPage.description).toBe(description);

    const mainEntity = webPage.mainEntity as Record<string, unknown> | undefined;
    expect(mainEntity).toEqual(
      expect.objectContaining({
        "@type": "SoftwareApplication",
        name: expect.any(String),
      }),
    );
    expect(String(mainEntity?.name).length).toBeGreaterThan(0);
    expect(markup).toContain(String(mainEntity?.name));

    const pinned = PINNED_COMPARED_PRODUCT[routeId];
    if (pinned) {
      expect(mainEntity?.name).toBe(pinned);
    }

    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toMatch(/aggregateRating|reviewCount|ratingValue/i);
    expect(serialized).not.toContain('"@type":"AggregateRating"');
    expect(serialized).not.toContain('"@type":"Offer"');
    expect(serialized).not.toContain('"@type":"Review"');
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
  });

  it.each([
    "compare.magicbrief",
    "compare.meta-ad-library",
    "compare.panoramata",
    "compare.foreplay-spyder",
    "compare.adspyder",
    "compare.visualping-ad-library",
  ])(
    "%s keeps a FAQPage block because the page has a visible FAQ",
    async (routeId) => {
      const routeModule = (await import(`~/routes/${routeId}`)) as { default: () => ReactNode };
      const markup = renderToStaticMarkup(createElement(routeModule.default));
      const faqBlocks = parseLdJsonBlocks(markup).filter((block) => block["@type"] === "FAQPage");
      expect(faqBlocks).toHaveLength(1);
    },
  );
});
