import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Pinned "now" matching the issue's live observation (2026-08-30T06:00Z).
// The cache was fetched 2026-08-29T06:18Z — 23h42m earlier — and the old
// home page rendered that as a bare "6:18 AM" that read as "this morning".
const NOW = new Date("2026-08-30T06:00:00.000Z");
const FETCHED_23H = "2026-08-29T06:18:33.549Z";
const CHECKED_AGO_23H = "about 23 hours ago";

function proofBriefWithCapturedAt(
  capturedAt: string,
  overrides: { checkedAgoLabel?: string; freshForLiveClaim?: boolean } = {},
) {
  return {
    competitorName: "Nykaa",
    website: "nykaa.com",
    adLibraryCountry: "India",
    fetchedAt: FETCHED_23H,
    checkedAgoLabel: overrides.checkedAgoLabel ?? CHECKED_AGO_23H,
    freshForLiveClaim: overrides.freshForLiveClaim ?? false,
    adCount: 12,
    activeAdCount: 12,
    summary: "12 public Meta ads link to nykaa.com in the India Ad Library.",
    decision: {
      subject: "12 of 12 cached ads are active on record",
      whatChanged: 'The most repeated hook is "Unlock the secret to radiant skin".',
      whyItMatters: "These creatives are the angle Nykaa has on record in the Meta Ad Library.",
      priority: "Review before the next campaign refresh",
      proofStatus: "Captured from the India Ad Library on Aug 29, 6:18 AM",
      source: "Meta Ad Library (public archive) — the India Ad Library",
      freshness: "Last checked about 23 hours ago — captured Aug 29, 6:18 AM",
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
      timeline: ["Creative on record since Jun 1, 2026", "Brief generated from 12 real captures"],
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

/** The inner HTML of the home ticker belt (both cycles, spans only). */
function tickerBelt(markup: string): string {
  const match = markup.match(
    /<div class="ld-ticker" aria-hidden="true">[\s\S]*?<div class="ld-ticker-belt">([\s\S]*?)<\/div>\s*<\/div>/,
  );
  return match?.[1] ?? "";
}

/** All bold stamp texts inside the ticker belt. */
function tickerStamps(belt: string): string[] {
  return Array.from(belt.matchAll(/<b>([^<]*)<\/b>/g)).map((m) => m[1]);
}

function tickerHtml(markup: string): string {
  return markup.match(/<div class="ld-ticker" aria-hidden="true">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
}

function proofStrip(markup: string): string {
  return markup.match(/<aside class="ld-proof-strip"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? "";
}

function stripTimeText(markup: string): string | null {
  const strip = proofStrip(markup);
  return strip.match(/<span class="ld-proof-time">([\s\S]*?)<\/span>/)?.[1]?.trim() ?? null;
}

const BARE_CLOCK = /^\d{1,2}:\d{2}\s*(?:AM|PM)$/;

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

describe("homepage timestamps — never a bare clock without a date (#1467)", () => {
  it("swaps the on-record ticker stamp to the check age for a 23h-old fetch", async () => {
    // The issue's live shape: the first trail row's first-seen is >30 days
    // old, so the ticker stamps the fetch clock — previously a bare "6:18 AM".
    mockReactRouter(proofBriefWithCapturedAt("2026-06-01T00:00:00.000Z"));
    const markup = await renderMarketing();

    const belt = tickerBelt(markup);
    const stamps = tickerStamps(belt);
    expect(stamps).toHaveLength(6); // 3 items × 2 marquee cycles
    // No bare "H:MM AM/PM" with no date in any ticker stamp.
    expect(stamps.some((s) => BARE_CLOCK.test(s))).toBe(false);
    // On-record rows carry the check age instead of a clock.
    expect(stamps[0]).toBe("Checked about 23 hours ago");

    const strip = stripTimeText(markup);
    expect(strip).toContain("On record");
    expect(strip).toContain("about 23 hours ago");
  });

  it("renders an explicit date stamp, not a bare time, for a full-ISO capture inside the fresh window", async () => {
    // A 3-day-old full-ISO capture: previously the ticker showed a bare
    // "9:00 AM". The stamp must carry the date.
    mockReactRouter(proofBriefWithCapturedAt("2026-08-27T09:00:00.000Z"));
    const markup = await renderMarketing();

    const belt = tickerBelt(markup);
    const stamps = tickerStamps(belt);
    expect(stamps.some((s) => BARE_CLOCK.test(s))).toBe(false);
    expect(stamps[0]).toBe("Aug 27, 9:00 AM");

    // The proof strip carries both the check age and the capture date.
    const strip = stripTimeText(markup);
    expect(strip).toContain("about 23 hours ago");
    expect(strip).toContain("Aug 27, 9:00 AM");
  });

  it("renders the live-capture freshness when freshForLiveClaim is true", async () => {
    mockReactRouter(
      proofBriefWithCapturedAt("2026-08-30T05:58:00.000Z", {
        checkedAgoLabel: "moments ago",
        freshForLiveClaim: true,
      }),
    );
    const markup = await renderMarketing();

    const belt = tickerBelt(markup);
    expect(tickerStamps(belt).some((s) => BARE_CLOCK.test(s))).toBe(false);
    expect(stripTimeText(markup)).toContain("moments ago");
  });

  it("keeps the ticker decorative shape: aria-hidden, three items per cycle, same tags", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2026-06-01T00:00:00.000Z"));
    const markup = await renderMarketing();

    const ticker = tickerHtml(markup);
    expect(ticker).toContain('class="ld-ticker"');
    expect(ticker).toContain('aria-hidden="true"');
    const perCycle = ticker.match(/ld-ticker-run/g) ?? [];
    expect(perCycle).toHaveLength(2); // two marquee cycles
    const items = ticker.match(/ld-ticker-item/g) ?? [];
    expect(items).toHaveLength(6); // three items per cycle × two cycles
    expect(ticker).toContain("[source links]");
    expect(ticker).toContain("[brief]");
    expect(ticker).toContain("[ad library]");
  });
});