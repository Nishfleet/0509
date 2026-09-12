import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Issue #3125: the live-proof module on the logged-out homepage must render
// the stored capture set the loader supplies (dated, source-linked) instead
// of defaulting to the "No live proof yet" empty state. The empty state
// remains the genuine fallback when no stored proof exists at all.
//
// Capture clocks are pinned relative to `now` so the "captured <date>"
// labels never rot and the evidence stays honest (never fake recency /
// "checked moments ago" copy that ages into a lie).

const NOW = new Date("2026-09-12T12:00:00.000Z");
const CAPTURED_RECENTLY_ISO = new Date(NOW.getTime() - 4 * 3_600_000).toISOString();

const storedNikeBrief = {
  competitorName: "Nike",
  website: "nike.com",
  adLibraryCountry: null,
  fetchedAt: CAPTURED_RECENTLY_ISO,
  checkedAgoLabel: "about 4 hours ago",
  freshForLiveClaim: false,
  adCount: 13,
  activeAdCount: 13,
  summary:
    "13 public Meta ads link to nike.com in the Meta Ad Library. Every source below opens the same page any visitor can open.",
  decision: {
    subject: "13 of 13 cached ads are active on record",
    whatChanged: "The offer “10% off sitewide” was the most repeated hook.",
    whyItMatters:
      "These creatives are the angle Nike has on record in the Meta Ad Library.",
    priority: "Review before the next campaign refresh",
    proofStatus: "Captured from the Meta Ad Library",
    source: "Meta Ad Library (public archive)",
    freshness: "Last checked about 4 hours ago",
    nextAction: "Open the same ad in the Meta Ad Library",
  },
  proofTrail: [
    {
      id: "ad-1:Ad offer",
      signal: "Ad offer",
      evidence: "10% off sitewide",
      source: "Meta Ad Library — Nike",
      sourceUrl: "https://www.facebook.com/ads/library/?id=777",
      capturedAt: CAPTURED_RECENTLY_ISO,
      creativeImageUrl: null,
      creativeId: null,
    },
  ],
  insights: {
    topHooks: ["10% off sitewide"],
    mediaMix: [{ channel: "Meta Ad Library", count: 13 }],
    timeline: ["Creative started running Sep 8, 09:00 AM"],
  },
  reportRows: ["What is captured: 13 of 13 cached creatives are active"],
};

function mockReactRouter(proofBrief: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRouteLoaderData: vi.fn().mockReturnValue({
        pricingPlans: [],
        usageBundles: [],
        session: null,
      }),
      useLoaderData: vi.fn().mockReturnValue({
        pricingPreview: { available: false },
        commercialLaunch: {
          scoutSaleOpen: true,
          starterSaleOpen: true,
          agencySaleOpen: false,
        },
        changeMark: null,
        indexableAdsLinks: [],
        featuredDomain: "nike.com",
        monitoringCoverageDays: null,
        pricingPreview: { available: false },
        proofBrief,
      }),
    };
  });
}

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("homepage live-proof module renders stored proof (issue #3125)", () => {
  it("renders the stored capture set — dated, source-linked — instead of the empty state", async () => {
    mockReactRouter(structuredClone(storedNikeBrief));
    const markup = await renderMarketing();

    // Real proof replaces the empty state on all proof modules.
    expect(markup).not.toContain("No live proof yet");
    expect(markup).not.toContain("We haven’t captured this competitor recently.");
    // Dated, honest capture stamps (the snapshot's own clock, no fake recency).
    expect(markup).toContain("We saved the proof — nike.com");
    expect(markup).toMatch(/\bCaptured \w+ \d{1,2}\b/);
    // Source-linked: every trail row keeps its real public source link.
    expect(markup).toContain("https://www.facebook.com/ads/library/?id=777");
  });

  it("keeps the empty state as the genuine fallback when no stored proof exists", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();

    expect(markup).toContain("No live proof yet");
    expect(markup).not.toContain("We saved the proof");
  });
});
