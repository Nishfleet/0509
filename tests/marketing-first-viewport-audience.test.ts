import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Regression for sol-sweep packet product-live/0509-first-viewport-audience-unclear:
// the first mobile viewport explained competitor-change monitoring but identified
// the buyer only as the generic "your team". The fix adds one truthful, specific
// buyer identifier ("growth team" — the repo's canonical audience: MEMORY.md,
// README.md, north-star artifact, launch-readiness, saashub listing, working
// buyer "India-based D2C growth lead") to the hero deck copy.
//
// These are static source checks (the 390x844 proxy): the deck paragraph must
// name the audience, sit in the hero before the search form, carry no hiding
// rule, and keep the mechanism/evidence claims intact. Live 390x844 layout is
// verified separately with the detector's playwright proof command.

const marketingRoute = readFileSync("app/routes/marketing.tsx", "utf8");
// JSX text wraps across source lines; compare claims on a whitespace-normalized copy.
const marketingRouteText = marketingRoute.replace(/\s+/g, " ");
const appCss = readFileSync("app/app.css", "utf8");

const deckSentence = "Your growth team would&rsquo;ve found out from a client.";

// Every CSS rule block whose selector mentions .ld-deck-copy.
const deckCssRules = Array.from(
  appCss.matchAll(/([^{}]*\.ld-deck-copy[^{}]*)\{([^}]*)\}/g),
).map((match) => ({ selector: match[1].trim(), body: match[2] }));

describe("first viewport names the audience (product-live/0509-first-viewport-audience-unclear)", () => {
  it("names a specific buyer in the hero deck copy instead of only the generic 'your team'", () => {
    expect(marketingRoute).toContain(deckSentence);
  });

  it("places the audience identifier in the hero, before the search form (first viewport)", () => {
    const deckIndex = marketingRoute.indexOf(deckSentence);
    expect(deckIndex).toBeGreaterThan(marketingRoute.indexOf('<section className="ld-hero">'));
    expect(deckIndex).toBeLessThan(marketingRoute.indexOf('action="/search"'));
    expect(deckIndex).toBeLessThan(marketingRoute.indexOf('<section className="ld-proof"'));
  });

  // The detector's first-viewport probe reads leaf elements only
  // (children.length === 0). The deck paragraph's text is not a leaf, so the
  // audience identifier must also appear in a leaf element inside p.ld-case —
  // the hero situation headline — or the live check cannot see it.
  it("names the audience in a first-viewport leaf element (the p.ld-case headline the detector reads)", () => {
    const headline = "A rival page changed while your growth team was offline";
    expect(marketingRoute).toContain(headline);
    const caseIndex = marketingRoute.indexOf('<p className="ld-case">');
    const headlineIndex = marketingRoute.indexOf(headline);
    expect(caseIndex).toBeGreaterThan(-1);
    expect(headlineIndex).toBeGreaterThan(caseIndex);
    expect(headlineIndex).toBeLessThan(marketingRoute.indexOf('<section className="ld-proof"'));
    // The old generic-only headline must be gone from the first viewport.
    expect(marketingRoute).not.toContain("A rival page changed while your team was offline");
  });

  it("keeps the deck paragraph visible (no display:none / visibility:hidden / aria-hidden)", () => {
    expect(deckCssRules.length).toBeGreaterThan(0);
    for (const rule of deckCssRules) {
      expect(rule.body, `hiding rule in: ${rule.selector}`).not.toMatch(/display\s*:\s*none/);
      expect(rule.body, `hiding rule in: ${rule.selector}`).not.toMatch(
        /visibility\s*:\s*hidden/,
      );
    }
    expect(marketingRoute).not.toMatch(/<p className="ld-deck-copy"[^>]*aria-hidden="true"/);
  });

  it("adds no nowrap that could overflow the 390px viewport", () => {
    for (const rule of deckCssRules) {
      expect(rule.body, `nowrap in: ${rule.selector}`).not.toMatch(/white-space\s*:\s*nowrap/);
    }
  });

  it("keeps the mechanism and evidence claims of the deck intact", () => {
    expect(marketingRouteText).toContain("watches competitors&rsquo; landing pages for price, offer, and CTA changes");
    expect(marketingRouteText).toContain("saves the screenshots");
    expect(marketingRouteText).toContain("before your alarm goes off");
    expect(marketingRouteText).toContain("Proof-backed brief");
    expect(marketingRouteText).toContain("A rival page changed while your growth team was offline");
  });
});
