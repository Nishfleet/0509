import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RootLoaderData } from "~/root";
import { pricingPlans, usageBundles } from "~/lib/pricing";
import { SAMPLE_FIELD_UNAVAILABLE } from "~/lib/demo-proof";

// The marketing route reads `useLoaderData`/`useRouteLoaderData`; a mutable
// fixture lets each test render the sample brief with a specific payload.
let currentRouteData: unknown;
let currentRootData: RootLoaderData;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentRouteData,
      useRouteLoaderData: () => currentRootData,
      useNavigation: () => ({ state: "idle" }),
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
  currentRouteData = {
    pricingPreview: { available: false },
    commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
  };
  currentRootData = {
    session: null,
    hasAuthCookie: false,
    allowsSiteRepScript: false,
    pricingPlans: pricingPlans(),
    usageBundles: usageBundles(),
    countryCode: null,
  };
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

// The Decision summary card renders one <dt>/<dd> row per label.
const DECISION_LABELS = [
  "What changed",
  "Why it matters",
  "Urgency",
  "Proof status",
  "Source",
  "Freshness",
  "Next action",
] as const;

function decisionRows(html: string): Map<string, string> {
  const start = html.indexOf("Decision summary");
  const end = html.indexOf("Source trail");
  const block = html.slice(start, end);
  const rows = new Map<string, string>();
  const pattern = /<dt>([^<]+)<\/dt><dd>([^<]*)<\/dd>/g;
  for (const match of block.matchAll(pattern)) {
    rows.set(match[1], match[2]);
  }
  return rows;
}

describe("marketing sample brief rendering", () => {
  it("renders every decision-summary proof field with a non-empty fixture-backed value", async () => {
    const html = await renderMarketing();
    const rows = decisionRows(html);

    expect(rows.size).toBe(DECISION_LABELS.length);
    for (const label of DECISION_LABELS) {
      const value = rows.get(label);
      expect(value, `"${label}" must render a definition`).toBeDefined();
      expect(value!.trim(), `"${label}" must not render blank`).not.toBe("");
      expect(value, `"${label}" must render the fixture value`).not.toBe(SAMPLE_FIELD_UNAVAILABLE);
    }

    expect(rows.get("What changed")).toBe(
      "Nykaa moved the pricing page from a sale-led hero to a routine-first bundle.",
    );
    expect(rows.get("Freshness")).toBe("Sample captured at 05:09");
    expect(rows.get("Proof status")).toBe("Verified evidence");
  });

  it("renders a populated, labeled-illustrative source trail with no empty items", async () => {
    const html = await renderMarketing();
    const start = html.indexOf("Source trail");
    const end = html.indexOf("Client-ready view");
    const block = html.slice(start, end);

    expect(block).toContain("Illustrative sample sources");
    const items = Array.from(block.matchAll(/<li><strong>([^<]+)<\/strong><p>([^<]+)<\/p><em>([^<]+)<\/em><\/li>/g));
    expect(items.length).toBe(3);
    for (const [, signal, evidence, source] of items) {
      expect(signal.trim()).not.toBe("");
      expect(evidence.trim()).not.toBe("");
      expect(source.trim()).not.toBe("");
      expect(source).not.toMatch(/https?:\/\//i);
    }
    expect(block).toContain("<strong>Offer text changed</strong>");
    expect(block).toContain("<em>Meta Ad Library capture</em>");
  });

  it("shows an explicit unavailable state instead of blank fields when the fixture is empty", async () => {
    vi.doMock("~/lib/demo-proof", () => ({
      SAMPLE_FIELD_UNAVAILABLE,
      sampleField: (value: string | null | undefined) =>
        value && value.trim() ? value : SAMPLE_FIELD_UNAVAILABLE,
      demoProof: {
        generatedAt: "sample",
        status: "sample_only",
        competitor: { name: "", website: "", market: "" },
        summary: "",
        trackedPreview: {
          watchlistName: "",
          cadence: "",
          savedCompetitor: "",
          proofCount: 0,
          deliveryPreview: "",
          loop: [],
        },
        proofTrail: [],
        digestPreview: {
          subject: "",
          whatChanged: "",
          whyItMatters: "",
          priority: "",
          recommendedMove: "",
          confidence: "",
          proofStatus: "",
          source: "",
          freshness: "",
        },
        reportPreview: { title: "", rows: [] },
        insightPreview: {
          topHooks: [],
          mediaMix: [],
          creativeTimeline: [],
          landingPageHistory: [],
        },
        exports: { digestMarkdown: "", apiPath: "" },
      },
    }));

    const html = await renderMarketing();
    const rows = decisionRows(html);

    expect(rows.size).toBe(DECISION_LABELS.length);
    for (const label of DECISION_LABELS) {
      expect(rows.get(label), `"${label}" must show the unavailable state`).toBe(
        SAMPLE_FIELD_UNAVAILABLE,
      );
    }

    const start = html.indexOf("Source trail");
    const end = html.indexOf("Client-ready view");
    const block = html.slice(start, end);
    expect(block).toContain(`<li>${SAMPLE_FIELD_UNAVAILABLE}</li>`);
    expect(block).not.toMatch(/<strong><\/strong>/);
    expect(block).not.toMatch(/<p><\/p>/);
  });

  it("never renders an empty definition cell in the sample brief", async () => {
    const html = await renderMarketing();
    expect(html).not.toMatch(/<dd>\s*<\/dd>/);
    expect(html).not.toMatch(/<li>\s*<\/li>/);
  });
});
