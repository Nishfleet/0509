import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";
import { OfferTimelineLedger } from "~/components/offer-timeline-ledger";
import type { OfferFieldChange, OfferLedgerEntry } from "~/lib/offer-timeline";
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

// Issue #2564: the extractor must not emit a class-name-shaped ctaText — the
// exact predicate the #2320 display guard rejects (a no-space `ic-*`/`js-*`
// token, or an all-lowercase dashed token with 3+ segments). Class-like
// candidates are treated as chrome at every pickBestCta tier, so a page
// whose only selectable node is chrome bails instead of leaking the class
// into ctaText.
describe("CTA class-name extractor guard (issue #2564)", () => {
  it("bails only_chrome_anchors when the only anchor text is a leaked class", () => {
    const html = '<nav><a href="/nav">ic-left-nav</a></nav>';
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_anchors" });
  });

  it("bails only_chrome_buttons when the only button text is a leaked class", () => {
    const html = "<button>ic-left-nav</button>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_buttons" });
  });

  it("skips a class-like candidate even when it carries a priority verb", () => {
    // `js-submit` matches the /\bsubmit\b/ priority pattern — the class-name
    // gate runs before the priority scan, so it still never reaches ctaText.
    const html = '<a href="/go">js-submit</a>';
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_anchors" });
  });

  it("skips a dashed multi-segment token and still reaches a real anchor", () => {
    const html = `
      <nav><a href="/nav">promo-banner-title</a></nav>
      <main><a href="/learn">Learn more</a></main>
    `;
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Learn more");
  });

  it("skips a class-like submit value", () => {
    const html = '<form><input type="submit" value="promo-banner-title"></form>';
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
  });

  it("keeps a single-hyphen token the exact predicate does not reject", () => {
    // The binding predicate rejects only `ic-*`/`js-*` prefixes or 3+ dashed
    // segments — "buy-now" is not class-like at display time either, so the
    // extractor must not widen the net.
    const html = "<button>buy-now</button>";
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("buy-now");
  });

  it("skips a class-like button candidate even when it carries a priority verb", () => {
    // Button-tier twin of the anchor case above: `js-submit` also matches
    // /\bsubmit\b/ as a <button>, i.e. through isChromeButtonText's early
    // return on the button fallback — the gate must fire there too.
    const html = "<button>js-submit</button>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_buttons" });
  });

  it("lockstep: the extractor's class-like net matches the #2320 display guard", () => {
    // The predicate exists as two intentional copies (route -> lib layering
    // forbids importing the route's guard), so this corpus pins every branch
    // on both sides. A copy drifting on either side fails here.
    const rejected = [
      "ic-left-nav", // ic-* prefix branch
      "js-submit", // js-* prefix branch
      "js-track-click", // js-* prefix, longer tail
      "promo-banner-title", // pure 3+ dashed lowercase segments branch
      "footer-links-row",
    ];
    for (const value of rejected) {
      // These must genuinely be class-like at display time (the binding guard).
      expect(isClassLikeCtaText(value)).toBe(true);
      for (const html of [
        `<button>${value}</button>`,
        `<a href="/x">${value}</a>`,
        `<form><input type="submit" value="${value}"></form>`,
      ]) {
        expect(extractLandingPageSignals(html).ctaText).toBeNull();
      }
    }
    const retained = [
      "buy-now", // two segments sit below the binding 3-segment bar
      "IC-LEFT-NAV", // the binding guard is case-sensitive, so is the extractor
    ];
    for (const value of retained) {
      expect(isClassLikeCtaText(value)).toBe(false);
    }
    expect(extractLandingPageSignals("<button>buy-now</button>").ctaText).toBe("buy-now");
  });
});

// Issue #2576: the #2320 display guard covered `OfferLedgerEntry.ctaText` only.
// The same ledger row's transition diff renders `CTA: <before> → <after>` from
// the extractor-derived field, so a snapshot pair whose extracted CTA is a
// leaked class (e.g. `ic-left-nav`) surfaced the garbage in the diff even while
// the flat field was guarded. The guard now lives inside OfferTimelineLedger —
// the render choke point — so both sides of the diff fall back to the honest
// "No clear CTA" on every surface that mounts the ledger (/ads/:domain and
// /timeline/:domain). These cases pin the transition-diff guard.
describe("CTA class-name transition-diff guard (issue #2576)", () => {
  function transitionEntry(
    ctaTransition: OfferFieldChange<string | null> | null,
  ): OfferLedgerEntry {
    return {
      id: "snap-nykaa-transition",
      capturedAt: "2026-08-28T00:00:00.000Z",
      dateLabel: "28 Aug 2026",
      canonicalUrl: "https://www.nykaa.com/",
      headline: "Beauty shopping",
      ctaText: "Shop now",
      priceText: null,
      formPresent: false,
      screenshotHref: null,
      pageTextHref: null,
      evidenceNote: null,
      transition: {
        headline: null,
        ctaText: ctaTransition,
        priceText: null,
        formPresent: null,
      },
      runExtentLabel: null,
    };
  }

  it("guards a leaked class on the before side of the CTA diff", () => {
    const markup = renderToStaticMarkup(
      createElement(OfferTimelineLedger, {
        entries: [transitionEntry({ before: "ic-left-nav", after: "Shop now" })],
      }),
    );
    expect(markup).toContain('f9-timeline-before">No clear CTA<');
    expect(markup).toContain('f9-timeline-after">Shop now<');
    // The leaked class must never surface as a labeled fact.
    expect(markup).not.toContain("ic-left-nav");
  });

  it("guards a leaked class on the after side while a null before still renders the em dash", () => {
    const markup = renderToStaticMarkup(
      createElement(OfferTimelineLedger, {
        entries: [transitionEntry({ before: null, after: "js-submit" })],
      }),
    );
    expect(markup).toContain('f9-timeline-before">—<');
    expect(markup).toContain('f9-timeline-after">No clear CTA<');
    expect(markup).not.toContain("js-submit");
  });

  it("renders a genuine CTA transition untouched", () => {
    const markup = renderToStaticMarkup(
      createElement(OfferTimelineLedger, {
        entries: [transitionEntry({ before: "Shop now", after: "Buy the kit" })],
      }),
    );
    expect(markup).toContain('f9-timeline-before">Shop now<');
    expect(markup).toContain('f9-timeline-after">Buy the kit<');
    expect(markup).not.toContain("No clear CTA");
  });

  it("route fixture: the /ads/:domain row guards the transition diff too", () => {
    const markup = renderToStaticMarkup(
      createElement(BrandOfferTimeline, {
        domain: "nykaa.com",
        timelineIndexable: false,
        entries: [transitionEntry({ before: "ic-left-nav", after: "Shop now" })],
      }),
    );
    expect(markup).toContain("No clear CTA");
    expect(markup).not.toContain("ic-left-nav");
  });
});
