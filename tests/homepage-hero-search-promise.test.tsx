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

/** The `<span class="ld-row">` lines of the hero wall, in document order. */
function heroWallRows(h1: string): string[] {
  return Array.from(h1.matchAll(/<span class="ld-row[^"]*">/g)).map((match) => match[0]);
}

/** The rendered hero search command form. */
function heroCommand(markup: string): string {
  return markup.match(/<form class="ld-command"[\s\S]*?<\/form>/)?.[0] ?? "";
}

/** The rendered final email-capture CTA form. */
function finalCta(markup: string): string {
  return markup.match(/<form class="f9-email-cta"[\s\S]*?<\/form>/)?.[0] ?? "";
}

const REAL_CHANGE_MARK = {
  competitorLabel: "Nykaa",
  fieldLabel: "Offer / price",
  mark: { from: "Flat 10% off", to: "Flat 20% off" },
  caughtAt: "2026-09-08T04:00:00.000Z",
};

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
  it("renders the hero promise wall logged-out", async () => {
    mockReactRouter({});
    const markup = await renderMarketing();
    const h1 = heroH1(markup);

    // Structural: four ld-row lines with the indented callout. The wall text
    // itself is copy and is free to change without rewriting this test.
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).toContain('<span class="ld-row ld-row-indent">');
    expect(h1).toContain('<ins class="ld-ins">');
  });

  it("renders the live search input and its primary CTA without a session", async () => {
    mockReactRouter({});
    const markup = await renderMarketing();

    // Logged-out render: the final CTA is the email capture input, not the
    // signed-in state element.
    const cta = finalCta(markup);
    expect(cta).toContain('type="email"');
    expect(cta).toContain('name="email"');
    expect(cta).not.toContain("f9-email-state");
    expect(cta).toMatch(/<button[^>]*type="submit"/);

    // The hero search command posts straight to the public /search route.
    const command = heroCommand(markup);
    expect(command).toContain('action="/search"');
    expect(command).toContain('aria-label="Competitor website"');
    expect(command).toContain('name="website"');
    expect(command).toMatch(/<button[^>]*type="submit"/);
  });

  it("states the deck's screenshot promise with the capture-includes-one qualifier", async () => {
    mockReactRouter({});
    const markup = await renderMarketing();

    const deck = markup.match(/<p class="ld-deck-copy">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(deck.length).toBeGreaterThan(0);
    // Shape: the deck still promises page text plus a source link.
    expect(deck).toMatch(/page text[\s\S]*source link/);
    // The audit table marks the screenshot qualifier a customer claim
    // (AUDIT-SAVES-SCREENSHOTS, the homepage hero deck surface; the same
    // sentence also appears on AUDIT-PROOF-BRIEF-REAL), so this one stays an
    // exact-string assertion.
    expect(deck).toContain("plus a screenshot when the capture includes one");
    // The deck is not the plan-cadence surface.
    expect(deck).not.toMatch(/\bevery \d+\s*hours?\b|\bweekly\b|\bdaily\b/i);
  });
});

describe("homepage under-fold change mark (#2170)", () => {
  it("renders a real stored before/after mark when one qualifies", async () => {
    mockReactRouter({ changeMark: REAL_CHANGE_MARK });
    const markup = await renderMarketing();
    const block = changeBlock(markup);

    // The loader's own values are rendered, not a canned sentence.
    expect(block).toContain(REAL_CHANGE_MARK.competitorLabel);
    expect(block).toContain(REAL_CHANGE_MARK.fieldLabel);
    expect(block).toContain(`<s>${REAL_CHANGE_MARK.mark.from}</s>`);
    expect(block).toContain(`<ins>${REAL_CHANGE_MARK.mark.to}</ins>`);
    // Real vs sample is a structural state: the sample marker is absent.
    expect(block).not.toContain("ld-change-sample");
  });

  it("renders the clearly labelled sample state when no stored event qualifies", async () => {
    mockReactRouter({ changeMark: null });
    const markup = await renderMarketing();
    const block = changeBlock(markup);

    // The sample card carries the sample marker and no real loader value.
    expect(block).toContain('class="ld-change-sample"');
    expect(block).toContain("<s>");
    expect(block).toContain("<ins>");
    expect(block).not.toContain(REAL_CHANGE_MARK.competitorLabel);
    expect(block).not.toContain(`<s>${REAL_CHANGE_MARK.mark.from}</s>`);
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
