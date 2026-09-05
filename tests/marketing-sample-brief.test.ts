import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProof } from "~/lib/demo-proof";

const marketingRouteSource = readFileSync("app/routes/marketing.tsx", "utf8");
const FALLBACK_COPY = "Not available in this sample";
const ILLUSTRATIVE_NOTE = "Illustrative sample — sources are capture types, shown without links.";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockReactRouter() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    const Link = ({ children, to, ...props }: MockLinkProps) =>
      React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children);
    const Form = ({ children, ...props }: MockLinkProps) =>
      React.createElement("form", props, children);
    return {
      ...actual,
      Link,
      Form,
      useNavigation: () => ({ state: "idle", formData: null, location: null }),
      useLoaderData: () => ({
        pricingPreview: { available: false },
        commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
      }),
      useRouteLoaderData: () => ({
        session: null,
        pricingPlans: [
          { slug: "scout", name: "Scout", monthlyLabel: "$19/mo", yearlyLabel: "$190/yr", detail: "Weekly brief", features: [] },
          { slug: "starter", name: "Starter", monthlyLabel: "$49/mo", yearlyLabel: "$490/yr", detail: "Daily brief", features: [] },
          { slug: "agency", name: "Agency", monthlyLabel: "$199/mo", yearlyLabel: "$1,990/yr", detail: "Daily brief", features: [] },
        ],
        usageBundles: [],
      }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/demo-proof");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("anonymous homepage sample brief truthfulness", () => {
  it("renders every decision-summary proof field with its fixture-backed value", async () => {
    await mockReactRouter();
    const { default: MarketingRoute } = await import("~/routes/marketing");
    const html = renderToStaticMarkup(createElement(MarketingRoute));

    const fields: ReadonlyArray<readonly [string, string]> = [
      ["What changed", demoProof.digestPreview.whatChanged],
      ["Why it matters", demoProof.digestPreview.whyItMatters],
      ["Urgency", demoProof.digestPreview.priority],
      ["Proof status", demoProof.digestPreview.proofStatus],
      ["Source", demoProof.digestPreview.source],
      ["Freshness", demoProof.digestPreview.freshness],
      ["Next action", demoProof.digestPreview.recommendedMove],
    ];
    for (const [label, value] of fields) {
      expect(html).toContain(`<dt>${label}</dt>`);
      const region = html.slice(
        html.indexOf(`<dt>${label}</dt>`),
        html.indexOf("</article>", html.indexOf(`<dt>${label}</dt>`)),
      );
      expect(region).toContain(value);
    }
    expect(html).not.toContain(FALLBACK_COPY);
  });

  it("renders the source trail with every fixture item and an explicit illustrative label", async () => {
    await mockReactRouter();
    const { default: MarketingRoute } = await import("~/routes/marketing");
    const html = renderToStaticMarkup(createElement(MarketingRoute));

    expect(html).toContain(ILLUSTRATIVE_NOTE);
    const trailStart = html.indexOf('<span class="ld-kicker">Source trail</span>');
    expect(trailStart).toBeGreaterThan(-1);
    const trailRegion = html.slice(trailStart, html.indexOf("</article>", trailStart));

    for (const item of demoProof.proofTrail) {
      expect(trailRegion).toContain(item.signal);
      expect(trailRegion).toContain(item.evidence);
      expect(trailRegion).toContain(item.source);
    }
    // Illustrative sample: no fake URLs or empty list items in the trail.
    expect(trailRegion).not.toContain("href=");
    expect(trailRegion).not.toMatch(/<li>\s*<\/li>/);
  });

  it("shows an explicit unavailable state instead of a blank proof field", async () => {
    await mockReactRouter();
    const mutated = structuredClone(demoProof) as unknown as {
      digestPreview: Record<string, string>;
    };
    mutated.digestPreview.whatChanged = "   ";
    vi.doMock("~/lib/demo-proof", () => ({
      demoProof: mutated as unknown as typeof demoProof,
    }));

    const { default: MarketingRoute, sampleProofField, SAMPLE_FIELD_UNAVAILABLE } =
      await import("~/routes/marketing");
    expect(sampleProofField("")).toBe(FALLBACK_COPY);
    expect(sampleProofField("   ")).toBe(FALLBACK_COPY);
    expect(sampleProofField("real value")).toBe("real value");
    expect(SAMPLE_FIELD_UNAVAILABLE).toBe(FALLBACK_COPY);

    const html = renderToStaticMarkup(createElement(MarketingRoute));
    const region = html.slice(
      html.indexOf("<dt>What changed</dt>"),
      html.indexOf("</article>", html.indexOf("<dt>What changed</dt>")),
    );
    expect(region).toContain(FALLBACK_COPY);
  });

  it("wires every sample proof field through the unavailable-state fallback", () => {
    for (const field of [
      "subject",
      "whatChanged",
      "whyItMatters",
      "priority",
      "proofStatus",
      "source",
      "freshness",
      "recommendedMove",
    ] as const) {
      expect(marketingRouteSource).toContain(`sampleProofField(demoProof.digestPreview.${field})`);
    }
    for (const field of ["signal", "evidence", "source"] as const) {
      expect(marketingRouteSource).toContain(`sampleProofField(item.${field})`);
    }
    expect(marketingRouteSource).toContain(FALLBACK_COPY);
  });

  it("keeps the sample fixture truthful: no empty proof items and no fake URLs", () => {
    for (const item of demoProof.proofTrail) {
      expect(item.signal.trim()).not.toBe("");
      expect(item.evidence.trim()).not.toBe("");
      expect(item.source.trim()).not.toBe("");
    }
    for (const value of [
      demoProof.digestPreview.subject,
      demoProof.digestPreview.whatChanged,
      demoProof.digestPreview.whyItMatters,
      demoProof.digestPreview.priority,
      demoProof.digestPreview.proofStatus,
      demoProof.digestPreview.source,
      demoProof.digestPreview.freshness,
      demoProof.digestPreview.recommendedMove,
    ]) {
      expect(value.trim()).not.toBe("");
    }
    expect(JSON.stringify(demoProof.proofTrail)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(demoProof.digestPreview)).not.toMatch(/https?:\/\//);

    const trailSourceStart = marketingRouteSource.indexOf(
      '<span className="ld-kicker">Source trail</span>',
    );
    const trailSourceRegion = marketingRouteSource.slice(
      trailSourceStart,
      marketingRouteSource.indexOf("</article>", trailSourceStart),
    );
    expect(trailSourceRegion).not.toContain("href=");
  });
});
