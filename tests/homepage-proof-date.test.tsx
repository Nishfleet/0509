import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Pinned "now" so the year comparison is deterministic regardless of when the
// suite runs. 2026-08-25 matches the issue's live observation date.
const NOW = new Date("2026-08-25T12:00:00.000Z");

// The loader values these tests render. Assertions read them from here instead
// of re-typing rendered copy, so a copy change cannot break the test.
const TOP_HOOK = "Unlock the secret to radiant skin";
const WEBSITE = "nykaa.com";

// Any calendar date as the strip renders one (“Sep 4” / “Sep 4, 2025”).
const STRIP_DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:, \d{4})?\b/;

function proofBriefWithCapturedAt(capturedAt: string) {
  return {
    competitorName: "Nykaa",
    website: WEBSITE,
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
      topHooks: [TOP_HOOK],
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

/** The `<span class="ld-row">` lines of the hero wall, in document order. */
function heroWallRows(h1: string): string[] {
  return Array.from(h1.matchAll(/<span class="ld-row[^"]*">/g)).map((match) => match[0]);
}

/** The inner HTML of a `class`-tagged span inside a rendered block. */
function spanBody(block: string, className: string): string {
  return block.match(new RegExp(`<span class="${className}">([\\s\\S]*?)</span>`))?.[1] ?? "";
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

    // Proof strip swaps to the date-free state and drops the capture date.
    // `data-proof-state` is always `on-record` in this file (the fixture pins
    // freshForLiveClaim false), so it is left to the files that vary it; the
    // gate that matters here is the absent calendar date. The H1 is the free
    // live-search promise wall (#2170) and never carries a date or the strip's
    // proof attribution.
    const h1 = heroH1(markup);
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).not.toContain("ld-proof-attrib");
    expect(h1).not.toMatch(STRIP_DATE);
    const strip = proofStrip(markup);
    expect(strip).not.toMatch(STRIP_DATE);
    expect(stripTimeText(markup)).not.toMatch(STRIP_DATE);

    // #1286/#1343: the proof-trail card stamp no longer surfaces the stale
    // first-seen date next to the header's "Captured {today}" — it stays
    // date-free so the only capture clock on the page is the honest,
    // header-level one.
    const stamp = proofTrailStampText(markup);
    expect(stamp).not.toBeNull();
    expect(stamp).not.toMatch(STRIP_DATE);
  });

  it("keeps the compact rendering for a date-only capture from the current UTC year", async () => {
    // 2026-08-22 captured, rendered on 2026-08-25: 3 days old, inside the
    // 30-day freshness window, so the hero keeps the date-bearing copy and no
    // year is appended (same UTC year).
    mockReactRouter(proofBriefWithCapturedAt("2026-08-22"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).not.toMatch(STRIP_DATE);
    // Inside the window the strip keeps its date-bearing stamp, and a
    // same-year date stays compact (no year appended).
    const time = stripTimeText(markup);
    expect(time).toMatch(STRIP_DATE);
    expect(time).not.toMatch(/\b\d{4}\b/);
    const strip = proofStrip(markup);
    expect(spanBody(strip, "ld-proof-quote")).toContain(TOP_HOOK);
    expect(spanBody(strip, "ld-proof-attrib")).toContain(WEBSITE);
  });

  it("does not surface any capture date in the hero for a year-old capture (#1076)", async () => {
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    // The H1 is the live-search promise wall, so no capture date can appear.
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).not.toMatch(STRIP_DATE);
    const strip = proofStrip(markup);
    expect(strip).not.toMatch(STRIP_DATE);
  });
});
