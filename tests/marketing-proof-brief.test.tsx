import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const realProofBrief = {
  competitorName: "Nykaa",
  website: "nykaa.com",
  adLibraryCountry: "India",
  fetchedAt: "2026-08-11T22:17:00.000Z",
  checkedAgoLabel: "about 4 hours ago",
  freshForLiveClaim: false,
  adCount: 6,
  activeAdCount: 4,
  summary:
    "6 public Meta ads link to nykaa.com in the India Ad Library. Every source below opens the same page any visitor can open.",
  decision: {
    subject: "4 of 6 cached ads are active on record",
    whatChanged: "The most repeated hook is “Routine-first bundle”, the CTA “Build your routine”.",
    whyItMatters:
      "These creatives are the angle Nykaa has on record in the Meta Ad Library — review the same pages before your next campaign refresh.",
    priority: "Review before the next campaign refresh",
    proofStatus: "Captured from the India Ad Library on Aug 11, 10:17 PM",
    source: "Meta Ad Library (public archive) — the India Ad Library",
    freshness: "Last checked about 4 hours ago — captured Aug 11, 10:17 PM",
    nextAction: "Open the same ad in the India Ad Library",
  },
  proofTrail: [
    {
      id: "ad-1:Ad hook",
      signal: "Ad hook",
      evidence: "Routine-first bundle — Build your routine",
      source: "Meta Ad Library — Nykaa Beauty",
      sourceUrl: "https://www.facebook.com/ads/library/?id=111",
      capturedAt: "2026-08-11T22:17:00.000Z",
    },
    {
      id: "ad-2:Ad offer",
      signal: "Ad offer",
      evidence: "Up to 30% off this week",
      source: "Meta Ad Library — Nykaa Beauty",
      sourceUrl: "https://www.facebook.com/ads/library/?id=222",
      capturedAt: "2026-08-11T22:17:00.000Z",
    },
  ],
  insights: {
    topHooks: ["Routine-first bundle", "Dermat approved", "Sale ending soon"],
    mediaMix: [
      { channel: "Meta Ad Library", count: 4 },
      { channel: "Landing pages", count: 2 },
    ],
    timeline: ["Creative started running Aug 8, 09:00 AM", "Brief generated from 6 real captures"],
  },
  reportRows: [
    "What is captured: 4 of 6 cached creatives are active",
    "Source trail: every row links to the same public India Ad Library page",
    "Next action: review the angle before your next campaign refresh",
  ],
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
        proofBrief,
      }),
    };
  });
}

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

function decisionSummaryRows(markup: string): Array<{ dt: string; dd: string }> {
  const firstDl = markup.match(/<dl>[\s\S]*?<\/dl>/)?.[0] ?? "";
  const divs = firstDl.match(/<div>[\s\S]*?<\/div>/g) ?? [];
  return divs.map((div) => ({
    dt: div.match(/<dt>(.*?)<\/dt>/)?.[1]?.trim() ?? "",
    dd: div.match(/<dd>(.*?)<\/dd>/)?.[1]?.trim() ?? "",
  }));
}

function sourceTrailItems(markup: string): Array<{ strong: string; text: string; em: string }> {
  const trailUl = markup.match(/<ul class="ld-trail">[\s\S]*?<\/ul>/)?.[0] ?? "";
  const items = trailUl.match(/<li>[\s\S]*?<\/li>/g) ?? [];
  return items.map((item) => ({
    strong: item.match(/<strong>(.*?)<\/strong>/)?.[1]?.trim() ?? "",
    text: item
      .replace(/<strong>[\s\S]*?<\/strong>/, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
    em: item.match(/<em>(.*?)<\/em>/)?.[1]?.trim() ?? "",
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("anonymous homepage proof brief (real proof)", () => {
  it("renders a truthful non-empty value for every decision-summary field from real captures", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();
    const rows = decisionSummaryRows(markup);

    expect(rows.map((row) => row.dt)).toEqual([
      "What changed",
      "Why it matters",
      "Urgency",
      "Proof status",
      "Source",
      "Freshness",
      "Next action",
    ]);
    for (const row of rows) {
      expect(row.dd.length, `${row.dt} must not render blank`).toBeGreaterThan(0);
    }
    expect(rows.find((row) => row.dt === "What changed")?.dd).toContain("Routine-first bundle");
    expect(rows.find((row) => row.dt === "Proof status")?.dd).toContain("Captured from the India Ad Library");
    expect(rows.find((row) => row.dt === "Freshness")?.dd).toContain("about 4 hours ago");
  });

  it("never labels the brief or its evidence as sample or illustrative", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    expect(markup).not.toContain("Sample brief");
    expect(markup).not.toContain("Sample proof-backed");
    expect(markup).not.toContain("Sample morning brief");
    expect(markup).not.toContain("sample evidence");
    expect(markup).not.toContain("illustrative");
    expect(markup).not.toContain("no live captures are attached");
    expect(markup).not.toContain("Not available in this sample");
    expect(markup).not.toContain("birchandstone");
  });

  it("links every source-trail row to a real public source page", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    const items = sourceTrailItems(markup);
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.strong.length).toBeGreaterThan(0);
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.em).toContain("open the same page");
    }
    const trailBlock = markup.match(/<ul class="ld-trail">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(trailBlock).toContain('href="https://www.facebook.com/ads/library/?id=111"');
    expect(trailBlock).toContain('href="https://www.facebook.com/ads/library/?id=222"');
  });

  it("states the trail is real and openable by the visitor", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    expect(markup).toContain("Every row above is a real capture.");
    expect(markup).toContain("ld-trail-note");
  });

  it("renders the honest no-live-proof state when no real capture exists", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();

    expect(markup).toContain("No live proof right now");
    expect(markup).toContain("We haven’t captured this competitor recently.");
    expect(markup).toContain("Run the search preview");
    expect(markup).not.toContain("Sample brief");
    expect(markup).not.toContain("illustrative");
    expect(markup).not.toContain("Verified evidence");
  });

  it("makes no fake time claims in the ticker when no proof exists", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();

    expect(markup).toContain("Proof-backed monitoring");
    expect(markup).toContain("No live proof yet");
    expect(markup).not.toMatch(/<b>(?:0\d|1\d|2[0-3]):\d{2}<\/b>/);
  });

  it("renders real capture clocks and the real proof label when proof exists", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    expect(markup).toContain("Proof-backed brief");
    expect(markup).toContain('href="/proof"');
    expect(markup).toContain("What we refuse to alert on");
    expect(markup).toContain("Proof brief");
    expect(markup).toContain("Routine-first bundle");
    // The hero H1 is the restored #188 diff and carries no proof claim, so the
    // real capture clocks now have to show up in the proof-trail card stamps —
    // which is the thing this test is named for.
    expect(markup).toContain("Ad hook · 10:17 PM");
    expect(markup).toContain("Ad offer · 10:17 PM");
  });
});
