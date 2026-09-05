import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const NOW = new Date("2026-08-26T00:19:48.000Z");

const proofBrief = {
  competitorName: "Nykaa",
  website: "nykaa.com",
  adLibraryCountry: "India",
  fetchedAt: "2026-08-22T10:46:00.000Z",
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
    proofStatus: "Captured from the India Ad Library on Aug 22, 10:46 AM",
    source: "Meta Ad Library (public archive) — the India Ad Library",
    freshness: "Checked moments ago — captured Aug 22, 10:46 AM",
    nextAction: "Open the same ad in the India Ad Library",
  },
  proofTrail: [
    {
      id: "ad-1:Ad hook",
      signal: "Ad hook",
      evidence: "Unlock the secret to radiant skin — Learn more",
      source: "Meta Ad Library — Nykaa Beauty",
      sourceUrl: "https://www.facebook.com/ads/library/?id=1",
      capturedAt: "2026-08-22",
    },
  ],
  insights: {
    topHooks: ["Unlock the secret to radiant skin"],
    mediaMix: [{ channel: "Meta Ad Library", count: 12 }],
    timeline: ["Creative started running Aug 22", "Brief generated from 12 real captures"],
  },
  reportRows: [
    "What is captured: 12 of 12 cached creatives are active",
    "Source trail: every row links to the same public India Ad Library page",
    "Next action: review the angle before your next campaign refresh",
  ],
};

function mockReactRouter(brief: unknown) {
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
        proofBrief: brief,
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

describe("BET 9 chosen hero direction (#1173)", () => {
  it("records Safe as the chosen direction", () => {
    const chosen = readFileSync("docs/design/hero-directions/CHOSEN.md", "utf8");
    expect(chosen).toMatch(/\*\*Safe\*\*/);
    expect(chosen).toContain("01-safe.html");
    expect(chosen).toContain("#1173");
  });

  it("keeps a buyer-naming H1 even when live Nykaa proof is present", async () => {
    mockReactRouter(proofBrief);
    const markup = await renderMarketing();
    const h1 = heroH1(markup);

    expect(h1).toContain("Growth teams");
    expect(h1).toContain("who track competitors");
    expect(h1).toContain("the call");
    expect(h1).toMatch(/<i class="ld-flag">proof<\/i>/);
    expect(h1).not.toContain("Unlock the secret to radiant");
    expect(h1).not.toContain("nykaa.com");
    expect(h1).not.toContain("Meta ads");
  });

  it("uses the same buyer-naming H1 when there is no live proof", async () => {
    mockReactRouter(proofBrief);
    const withProof = await renderMarketing();

    vi.resetModules();
    mockReactRouter(null);
    const empty = await renderMarketing();

    expect(heroH1(empty)).toBe(heroH1(withProof));
  });

  it("demotes live proof to a strip under the H1", async () => {
    mockReactRouter(proofBrief);
    const markup = await renderMarketing();
    const h1 = heroH1(markup);
    const strip = proofStrip(markup);

    expect(strip.length).toBeGreaterThan(0);
    expect(strip).toContain("On record");
    expect(strip).toContain("We saved the proof");
    expect(strip).toContain("nykaa.com");
    expect(strip).toContain("Unlock the secret to radiant");
    expect(strip).toContain("was the hook on");
    expect(strip).toContain("12 Meta ads");

    const h1Index = markup.indexOf(h1);
    const stripIndex = markup.indexOf(strip);
    expect(h1Index).toBeGreaterThan(-1);
    expect(stripIndex).toBeGreaterThan(h1Index);
  });

  it("renders an honest empty proof strip when no capture exists", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();
    const strip = proofStrip(markup);

    expect(heroH1(markup)).toContain("Growth teams");
    expect(strip).toContain("No live proof yet");
    expect(strip).not.toContain("Unlock the secret");
    expect(strip).not.toContain("illustrative");
    expect(strip).not.toContain("Sample");
  });
});
