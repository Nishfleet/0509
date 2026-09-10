import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// A real proof brief with a multi-row trail — the worst case for the fold,
// because the proof strip renders ~10 rows that used to sit between the
// hero wall and the search form (issue #2321).
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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

/**
 * Gate-B fold check at 375×812 (issue #2321).
 *
 * happy-dom has no layout engine, so this cannot measure pixel positions.
 * The structural proxy for "the search input + submit clear the first
 * viewport at 375×812" is DOM order: the search form (.ld-command) must
 * render BEFORE the proof strip (.ld-proof-strip) inside .ld-hero-copy.
 * Before this issue the proof strip sat between the hero wall and the
 * form and pushed the submit below the fold; the fix moves the form
 * directly under the hero wall and the proof strip below it.
 */
describe("marketing hero fold at 375×812 (issue #2321)", () => {
  it("renders the search form before the proof strip so input + submit clear the fold", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    const formIndex = markup.indexOf('class="ld-command"');
    const stripIndex = markup.indexOf('class="ld-proof-strip"');

    expect(formIndex, "the search form .ld-command is rendered").toBeGreaterThan(-1);
    expect(stripIndex, "the proof strip .ld-proof-strip is rendered").toBeGreaterThan(-1);
    // The form must come BEFORE the proof strip in DOM order — the proof
    // strip is the ~10-row block that previously pushed the submit below
    // the 375×812 fold.
    expect(formIndex, "search form renders before the proof strip").toBeLessThan(stripIndex);
  });

  it("renders the search form directly under the hero wall (h1)", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    const wallIndex = markup.indexOf('class="ld-wall"');
    const formIndex = markup.indexOf('class="ld-command"');

    expect(wallIndex, "the hero wall .ld-wall is rendered").toBeGreaterThan(-1);
    expect(formIndex, "the search form .ld-command is rendered").toBeGreaterThan(-1);
    // Nothing but the hero wall sits between the wall and the form inside
    // .ld-hero-copy — the form leads the first viewport.
    expect(formIndex, "search form renders after the hero wall").toBeGreaterThan(wallIndex);
    // The deck copy and proof strip must NOT appear between the wall and
    // the form.
    const betweenWallAndForm = markup.slice(wallIndex, formIndex);
    expect(betweenWallAndForm, "no proof strip between hero wall and form").not.toContain(
      "ld-proof-strip",
    );
    expect(betweenWallAndForm, "no deck copy between hero wall and form").not.toContain(
      "ld-deck-copy",
    );
  });

  it("keeps the proof strip present (moved, not deleted) below the form", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    // The proof strip is preserved — the issue says move, not delete.
    expect(markup, "proof strip is preserved (moved, not deleted)").toContain("ld-proof-strip");
    expect(markup, "proof strip still names the saved proof").toContain("We saved the proof");
  });

  it("renders the search input and submit button inside the form", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    const formStart = markup.indexOf('class="ld-command"');
    const formEnd = markup.indexOf("</form>", formStart);
    expect(formEnd, "the search form has a closing tag").toBeGreaterThan(formStart);
    const formMarkup = markup.slice(formStart, formEnd);

    expect(formMarkup, "search input is inside the form").toContain('aria-label="Competitor website"');
    expect(formMarkup, "submit button is inside the form").toContain("Preview available ads");
  });

  it("keeps the fold order in the honest no-live-proof state too", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();

    const wallIndex = markup.indexOf('class="ld-wall"');
    const formIndex = markup.indexOf('class="ld-command"');
    const stripIndex = markup.indexOf('class="ld-proof-strip"');

    expect(formIndex, "search form renders before the proof strip (no-proof state)").toBeLessThan(
      stripIndex,
    );
    expect(formIndex, "search form renders after the hero wall (no-proof state)").toBeGreaterThan(
      wallIndex,
    );
  });
});
