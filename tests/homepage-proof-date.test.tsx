import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Pinned "now" so the year comparison is deterministic regardless of when the
// suite runs. 2026-08-25 matches the issue's live observation date.
const NOW = new Date("2026-08-25T12:00:00.000Z");

function proofBriefWithCapturedAt(capturedAt: string) {
  return {
    competitorName: "Nykaa",
    website: "nykaa.com",
    adLibraryCountry: "India",
    fetchedAt: "2026-08-25T10:46:00.000Z",
    checkedAgoLabel: "moments ago",
    freshForLiveClaim: false,
    adCount: 12,
    activeAdCount: 12,
    summary: "12 public Meta ads link to nykaa.com in the India Ad Library.",
    decision: {
      subject: "12 of 12 cached ads are active right now",
      whatChanged: 'The most repeated hook is "Unlock the secret to radiant skin".',
      whyItMatters: "These creatives are the angle Nykaa is testing in the Meta Ad Library.",
      priority: "Review before the next campaign refresh",
      proofStatus: "Captured from the India Ad Library on Aug 25, 10:46 AM",
      source: "Meta Ad Library (public archive) — the India Ad Library",
      freshness: "Checked moments ago — captured Aug 25, 10:46 AM",
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
      mediaMix: [
        { channel: "Meta Ad Library", count: 12 },
      ],
      timeline: ["Creative on record since Sep 4, 2025", "Brief generated from 12 real captures"],
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

function heroH1(markup: string): string {
  return markup.match(/<h1[^>]*ld-wall[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
}

function proofStrip(markup: string): string {
  return markup.match(/<aside class="ld-proof-strip"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? "";
}

function stripTimeText(markup: string): string | null {
  const strip = proofStrip(markup);
  return strip.match(/<span class="ld-proof-time">([\s\S]*?)<\/span>/)?.[1]?.trim() ?? null;
}

/** The proof-trail card stamp carries the capture date (e.g. "Ad hook · Sep 4,
 *  2025") and is where the #1032 year-formatting logic now shows for a stale
 *  capture — the hero no longer surfaces a >30-day date. */
function proofTrailStampText(markup: string): string | null {
  const stamp = markup.match(/<span class="ld-stamp ld-stamp-green">([\s\S]*?)<\/span>/)?.[1] ?? "";
  return stamp.trim() || null;
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

describe("homepage hero proof wall — year-aware capture dates (#1032)", () => {
  it("renders the calendar year for a date-only capture from a prior UTC year in the proof-trail stamp, and swaps the hero to non-date-bearing copy (#1076)", async () => {
    // 2025-09-04 captured, rendered on 2026-08-25: 355 days old, past the
    // 30-day freshness window, so the hero no longer surfaces the date (it
    // would read as a contradiction next to the "checked N hours ago" stamp).
    // The #1032 year-formatting logic still runs and carries the year in the
    // proof-trail card stamp so "Sep 4" cannot read as a same-year date.
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    // Proof strip swaps to "on record" copy and drops the capture date.
    // The H1 is the chosen Safe buyer-job wall and never carries a date (#1173).
    expect(heroH1(markup)).toContain("Growth teams");
    expect(heroH1(markup)).not.toContain("is a hook on record across 12 Meta ads");
    expect(heroH1(markup)).not.toContain("Sep 4");
    expect(proofStrip(markup)).toContain("is a hook on record across 12 Meta ads");
    expect(proofStrip(markup)).not.toContain("Sep 4");
    expect(stripTimeText(markup)).toContain("On record");

    // #1286/#1343: the proof-trail card stamp no longer surfaces the stale
    // first-seen date next to the header's "Captured {today}" — it swaps to
    // non-date-bearing "On record" copy so the only capture clock on the page
    // is the honest, header-level one.
    const stamp = proofTrailStampText(markup);
    expect(stamp).toContain("On record");
    expect(stamp).not.toContain("Sep 4");
  });

  it("keeps the compact rendering for a date-only capture from the current UTC year", async () => {
    // 2026-08-22 captured, rendered on 2026-08-25: 3 days old, inside the
    // 30-day freshness window, so the hero keeps the date-bearing copy and no
    // year is appended (same UTC year).
    mockReactRouter(proofBriefWithCapturedAt("2026-08-22"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(h1).toContain("Growth teams");
    expect(h1).not.toContain("Aug 22");
    const time = stripTimeText(markup);
    expect(time).toContain("Aug 22");
    expect(time).not.toContain("2026");
    expect(proofStrip(markup)).toContain("was the hook on 12 Meta ads");
  });

  it("does not surface any capture date in the hero for a year-old capture (#1076)", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    // The H1 is the buyer-job wall, so "Sep 4" cannot appear in any form.
    expect(h1).not.toMatch(/Sep 4/);
    expect(h1).toContain("Growth teams");
    expect(proofStrip(markup)).not.toMatch(/Sep 4/);
  });
});
