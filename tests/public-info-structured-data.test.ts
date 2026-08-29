import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1]) as Record<string, unknown>);
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

describe("public info and comparison pages emit WebPage JSON-LD", () => {
  const cases: Array<{ path: string; title: string }> = [
    { path: "~/routes/api.docs", title: "API docs | Five to Nine" },
    { path: "~/routes/privacy", title: "Privacy | Five to Nine" },
    { path: "~/routes/terms", title: "Terms | Five to Nine" },
    { path: "~/routes/changelog", title: "Changelog | Five to Nine" },
    { path: "~/routes/trust", title: "Trust | Five to Nine" },
    { path: "~/routes/capture-rules", title: "What we refuse to alert on | Five to Nine" },
    { path: "~/routes/methodology.ad-aggression-score", title: "Ad Aggression Score methodology | Five to Nine" },
    { path: "~/routes/compare.meta-ad-library", title: "Five to Nine vs checking the Meta Ad Library by hand" },
  ];

  it.each(cases)("$title emits one WebPage JSON-LD block", async ({ path, title }) => {
    const { default: Route } = await import(path);
    const markup = renderToStaticMarkup(createElement(Route));

    const blocks = parseLdJsonBlocks(markup);
    expect(blocks.length).toBeGreaterThanOrEqual(1);

    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);

    const webPage = webPages[0];
    expect(webPage["@context"]).toBe("https://schema.org");
    expect(webPage.name).toBe(title);
    expect(webPage.url).toMatch(/^https:\/\/0509\.io/);
    expect(webPage.isPartOf).toEqual({
      "@type": "WebSite",
      name: "Five to Nine",
      url: "https://0509.io",
    });
    expect(webPage.publisher).toEqual({
      "@type": "Organization",
      name: "Five to Nine",
      url: "https://0509.io",
    });
  });
});
