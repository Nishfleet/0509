import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AD_AGGRESSION_METHODOLOGY_PATH,
  AGGRESSION_FORMULA_VERSION,
  AGGRESSION_FRESHNESS_DAYS,
  AGGRESSION_PERSISTENCE_DAYS,
  AGGRESSION_TESTING_SATURATION_SHARE,
  MIN_AGGRESSION_WINDOW_DAYS,
  linearShareCurvePoints,
  publicAggressionBands,
  testingCurvePoints,
  velocityCurvePoints,
} from "~/lib/aggression-score";
import { buyerSurfaceHreflangLinks, canonicalUrl } from "~/lib/seo";

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
      useLocation: () => ({ pathname: "/methodology" }),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Ad Aggression Score methodology page — render", () => {
  it("renders the formula, four sub-scores, band table, and worked example", async () => {
    const { default: MethodologyRoute, meta, links } = await import(
      "~/routes/methodology"
    );
    const markup = renderToStaticMarkup(createElement(MethodologyRoute));

    // Core formula presence
    expect(AD_AGGRESSION_METHODOLOGY_PATH).toBe("/methodology/ad-aggression-score");
    expect(markup).toContain("Ad Aggression Score");
    expect(markup).toContain(`formula version ${AGGRESSION_FORMULA_VERSION}`);

    // Four components
    expect(markup).toContain("Velocity");
    expect(markup).toContain("Testing");
    expect(markup).toContain("Freshness");
    expect(markup).toContain("Persistence");

    // Velocity curve checkpoints
    expect(markup).toContain(`${velocityCurvePoints(1)} points`);
    expect(markup).toContain(`${velocityCurvePoints(3)} points`);
    expect(markup).toContain(`${velocityCurvePoints(5)} points`);

    // Testing curve checkpoints
    const testingSaturationPercent = Math.round(AGGRESSION_TESTING_SATURATION_SHARE * 100);
    expect(markup).toContain(`${testingCurvePoints(0.5)} points`);
    expect(markup).toContain(`${testingSaturationPercent}%`);

    // Freshness & Persistence linear curve checkpoints
    expect(markup).toContain(`${linearShareCurvePoints(0.5)} points`);
    expect(markup).toContain(`${AGGRESSION_FRESHNESS_DAYS} days`);
    expect(markup).toContain(`${AGGRESSION_PERSISTENCE_DAYS} days`);

    // Band table — all four bands with inclusive edges and interpretations
    for (const band of publicAggressionBands()) {
      expect(markup).toContain(`${band.minScore}–${band.maxScore} ${band.label}`);
      expect(markup).toContain(band.interpretation);
    }

    // Worked example — exact rounded parts and correct band
    const velocityVal = Math.round(velocityCurvePoints(14 / (21 / 7))); // 24
    const testingVal = Math.round(testingCurvePoints(5 / 14)); // 18
    const freshnessVal = Math.round(linearShareCurvePoints(3 / 8)); // 9
    const persistenceVal = Math.round(linearShareCurvePoints(4 / 14)); // 7
    const total = velocityVal + testingVal + freshnessVal + persistenceVal; // 58

    expect(markup).toContain("Worked example");
    expect(markup).toContain(`<strong>${velocityVal}</strong>`);
    expect(markup).toContain(`<strong>${testingVal}</strong>`);
    expect(markup).toContain(`<strong>${freshnessVal}</strong>`);
    expect(markup).toContain(`<strong>${persistenceVal}</strong>`);
    expect(markup).toContain(`<strong>${total}</strong>`);
    expect(markup).toContain("Aggressive"); // the example falls in Aggressive band (51–75)
    // The band table also lists Aggressive, but the worked example specifically
    // should name Aggressive — not Steady which is a different band.

    // Evidence floor
    expect(markup).toContain(`${MIN_AGGRESSION_WINDOW_DAYS} days of observed history`);

    // What it is not
    expect(markup).toContain("Not spend, impressions, reach");
    expect(markup).toContain("Meta Ad Library");

    // Meta and links
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
      ...buyerSurfaceHreflangLinks("methodology"),
    ]);
  });

  it("emits WebPage and FAQ JSON-LD that match the visible page", async () => {
    const { default: MethodologyRoute } = await import(
      "~/routes/methodology"
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

  it("TOC includes the worked example anchor", async () => {
    const { default: MethodologyRoute } = await import(
      "~/routes/methodology"
    );
    const markup = renderToStaticMarkup(createElement(MethodologyRoute));
    expect(markup).toContain('href="#worked-example"');
    expect(markup).toContain("Worked example");
  });
});