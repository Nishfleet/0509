import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Pinned "now" so the capture-age math is deterministic regardless of when the
// suite runs. 2026-08-26 matches the issue's live observation date.
const NOW = new Date("2026-08-26T00:19:48.000Z");

function proofBriefWithCapturedAt(capturedAt: string, freshForLiveClaim = false) {
  return {
    competitorName: "Nykaa",
    website: "nykaa.com",
    adLibraryCountry: "India",
    fetchedAt: "2026-08-26T00:19:48.000Z",
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

function proofStrip(markup: string): string {
  return markup.match(/<aside class="ld-proof-strip"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? "";
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
    // chosen Safe buyer-job wall (#1173).
    mockReactRouter(proofBriefWithCapturedAt("2026-05-18"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    const strip = proofStrip(markup);
    expect(h1).toContain("Growth teams");
    expect(h1).not.toContain("is a hook on record across 12 Meta ads");
    expect(strip).toContain("is a hook on record across 12 Meta ads");
    expect(stripTimeText(markup)).toContain("On record");
    expect(h1).not.toMatch(/May 18/);
    expect(strip).not.toMatch(/May 18/);
    // The hook quote itself is still shown in the strip — it is real proof.
    expect(strip).toContain("Unlock the secret to radiant");
    expect(h1).not.toContain("Unlock the secret to radiant");
  });

  it("does not surface a year-old capture date in the hero (the live #1076 case)", async () => {
    // 2025-09-04 captured, rendered on 2026-08-26: 356 days old — the exact
    // case the issue observed live. The hero must not show "Sep 4, 2025".
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(h1).not.toMatch(/Sep 4/);
    expect(h1).toContain("Growth teams");
    expect(proofStrip(markup)).toContain("is a hook on record across 12 Meta ads");
    expect(proofStrip(markup)).not.toMatch(/Sep 4/);
  });

  it("keeps the date-bearing proof-strip copy when the top capture is inside the 30-day window", async () => {
    // 2026-08-22 captured, rendered on 2026-08-26: 4 days old, inside the
    // 30-day window. The strip keeps the "was the hook on ... <date>" copy.
    mockReactRouter(proofBriefWithCapturedAt("2026-08-22"));
    const markup = await renderMarketing();

    const h1 = heroH1(markup);
    expect(h1).toContain("Growth teams");
    expect(h1).not.toContain("was the hook on 12 Meta ads");
    expect(proofStrip(markup)).toContain("was the hook on 12 Meta ads");
    expect(stripTimeText(markup)).toContain("Aug 22");
  });

  it("swaps the proof strip even when freshForLiveClaim is true but the capture is stale", async () => {
    // The cache was fetched moments ago (freshForLiveClaim true) but the ad
    // capture itself is 100 days old. This is the contradiction the issue
    // names: "checked 2 hours ago" beside a year-old date. The strip must still
    // drop the date.
    mockReactRouter(proofBriefWithCapturedAt("2026-05-18", true));
    const markup = await renderMarketing();

    expect(heroH1(markup)).toContain("Growth teams");
    expect(proofStrip(markup)).toContain("is a hook on record across 12 Meta ads");
    expect(stripTimeText(markup)).toContain("On record");
  });

  it("does not contradict the 'checked about 2 hours ago' freshness stamp in the brief strip", async () => {
    // The freshness stamp elsewhere on the page speaks to the cache fetch
    // time; the proof strip must not surface a stale capture date that reads
    // as a contradiction.
    mockReactRouter(proofBriefWithCapturedAt("2025-09-04"));
    const markup = await renderMarketing();

    expect(markup).toContain("last checked about 2 hours ago");
    const h1 = heroH1(markup);
    expect(h1).not.toMatch(/Sep 4/);
    expect(h1).toContain("Growth teams");
    expect(proofStrip(markup)).not.toMatch(/Sep 4/);
  });
});
