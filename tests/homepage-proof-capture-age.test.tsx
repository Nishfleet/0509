import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Pinned "now" so the capture-age math is deterministic regardless of when the
// suite runs. 2026-08-26 matches the issue's live observation date.
const NOW = new Date("2026-08-26T00:19:48.000Z");

function proofBriefWithCapturedAt(
  capturedAt: string,
  freshForLiveClaim = false,
  fetchedAt = "2026-08-26T00:19:48.000Z",
) {
  return {
    competitorName: "Nykaa",
    website: "nykaa.com",
    adLibraryCountry: "India",
    fetchedAt,
    checkedAgoLabel: "about 2 hours ago",
    freshForLiveClaim,
    adCount: 12,
    activeAdCount: 12,
    summary: "12 public Meta ads link to nykaa.com in the India Ad Library.",
    decision: {
      subject: "12 of 12 cached ads are active on record",
      whatChanged: 'The most repeated hook is "Unlock the secret to radiant skin".',
      whyItMatters: "These creatives are the angle Nykaa has on record in the Meta Ad Library.",
      priority: "Review before the next campaign refresh",
      proofStatus: "Captured from the India Ad Library on Aug 26, 12:19 AM",
      source: "Meta Ad Library (public archive) — the India Ad Library",
      freshness: "Last checked about 2 hours ago — captured Aug 26, 12:19 AM",
      nextAction: "Open the same ad in the India Ad Library",
    },
    proofTrail: [
      {
        id: "ad-1:Ad hook",
        signal: "Ad hook",
        evidence: "Unlock the secret to radiant skin — Learn more",
        source: "Meta Ad Library — Nykaa Beauty",
        sourceUrl: "https://www.facebook.com/ads/library/?id=1",
        capturedAt,
      },
    ],
    insights: {
      topHooks: ["Unlock the secret to radiant skin"],
      mediaMix: [{ channel: "Meta Ad Library", count: 12 }],
      timeline: ["Creative started running Aug 26", "Brief generated from 12 real captures"],
    },
    reportRows: [
      "What is captured: 12 of 12 cached creatives are active",
      "Source trail: every row links to the same India Ad Library page",
      "Next action: review the angle before your next campaign refresh",
    ],
  };
}

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
        proofBrief,
      }),
    };
  });
}

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

function heroH1(markup: string): string {
  return markup.match(/<h1[^>]*ld-wall[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
}

function heroFlagText(markup: string): string | null {
  const h1 = heroH1(markup);
  return h1.match(/<i class="ld-flag">(.*?)<\/i>/)?.[1]?.trim() ?? null;
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

describe("homepage hero proof wall — capture-age gate (#1076)", () => {
  it("keeps the dated hook line for a long-running ad while our own check is fresh", async () => {
    // The ad has been delivering since 2025-09-04 — 356 days by render time —
    // but our Ad Library check ran hours ago. A long-running competitor ad is
    // the strongest proof the homepage has, not the weakest, so the hero keeps
    // the dated "was the hook on ... <date>" line. Gating this on the ad's own
    // delivery date demoted essentially every real ad on the page.
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(h1).toContain("was the hook on 12 Meta ads");
    expect(h1).not.toContain("is a hook on record across");
    // #1032: a prior-year capture carries its year so it cannot read as recent.
    expect(heroFlagText(markup)).toBe("Sep 4, 2025");
    expect(h1).toContain("Unlock the secret to radiant");
  });

  it("drops the date and swaps to 'on record' copy once our own check goes stale", async () => {
    // Cache fetched 2026-05-18, rendered 2026-08-26: 100 days since we last
    // checked. We cannot date a hook off a cache we stopped refreshing, so the
    // hero drops the pill and reframes.
    mockReactRouter(
      proofBriefWithCapturedAt("2026-05-10", false, "2026-05-18T00:19:48.000Z"),
    );
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(h1).toContain("is a hook on record across 12 Meta ads");
    expect(heroFlagText(markup)).toBeNull();
    expect(h1).not.toMatch(/May 10/);
    // The hook quote is still real proof; only the date and framing are dropped.
    expect(h1).toContain("Unlock the secret to radiant");
  });

  it("keeps the dated copy at the edge of the freshness window", async () => {
    // Checked 4 days ago — well inside the 30-day window.
    mockReactRouter(
      proofBriefWithCapturedAt("2026-08-22", false, "2026-08-22T00:19:48.000Z"),
    );
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(h1).toContain("was the hook on 12 Meta ads");
    expect(heroFlagText(markup)).toBe("Aug 22");
  });

  it("uses present tense only while the check is fresh enough for a live claim", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04", true));
    const markup = await renderMarketing();

    expect(heroH1(markup)).toContain("is the hook on 12 Meta ads");
  });

  it("does not contradict the 'checked about 2 hours ago' freshness stamp", async () => {
    // The stamp speaks to when we checked; the hero pill speaks to when the ad
    // was captured. Past tense holds them together without contradiction: we
    // checked hours ago, and that hook was running on 12 ads as of Sep 4, 2025.
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    expect(markup).toContain("last checked about 2 hours ago");
    expect(heroH1(markup)).toContain("was the hook on 12 Meta ads");
  });
});
