import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Pinned "now" so the capture-age math is deterministic regardless of when the
// suite runs. 2026-08-26 matches the issue's live observation date.
const NOW = new Date("2026-08-26T00:19:48.000Z");

// The loader values these tests render. Assertions read them from here instead
// of re-typing rendered copy, so a copy change cannot break the test.
const CHECKED_AGO_2H = "about 2 hours ago";
const TOP_HOOK = "Unlock the secret to radiant skin";
const WEBSITE = "nykaa.com";
const AD_COUNT = 12;

// Any calendar date as the strip renders one (“May 18” / “Sep 4, 2025”).
const STRIP_DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:, \d{4})?\b/;

function proofBriefWithCapturedAt(capturedAt: string, freshForLiveClaim = false) {
  return {
    competitorName: "Nykaa",
    website: WEBSITE,
    adLibraryCountry: "India",
    fetchedAt: "2026-08-26T00:19:48.000Z",
    checkedAgoLabel: CHECKED_AGO_2H,
    freshForLiveClaim,
    adCount: AD_COUNT,
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
      topHooks: [TOP_HOOK],
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
  it("hides the capture date and swaps to non-date-bearing 'on record' copy when the top capture is 100 days old", async () => {
    // 2026-05-18 captured, rendered on 2026-08-26: 100 days old, past the
    // 30-day freshness window. The proof strip must not surface the old date
    // next to the "checked about 2 hours ago" freshness stamp. The H1 is the
    // free live-search promise wall (#2170).
    mockReactRouter(proofBriefWithCapturedAt("2026-05-18"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    const strip = proofStrip(markup);
    expect(heroWallRows(h1)).toHaveLength(4);
    // The wall never carries the strip's proof attribution or the hook itself.
    expect(h1).not.toContain("ld-proof-attrib");
    expect(h1).not.toContain(TOP_HOOK);
    // Stale capture: the strip drops every calendar date and stays “on record”.
    expect(strip).toContain('data-proof-state="on-record"');
    expect(strip).not.toMatch(STRIP_DATE);
    expect(stripTimeText(markup)).toContain(CHECKED_AGO_2H);
    // The hook quote itself is still shown in the strip — it is real proof.
    expect(spanBody(strip, "ld-proof-quote")).toContain(TOP_HOOK);
    expect(spanBody(strip, "ld-proof-attrib")).toContain(WEBSITE);
    expect(spanBody(strip, "ld-proof-attrib")).toContain(String(AD_COUNT));
  });

  it("does not surface a year-old capture date in the hero (the live #1076 case)", async () => {
    // 2025-09-04 captured, rendered on 2026-08-26: 356 days old — the exact
    // case the issue observed live. The hero must not show "Sep 4, 2025".
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).not.toMatch(STRIP_DATE);
    const strip = proofStrip(markup);
    expect(strip).toContain('data-proof-state="on-record"');
    expect(strip).not.toMatch(STRIP_DATE);
  });

  it("keeps the date-bearing proof-strip copy when the top capture is inside the 30-day window", async () => {
    // 2026-08-22 captured, rendered on 2026-08-26: 4 days old, inside the
    // 30-day window. The strip keeps the "was the hook on ... <date>" copy.
    mockReactRouter(proofBriefWithCapturedAt("2026-08-22"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).not.toContain("ld-proof-attrib");
    // Inside the freshness window the strip keeps its date-bearing stamp.
    const strip = proofStrip(markup);
    expect(stripTimeText(markup)).toMatch(STRIP_DATE);
    expect(spanBody(strip, "ld-proof-quote")).toContain(TOP_HOOK);
  });

  it("swaps the proof strip even when freshForLiveClaim is true but the capture is stale", async () => {
    // The cache was fetched moments ago (freshForLiveClaim true) but the ad
    // capture itself is 100 days old. This is the contradiction the issue
    // names: "checked 2 hours ago" beside a year-old date. The strip must still
    // drop the date.
    mockReactRouter(proofBriefWithCapturedAt("2026-05-18", true));
    const markup = await renderMarketing();

    expect(heroWallRows(heroH1(markup))).toHaveLength(4);
    const strip = proofStrip(markup);
    expect(strip).toContain('data-proof-state="on-record"');
    expect(strip).not.toMatch(STRIP_DATE);
  });

  it("does not contradict the 'checked about 2 hours ago' freshness stamp in the brief strip", async () => {
    // The freshness stamp elsewhere on the page speaks to the cache fetch
    // time; the proof strip must not surface a stale capture date that reads
    // as a contradiction.
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    expect(markup).toContain(CHECKED_AGO_2H);
    const h1 = heroH1(markup);
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).not.toMatch(STRIP_DATE);
    expect(proofStrip(markup)).not.toMatch(STRIP_DATE);
  });
});
