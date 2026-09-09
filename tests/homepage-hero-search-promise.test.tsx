import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickPublicChangeMark } from "~/lib/public-change-mark.server";
import type { WatchEventRecord } from "~/lib/types";

/**
 * Issue #2170 — the logged-out homepage leads with the free, no-account
 * live Meta ad search: the H1 is the promise, the search input and its one
 * primary CTA render in the first viewport without a session, and the
 * under-fold proof block shows a real stored before/after change mark — or
 * the clearly labelled sample state when no stored event qualifies.
 */

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const NOW = new Date("2026-09-09T12:00:00.000Z");

function mockReactRouter(loaderData: { changeMark?: unknown; proofBrief?: unknown }) {
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
        proofBrief: loaderData.proofBrief ?? null,
        changeMark: loaderData.changeMark ?? null,
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

function changeBlock(markup: string): string {
  return markup.match(/<section class="ld-change"[\s\S]*?<\/section>/)?.[0] ?? "";
}

function makeEvent(metadata: Record<string, unknown>): WatchEventRecord {
  return {
    id: "evt-1",
    watchlistId: "wl-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 80,
    adId: null,
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: null,
    title: "Offer changed",
    summary: "The offer changed.",
    metadata,
    confirmedAt: "2026-09-08T04:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: null,
    createdAt: "2026-09-08T04:00:00.000Z",
  };
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

describe("homepage first viewport — free live-search promise (#2170)", () => {
  it("renders the exact H1 promise logged-out", async () => {
    mockReactRouter({});
    const markup = await renderMarketing();
    const h1 = heroH1(markup);

    expect(h1).toContain("See the Meta ads");
    expect(h1).toContain("any competitor is");
    expect(h1).toContain("running");
    expect(h1).toContain("right now.");
    expect(h1).toContain("Free, no account.");
  });

  it("renders the live search input and its primary CTA without a session", async () => {
    mockReactRouter({});
    const markup = await renderMarketing();

    // Logged-out render: the final CTA is the email capture + "Create account",
    // not the signed-in "Account ready" state.
    expect(markup).toContain('aria-label="Work email"');
    expect(markup).toContain("Create account");
    expect(markup).not.toContain("Account ready");

    // The hero search command posts straight to the public /search route.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('aria-label="Competitor website"');
    expect(markup).toContain('name="website"');
    expect(markup).toContain("Preview available ads");
  });

  it("states the paid loop in the deck with the sourced plan cadences", async () => {
    mockReactRouter({});
    const markup = await renderMarketing();

    expect(markup).toContain("Then Five to Nine watches the offer behind those ads");
    expect(markup).toContain("before-and-after screenshot when it changes");
    expect(markup).toContain("Weekly on Free, every 3 hours on Starter.");
  });
});

describe("homepage under-fold change mark (#2170)", () => {
  it("renders a real stored before/after mark when one qualifies", async () => {
    mockReactRouter({
      changeMark: {
        competitorLabel: "Nykaa",
        fieldLabel: "Offer / price",
        mark: { from: "Flat 10% off", to: "Flat 20% off" },
        caughtAt: "2026-09-08T04:00:00.000Z",
      },
    });
    const markup = await renderMarketing();
    const block = changeBlock(markup);

    expect(block).toContain("Nykaa");
    expect(block).toContain("Offer / price");
    expect(block).toContain("<s>Flat 10% off</s>");
    expect(block).toContain("<ins>Flat 20% off</ins>");
    expect(block).toContain("A real stored event from a tracked public advertiser");
    expect(block).not.toContain("Sample");
  });

  it("renders the clearly labelled sample state when no stored event qualifies", async () => {
    mockReactRouter({ changeMark: null });
    const markup = await renderMarketing();
    const block = changeBlock(markup);

    expect(block).toContain(">Sample</span>");
    expect(block).toContain("No real before-and-after is available to show right now");
    expect(block).not.toContain("A real stored event");
  });
});

describe("pickPublicChangeMark — the anti-fabrication gate (#2170)", () => {
  it("accepts a stored event whose from/to tokens differ", () => {
    const picked = pickPublicChangeMark([
      { event: makeEvent({ from: "Flat 10% off", to: "Flat 20% off" }), competitorLabel: "Nykaa" },
    ]);

    expect(picked).toEqual({
      competitorLabel: "Nykaa",
      fieldLabel: "Offer / price",
      mark: { from: "Flat 10% off", to: "Flat 20% off" },
      caughtAt: "2026-09-08T04:00:00.000Z",
    });
  });

  it("refuses events without both stored sides, with equal sides, or with paragraph-length values", () => {
    expect(
      pickPublicChangeMark([
        { event: makeEvent({ to: "Flat 20% off" }), competitorLabel: "Nykaa" },
        { event: makeEvent({ from: "Same", to: "Same" }), competitorLabel: "Nykaa" },
        {
          event: makeEvent({ from: "x".repeat(80), to: "y".repeat(80) }),
          competitorLabel: "Nykaa",
        },
      ]),
    ).toBeNull();
  });

  it("refuses a mark without a competitor label or a capture clock", () => {
    expect(
      pickPublicChangeMark([
        { event: makeEvent({ from: "a", to: "b" }), competitorLabel: "  " },
      ]),
    ).toBeNull();
  });
});
