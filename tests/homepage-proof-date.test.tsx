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
      timeline: ["Creative started running Sep 4, 2025", "Brief generated from 12 real captures"],
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

function heroFlagText(markup: string): string | null {
  // The H1's date pill is the first <i class="ld-flag"> inside <h1 class="ld-wall">.
  const h1 = markup.match(/<h1[^>]*ld-wall[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
  return h1.match(/<i class="ld-flag">(.*?)<\/i>/)?.[1]?.trim() ?? null;
}

function heroH1(markup: string): string {
  return markup.match(/<h1[^>]*ld-wall[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
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

describe("homepage proof-trail stamps — year-aware capture dates (#1032)", () => {
  // The hero H1 is the restored #188 typographic diff and carries no capture
  // date, so #1032's year-awareness now lives entirely in the proof-trail card
  // stamps — which is where a real capture date is actually rendered.
  it("renders the calendar year for a date-only capture from a prior UTC year", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    expect(proofTrailStampText(markup)).toContain("Sep 4, 2025");
  });

  it("keeps the compact rendering for a date-only capture from the current UTC year", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2026-08-22"));
    const markup = await renderMarketing();

    const stamp = proofTrailStampText(markup);
    expect(stamp).toContain("Aug 22");
    expect(stamp).not.toContain("2026");
  });

  it("never renders a bare year-stripped date for a prior-year capture", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    // A bare "Sep 4" would read as this year's date for a year-old capture.
    expect(markup).not.toMatch(/Sep 4(?!, 2025)/);
  });

  it("leaves the restored hero free of any capture date", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    // The hero's only flag is the illustrated 03:47 AM clock of the #188 diff.
    expect(heroFlagText(markup)).toBe("03:47 AM");
    expect(heroH1(markup)).not.toMatch(/Sep 4/);
  });
});
