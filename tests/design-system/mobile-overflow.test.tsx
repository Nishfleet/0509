// Regression guard for the 2px mobile horizontal overflow the `ld-ticker-belt`
// marquee used to leak at 390px (issue #1486). The CSS fix — `contain:
// inline-size` plus `overflow: hidden` and `max-width: 100%` on `.ld-ticker`
// — landed in 546771fa. This test locks the containment mechanism and the
// ticker DOM shape so a future edit cannot silently remove it.
//
// vitest's `node` project has no layout engine, so `scrollWidth`/`clientWidth`
// are not measurable here. The real `scrollWidth === clientWidth` assertion at
// a 390px viewport lives in the Playwright spec `e2e/mobile-ticker-overflow.spec.ts`,
// which renders the page in real Chromium. This file guards the two things a
// node-environment test can prove: the ticker renders with the decorative
// structure the issue requires, and the stylesheet carries the isolation
// mechanism that makes the marquee unable to inflate the document.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const css = readFileSync("app/app.css", "utf8");

function ruleBody(selector: string): string {
  const match = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

// Minimal proof brief so the ticker renders the proof cycle the issue names
// (the [ad library] / [source links] / [brief] evidence tags). Shape matches
// PublicProofBrief; only the fields buildTickerEvents and the hero read are
// filled, the rest are inert non-null values so the render does not throw.
const proofBrief = {
  competitorName: "Nykaa",
  website: "nykaa.com",
  adLibraryCountry: "India",
  fetchedAt: "2026-08-11T22:17:00.000Z",
  checkedAgoLabel: "about 4 hours ago",
  freshForLiveClaim: false,
  adCount: 6,
  activeAdCount: 4,
  summary: "6 public Meta ads link to nykaa.com.",
  decision: {
    subject: "4 of 6 cached ads are active on record",
    whatChanged: "Most repeated hook is Routine-first bundle.",
    whyItMatters: "Review before the next campaign refresh.",
    priority: "Review before the next campaign refresh",
    proofStatus: "Captured from the India Ad Library",
    source: "Meta Ad Library (public archive)",
    freshness: "Last checked about 4 hours ago",
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
  ],
  insights: {
    topHooks: ["Routine-first bundle"],
    mediaMix: [{ channel: "Meta Ad Library", count: 4 }],
    timeline: ["Creative started running Aug 8, 09:00 AM"],
  },
  reportRows: ["What is captured: 4 of 6 cached creatives are active"],
};

// Loader shape the marketing route reads via useLoaderData / useRouteLoaderData.
const routeData = {
  pricingPreview: { available: false },
  commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
  proofBrief,
  indexableAdsLinks: [] as unknown[],
};
const rootData = { session: null };

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => routeData,
      useRouteLoaderData: () => rootData,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
    };
  });
  // Stub the heavy presentational sections so the render stays focused on the
  // ticker markup. The ticker itself is rendered inline by the route.
  vi.doMock("~/components/marketing-nav", () => ({
    MarketingNav: () => createElement("nav", { "aria-label": "Primary" }),
  }));
  vi.doMock("~/components/marketing-footer", () => ({
    MarketingFooter: () => createElement("footer"),
  }));
  vi.doMock("~/components/submit-button", () => ({
    SubmitButton: ({ children }: { children?: ReactNode }) =>
      createElement("button", null, children),
  }));
  vi.doMock("~/components/pricing-section", () => ({
    PricingSection: () => createElement("section", { id: "pricing" }),
    // The route re-exports and calls this as a function; return an empty list
    // so the FAQ JSON-LD assembly in the render stays empty.
    billingFaqJsonLdEntries: () => [] as unknown[],
    planIntentPath: "/search",
    valueMathLabel: "value",
  }));
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.doUnmock("~/components/marketing-nav");
  vi.doUnmock("~/components/marketing-footer");
  vi.doUnmock("~/components/submit-button");
  vi.doUnmock("~/components/pricing-section");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

describe("mobile horizontal overflow — ld-ticker-belt (#1486)", () => {
  it("renders the decorative ticker with aria-hidden and the two-run belt", async () => {
    const html = await renderMarketing();
    // The ticker container is decorative and hidden from assistive tech.
    expect(html).toContain('class="ld-ticker"');
    expect(html).toContain('aria-hidden="true"');
    // The belt wraps exactly two runs (the marquee duplicates the run for the
    // seamless -50% translate loop). Both must be present so the animation
    // stays gap-free without a second copy inflating layout.
    expect(html).toContain('class="ld-ticker-belt"');
    const runCount = (html.match(/class="ld-ticker-run"/g) ?? []).length;
    expect(runCount, "ticker belt holds two ld-ticker-run copies").toBe(2);
    // The default (no proof brief) cycle carries the three evidence tags the
    // issue requires: [ad library], [source links], [brief].
    expect(html).toContain("[ad library]");
    expect(html).toContain("[source links]");
    expect(html).toContain("[brief]");
  });

  it("isolates the marquee so width:max-content cannot inflate the document", () => {
    const ticker = ruleBody(".ld-ticker");
    // The three properties that together prevent the belt's max-content width
    // from reaching documentElement.scrollWidth. `overflow: hidden` clips the
    // overflow, `max-width: 100%` keeps the box inside its parent, and
    // `contain: inline-size` makes the box's inline size independent of its
    // content so the belt cannot push it wider than the viewport.
    expect(ticker).toMatch(/overflow:\s*hidden/);
    expect(ticker).toMatch(/max-width:\s*100%/);
    expect(ticker).toMatch(/contain:\s*inline-size/);

    const belt = ruleBody(".ld-ticker-belt");
    // The belt is intentionally wider than the viewport so the marquee can
    // scroll; the containment above is what makes that safe. If this width
    // is ever removed the marquee stops, so assert it stays.
    expect(belt).toMatch(/width:\s*max-content/);
  });

  it("does not use width:100vw on the marketing surface (a separate mobile overflow cause)", () => {
    // `100vw` includes the scrollbar gutter on desktop and can overshoot the
    // viewport by a few px on mobile; the ticker fix uses `max-width: 100%`
    // instead. Guard against a regression that swaps one for the other.
    const vwWidthMatches = css.match(/width\s*:\s*100vw/g) ?? [];
    expect(
      vwWidthMatches,
      "app.css must not declare `width: 100vw` (use max-width: 100% or 100%)",
    ).toEqual([]);
  });
});
