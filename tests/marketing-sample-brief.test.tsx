import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockProps = { children?: ReactNode } & Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderMarketingRoute() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
      ...actual,
      Form: ({ children, ...props }: MockProps) => createElement("form", props, children),
      Link: ({ children, to, ...props }: MockProps) =>
        createElement("a", { ...props, href: to }, children),
      useLoaderData: () => ({
        pricingPreview: { available: false },
        commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
      }),
      useRouteLoaderData: () => ({ session: null, pricingPlans: [], usageBundles: [] }),
    };
  });
  vi.doMock("~/components/submit-button", () => ({
    SubmitButton: ({ children, getAction, pendingLabel, ...props }: MockProps) =>
      createElement("button", props, children),
  }));

  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

function segment(markup: string, start: string, end: string) {
  const from = markup.indexOf(start);
  expect(from, `expected "${start}" in rendered markup`).toBeGreaterThan(-1);
  const to = markup.indexOf(end, from);
  return to === -1 ? markup.slice(from) : markup.slice(from, to);
}

function decisionFields(markup: string) {
  const decision = segment(markup, "Decision summary", "Source trail");
  return Object.fromEntries(
    [...decision.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

describe("marketing sample brief truthfulness", () => {
  it("renders every sample-proof field with a truthful non-empty value", async () => {
    const markup = await renderMarketingRoute();
    const fields = decisionFields(markup);

    for (const label of [
      "What changed",
      "Why it matters",
      "Urgency",
      "Proof status",
      "Source",
      "Freshness",
      "Next action",
    ]) {
      const value = fields[label];
      expect(value, `${label} must render a value`).toBeDefined();
      expect(value.trim(), `${label} must not render blank`).not.toBe("");
    }

    expect(fields["Proof status"]).toBe("Sample-only evidence");
    expect(fields["Freshness"]).toContain("Sample captured at 05:09");
  });

  it("never presents the sample brief as verified live evidence", async () => {
    const markup = await renderMarketingRoute();
    expect(markup).not.toContain("Verified evidence");
    expect(markup).toContain(
      "Sample only — no competitor was actually watched for this brief.",
    );
  });

  it("labels the source trail illustrative and links nothing fake", async () => {
    const markup = await renderMarketingRoute();
    const trail = segment(markup, "Source trail", "Client report preview");

    expect(trail).toContain(
      "Illustrative sample — a real brief links each change to its saved screenshot, page text, or Meta Ad Library capture.",
    );

    const items = [...trail.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(items.length).toBe(3);
    for (const item of items) {
      const strong = item.match(/<strong>([^<]*)<\/strong>/);
      const detail = item.match(/<p>([^<]*)<\/p>/);
      const source = item.match(/<em>([^<]*)<\/em>/);
      expect(strong?.[1]?.trim() ?? "", "trail item must render a signal").not.toBe("");
      expect(detail?.[1]?.trim() ?? "", "trail item must render evidence").not.toBe("");
      expect(source?.[1]?.trim() ?? "", "trail item must render a source").not.toBe("");
    }

    expect(trail).not.toMatch(/href=|<a /);
    expect(trail).not.toMatch(/https?:\/\//);
  });

  it("keeps the sample brief readable inside the case card styling contract", () => {
    const css = readFileSync("app/app.css", "utf8");
    expect(css).toContain(".ld-case-card .ld-case-note");
    expect(css).toMatch(/\.ld-case-card \.ld-case-note \{\s*font-size: 0\.8rem;[\s\S]*?margin: 12px 0 0;\s*\}/);
    expect(css).toContain(".ld-case-card dl > div");
    expect(css).toContain(".ld-case-card dl > div {\n  flex: 1 1 130px;");
  });
});
