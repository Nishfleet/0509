import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import { BrandOfferTimeline, isClassLikeCtaText } from "~/routes/ads.$domain";

// Issue #1401: the CTA detector was silent for 75 days because pages whose
// only CTA is a generic anchor (no priority verb, no <button>) bailed to
// null. These tests pin the v6 anchor-text fallback that flips that bail into
// a reached extraction, and the funnel reason codes that make the bail-out
// diagnosable.
describe("CTA anchor fallback (v6, issue #1401)", () => {
  it("extracts a soft-CTA anchor when no priority verb and no button match", () => {
    const html = '<a href="/learn">Learn more</a>';
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Learn more");
    expect(ctaFunnel).toEqual({ stage: "reached", reasonCode: null });
  });

  it("extracts a commercial anchor without a priority verb", () => {
    const html = '<a href="/report">Build my report</a>';
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Build my report");
    expect(ctaFunnel.stage).toBe("reached");
  });

  it("skips navigation-chrome anchors and bails with only_chrome_anchors", () => {
    const html = `
      <nav>
        <a href="/about">About</a>
        <a href="/blog">Blog</a>
        <a href="/login">Login</a>
      </nav>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_anchors" });
  });

  it("picks the first non-chrome anchor when nav and a soft CTA coexist", () => {
    const html = `
      <nav><a href="/about">About</a><a href="/login">Login</a></nav>
      <main><a href="/guide">Read the guide</a></main>
    `;
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Read the guide");
  });

  it("bails with no_cta_candidates when there are no buttons, submits, or anchors", () => {
    const html = "<main><p>Just plain words here.</p></main>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "no_cta_candidates" });
  });

  it("bails with empty_capture when the visible body is blank", () => {
    const html = "<html><head></head><body><script>x()</script></body></html>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "empty_capture" });
  });

  it("bails with only_chrome_buttons when every button is UI chrome", () => {
    const html = "<button>Menu</button><button>Close</button>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_buttons" });
  });

  it("still prefers a priority-verb button over an anchor fallback", () => {
    const html = `
      <a href="/learn">Learn more</a>
      <button>Buy now</button>
    `;
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Buy now");
  });

  it("still prefers a non-chrome button over the anchor fallback", () => {
    const html = `
      <a href="/learn">Learn more</a>
      <button>Build my report</button>
    `;
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Build my report");
  });

  it("skips search-command and calendar chrome buttons in the fallback", () => {
    const html = `
      <button>Search… Ctrl K</button>
      <button>12</button>
      <button>UTC Time (12:01am)</button>
      <button>Show more</button>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({
      stage: "bailed",
      reasonCode: "only_chrome_buttons",
    });
  });

  it("skips Calendly cookie chrome and reaches a soft-CTA anchor instead", () => {
    const html = `
      <button>Show more</button>
      <button>Accept all</button>
      <button>Cookie settings</button>
      <a href="/book">Book a slot</a>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Book a slot");
    expect(ctaFunnel.stage).toBe("reached");
  });

  it("skips login-wall and cookie-detail chrome including bidi marks", () => {
    const html = `
      <button>Try again</button>
      <a href="/forgot">Forgotten password?</a>
      <button>Cookie Details\u200e</button>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({
      stage: "bailed",
      reasonCode: "only_chrome_buttons",
    });
  });
});

// Issue #2320: the public offer timeline renders CTA text at display time, so
// a CSS class that the extractor leaks (e.g. `ic-left-nav`) can surface as a
// labeled fact — "CTA: ic-left-nav" — next to "No proof, no claim" branding,
// which reads as fabricated data. `isClassLikeCtaText` is the display-time
// guard that rejects class-name-shaped values before they render. These cases
// pin the exact predicate shipped with the fix (judge-edited, binding).
describe("CTA class-name display guard (issue #2320)", () => {
  it("rejects a no-space class-name token with an ic- prefix", () => {
    expect(isClassLikeCtaText("ic-left-nav")).toBe(true);
  });

  it("rejects a no-space class-name token with a js- prefix", () => {
    expect(isClassLikeCtaText("js-tab-panel")).toBe(true);
  });

  it("rejects a no-space dashed multi-segment token", () => {
    expect(isClassLikeCtaText("promo-banner-title")).toBe(true);
  });

  it("keeps a real multi-word CTA (has whitespace)", () => {
    expect(isClassLikeCtaText("Buy the kit")).toBe(false);
  });

  it("keeps a short single-word CTA", () => {
    expect(isClassLikeCtaText("Shop")).toBe(false);
  });

  it("treats null and empty as not class-like", () => {
    expect(isClassLikeCtaText(null)).toBe(false);
    expect(isClassLikeCtaText("")).toBe(false);
  });
});

// Issue #2320 route fixture: the guard must fall through to the rendered
// timeline, not live only as an exported predicate. A dated state whose
// extracted CTA is the leaked class `ic-left-nav` must render the honest
// "No clear CTA" fallback, while an adjacent genuine CTA still renders
// untouched. `timelineIndexable` is false so the ledger's cross-link (a
// react-router `<Link>` that needs a router context) is not mounted.
describe("offer timeline route fixture (issue #2320)", () => {
  function entry(overrides: Partial<OfferLedgerEntry>): OfferLedgerEntry {
    return {
      id: "snap-nykaa-20260827",
      capturedAt: "2026-08-27T00:00:00.000Z",
      dateLabel: "27 Aug 2026",
      canonicalUrl: "https://www.nykaa.com/",
      headline: "Beauty shopping",
      ctaText: null,
      priceText: null,
      formPresent: false,
      screenshotHref: null,
      pageTextHref: null,
      evidenceNote: null,
      transition: null,
      runExtentLabel: null,
      ...overrides,
    };
  }

  it("renders No clear CTA for a leaked class and never surfaces the class name", () => {
    const markup = renderToStaticMarkup(
      createElement(BrandOfferTimeline, {
        domain: "nykaa.com",
        timelineIndexable: false,
        entries: [
          entry({ id: "snap-nykaa-ic", ctaText: "ic-left-nav" }),
          entry({ id: "snap-nykaa-buynow", ctaText: "Buy the kit" }),
        ],
      }),
    );

    expect(markup).toContain("No clear CTA");
    // The leaked class must never surface as a labeled fact.
    expect(markup).not.toContain("ic-left-nav");
    expect(markup).not.toContain("CTA: ic-");
    // A genuine CTA still renders untouched (the guard is shape-based).
    expect(markup).toContain("CTA: Buy the kit");
  });
});
