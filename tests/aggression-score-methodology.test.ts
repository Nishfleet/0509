import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AD_AGGRESSION_METHODOLOGY_PATH,
  AD_AGGRESSION_METHODOLOGY_PATH_LEGACY,
  AGGRESSION_FORMULA_VERSION,
  AGGRESSION_FRESHNESS_DAYS,
  AGGRESSION_PERSISTENCE_DAYS,
  MIN_AGGRESSION_WINDOW_DAYS,
  linearShareCurvePoints,
  publicAggressionBands,
  testingCurvePoints,
  velocityCurvePoints,
} from "~/lib/aggression-score";
import { canonicalUrl } from "~/lib/seo";

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
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Ad Aggression Score methodology page", () => {
  it("publishes the formula, four sub-scores, bands, and evidence floor", async () => {
    const { default: MethodologyRoute, meta, links } = await import(
      "~/routes/ad-aggression"
    );
    const markup = renderToStaticMarkup(createElement(MethodologyRoute));

    expect(AD_AGGRESSION_METHODOLOGY_PATH).toBe("/ad-aggression");
    expect(AD_AGGRESSION_METHODOLOGY_PATH_LEGACY).toBe("/methodology/ad-aggression-score");
    expect(markup).toContain("Ad Aggression Score");
    expect(markup).toContain(`formula version ${AGGRESSION_FORMULA_VERSION}`);
    expect(markup).toContain("Velocity");
    expect(markup).toContain("Testing");
    expect(markup).toContain("Freshness");
    expect(markup).toContain("Persistence");
    expect(markup).toContain(`${velocityCurvePoints(1)} points`);
    expect(markup).toContain(`${velocityCurvePoints(3)} points`);
    expect(markup).toContain(`${velocityCurvePoints(5)} points`);
    expect(markup).toContain(`${testingCurvePoints(0.5)} points`);
    expect(markup).toContain(`${linearShareCurvePoints(1)} points`);
    expect(markup).toContain(`${MIN_AGGRESSION_WINDOW_DAYS} days of observed history`);
    expect(markup).toContain(`${AGGRESSION_FRESHNESS_DAYS} days`);
    expect(markup).toContain(`${AGGRESSION_PERSISTENCE_DAYS} days`);
    expect(markup).toContain("Not spend, impressions, reach");
    expect(markup).toContain("Meta Ad Library");
    expect(markup).not.toContain("proprietary");
    expect(markup).not.toContain("link magnet");

    for (const band of publicAggressionBands()) {
      expect(markup).toContain(`${band.minScore}–${band.maxScore} ${band.label}`);
      expect(markup).toContain(band.interpretation);
    }

    const tags = meta({} as never) as Array<Record<string, string>>;
    expect(tags).toContainEqual({
      title: "Ad Aggression Score methodology | Five to Nine",
    });
    expect(tags).toContainEqual({
      property: "og:url",
      content: canonicalUrl(AD_AGGRESSION_METHODOLOGY_PATH),
    });
    expect(links()).toEqual([
      { rel: "canonical", href: canonicalUrl(AD_AGGRESSION_METHODOLOGY_PATH) },
    ]);
  });

  it("emits WebPage and FAQ JSON-LD that match the visible page", async () => {
    const { default: MethodologyRoute } = await import(
      "~/routes/ad-aggression"
    );
    const markup = renderToStaticMarkup(createElement(MethodologyRoute));
    const blocks = parseLdJsonBlocks(markup);

    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);
    expect(webPages[0]?.name).toBe("Ad Aggression Score methodology | Five to Nine");
    expect(webPages[0]?.url).toBe(canonicalUrl(AD_AGGRESSION_METHODOLOGY_PATH));

    const faqs = blocks.filter((block) => block["@type"] === "FAQPage");
    expect(faqs).toHaveLength(1);
    const questions = faqs[0]?.mainEntity as Array<{ name: string }>;
    expect(questions.map((entry) => entry.name)).toEqual([
      "What is the Ad Aggression Score?",
      "How is the Ad Aggression Score calculated?",
      "Why does a brand have no Ad Aggression Score?",
      "Does a high score mean the brand is spending more?",
    ]);
  });
});

describe("publicAggressionBands", () => {
  it("covers 0–100 with inclusive edges that match aggressionBandForScore", async () => {
    const { aggressionBandForScore } = await import("~/lib/aggression-score");
    const bands = publicAggressionBands();

    expect(bands.map((band) => [band.minScore, band.maxScore, band.id])).toEqual([
      [0, 25, "quiet"],
      [26, 50, "steady"],
      [51, 75, "aggressive"],
      [76, 100, "all_out"],
    ]);
    for (const band of bands) {
      expect(aggressionBandForScore(band.minScore).id).toBe(band.id);
      expect(aggressionBandForScore(band.maxScore).id).toBe(band.id);
    }
  });
});

/**
 * Legacy /methodology/ad-aggression-score → /ad-aggression 301 (issue #1263).
 *
 * The old path was the canonical URL when issue #960 shipped the page; issue
 * #1263 renamed it to the shorter, quotable /ad-aggression path so the link
 * a buyer pastes into chat is short. A permanent 301 preserves the indexed
 * URL's ranking signal so the rename does not cost SEO equity. This test
 * pins the redirect so a future cleanup that drops the loader silently
 * regresses the page to a 404 — Google would then de-index the formula
 * page for every /ads/:domain visitor who lands there.
 */
describe("Ad Aggression Score methodology legacy path redirect (issue #1263)", () => {
  it("301-redirects /methodology/ad-aggression-score to /ad-aggression", async () => {
    const { loader } = await import("~/routes/methodology.ad-aggression-score-redirect");
    let captured: Response | null = null;
    try {
      const result = loader({
        request: new Request("https://0509.io/methodology/ad-aggression-score"),
      } as Parameters<typeof loader>[0]);
      captured = result as unknown as Response;
    } catch (thrown) {
      // React Router's `redirect()` throws a Response, not returns one; the
      // loader is `throw redirect(...)`, so the value never lands in the
      // happy path. Capture the thrown response here.
      captured = thrown as Response;
    }
    expect(captured, "loader must throw a redirect Response").not.toBeNull();
    expect(captured!.status).toBe(301);
    expect(captured!.headers.get("location")).toBe("/ad-aggression");
  });

  it("registers the legacy path as a 301 redirect route in app/routes.ts", async () => {
    // Source-of-truth guard: the route entry MUST still exist. If somebody
    // deletes the redirect, the 301 above keeps passing (the loader file is
    // orphaned but still importable), so this guard pins the wiring too.
    const routesSource = await import("node:fs").then((fs) =>
      fs.readFileSync("app/routes.ts", "utf8"),
    );
    expect(routesSource).toMatch(
      /route\(\s*["']methodology\/ad-aggression-score["']\s*,\s*["']routes\/methodology\.ad-aggression-score-redirect(?:\.ts)?["']\s*\)/,
    );
    // And the canonical route must be at /ad-aggression (not the legacy path).
    expect(routesSource).toMatch(
      /route\(\s*["']ad-aggression["']\s*,\s*["']routes\/ad-aggression(?:\.tsx)?["']\s*\)/,
    );
  });

  it("sitemap registers the canonical /ad-aggression, not the legacy path", async () => {
    const { SITEMAP_PATHS } = await import("~/lib/seo");
    expect(SITEMAP_PATHS as readonly string[]).toContain("/ad-aggression");
    expect(SITEMAP_PATHS as readonly string[]).not.toContain(
      "/methodology/ad-aggression-score",
    );
  });
});
