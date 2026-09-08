import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Pinned "now" so the freshness math is deterministic regardless of when the
// suite runs. 2026-08-30T06:00:00Z matches the issue's live observation date.
const NOW = new Date("2026-08-30T06:00:00.000Z");

function proofBrief({
  freshForLiveClaim,
  checkedAgoLabel,
  capturedAt,
}: {
  freshForLiveClaim: boolean;
  checkedAgoLabel: string;
  capturedAt: string;
}) {
  return {
    competitorName: "Nykaa",
    website: "nykaa.com",
    adLibraryCountry: "India",
    fetchedAt: freshForLiveClaim ? "2026-08-30T05:59:58.000Z" : "2026-08-29T07:00:00.000Z",
    checkedAgoLabel,
    freshForLiveClaim,
    adCount: 12,
    activeAdCount: 12,
    summary: "12 public Meta ads link to nykaa.com in the India Ad Library.",
    decision: {
      subject: "12 of 12 cached ads are active right now",
      whatChanged: 'The most repeated hook is "Unlock the secret to radiant skin".',
      whyItMatters: "These creatives are the angle Nykaa is testing in the Meta Ad Library.",
      priority: "Review before the next campaign refresh",
      proofStatus: "Captured from the India Ad Library on Aug 30, 10:17 PM",
      source: "Meta Ad Library (public archive) — the India Ad Library",
      freshness: "Checked moments ago — captured Aug 30, 10:17 PM",
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
      timeline: ["Creative started running Aug 30", "Brief generated from 12 real captures"],
    },
    reportRows: [
      "What is captured: 12 of 12 cached creatives are active",
      "Source trail: every row links to the same public India Ad Library page",
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

function proofStrip(markup: string): string {
  return markup.match(/<aside class="ld-proof-strip"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? "";
}

function stripAriaLabel(strip: string): string | null {
  return strip.match(/aria-label="([^"]*)"/)?.[1] ?? null;
}

function stripLiveBadge(strip: string): string | null {
  const badge = strip.match(/<span class="ld-proof-live">([\s\S]*?)<\/span>/)?.[1] ?? "";
  return badge.replace(/<[^>]+>/g, "").trim() || null;
}

function stripTimeText(markup: string): string | null {
  const strip = proofStrip(markup);
  return strip.match(/<span class="ld-proof-time">([\s\S]*?)<\/span>/)?.[1]?.trim() ?? null;
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

describe("homepage proof strip aria-label tracks freshForLiveClaim (#1465)", () => {
  it("renders 'Live proof brief', a 'Live' badge, and the checked-ago stamp when the proof is live", async () => {
    mockReactRouter(
      proofBrief({
        freshForLiveClaim: true,
        checkedAgoLabel: "moments ago",
        capturedAt: "2026-08-30T05:59:58.000Z",
      }),
    );
    const markup = await renderMarketing();
    const strip = proofStrip(markup);

    expect(stripAriaLabel(strip)).toBe("Live proof brief");
    expect(stripLiveBadge(strip)).toBe("Live");
    expect(stripTimeText(markup)).toContain("moments ago");
    expect(strip).toContain("is the hook on 12 Meta ads");
  });

  it("renders 'Cached proof brief — checked <checkedAgo>', an 'On record' badge, and the checked-ago stamp when the proof is stale", async () => {
    mockReactRouter(
      proofBrief({
        freshForLiveClaim: false,
        checkedAgoLabel: "about 23 hours ago",
        capturedAt: "2025-09-04",
      }),
    );
    const markup = await renderMarketing();
    const strip = proofStrip(markup);

    expect(stripAriaLabel(strip)).toBe("Cached proof brief — checked about 23 hours ago");
    expect(stripLiveBadge(strip)).toBe("On record");
    expect(stripTimeText(markup)).toContain("about 23 hours ago");
    expect(strip).toContain("is a hook on record across 12 Meta ads");
  });
});
