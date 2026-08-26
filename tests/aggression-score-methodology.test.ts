import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AD_AGGRESSION_METHODOLOGY_PATH,
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
      "~/routes/methodology.ad-aggression-score"
    );
    const markup = renderToStaticMarkup(createElement(MethodologyRoute));

    expect(AD_AGGRESSION_METHODOLOGY_PATH).toBe("/methodology/ad-aggression-score");
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
      "~/routes/methodology.ad-aggression-score"
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
