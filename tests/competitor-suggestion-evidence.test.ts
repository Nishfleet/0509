import { describe, expect, it } from "vitest";

import {
  buildCandidateId,
  buildSuggestionWhy,
} from "~/lib/auto-competitor-seed.server";
import { getCompetitorSuggestionCaps } from "~/lib/plan-entitlements";

/**
 * Onboarding epic slice 2 (#3175): the pure helpers the auto-populated
 * suggestions are built from.
 *
 * These are pure functions on the `node` project (no D1, no workerd) — the
 * integration suite (`tests/integration/competitor-suggestion-dismissal
 * .integration.test.ts`) covers the same behaviour against real tables.
 *
 * What is pinned here is the honesty contract, not cosmetics:
 *   - the one-line `why` is built ONLY from probe facts and is never empty;
 *   - it truncates rather than growing without bound;
 *   - the candidate key is stable, so a dismissal cannot silently stop matching;
 *   - the plan caps never promise more tracking than the plan can honour.
 */

describe("buildSuggestionWhy (#3175)", () => {
  it("names the overlapping keywords and the country", () => {
    expect(
      buildSuggestionWhy({
        matchedKeywords: ["wool runners"],
        countries: ["United States"],
        seedSource: "ads",
      }),
    ).toBe("Runs ads on “wool runners” in United States.");
  });

  it("joins two keywords and summarises the rest rather than listing them all", () => {
    const why = buildSuggestionWhy({
      matchedKeywords: ["wool runners", "wool shoes", "merino", "sustainable"],
      countries: ["United States", "Canada", "Germany"],
      seedSource: "ads",
    });
    expect(why).toBe(
      "Runs ads on “wool runners” and “wool shoes” +2 more in United States, Canada +1 more.",
    );
    // A bounded line: never the full keyword set.
    expect(why).not.toContain("merino");
  });

  it("omits the country clause when the probes carried none", () => {
    expect(
      buildSuggestionWhy({
        matchedKeywords: ["wool runners"],
        countries: [],
        seedSource: "ads",
      }),
    ).toBe("Runs ads on “wool runners”.");
  });

  it("is never empty, even with no facts at all (the unreachable honest path)", () => {
    const adsWhy = buildSuggestionWhy({
      matchedKeywords: [],
      countries: [],
      seedSource: "ads",
    });
    expect(adsWhy.length).toBeGreaterThan(0);
    expect(adsWhy).toContain("same terms as you");

    const landingWhy = buildSuggestionWhy({
      matchedKeywords: [],
      countries: [],
      seedSource: "landing_page",
    });
    expect(landingWhy.length).toBeGreaterThan(0);
    expect(landingWhy).toContain("your site");
  });
});

describe("buildCandidateId (#3175)", () => {
  it("is stable and lowercases the advertiser and domain", () => {
    const a = buildCandidateId({
      advertiser: "Rothy's",
      registrableDomain: "Rothys.com",
      advertiserPageId: null,
    });
    const b = buildCandidateId({
      advertiser: "  rothy's  ",
      registrableDomain: "rothys.com",
      advertiserPageId: "",
    });
    // The dismissal store keys on this string, so a change to spacing or case
    // handling would leave a removed suggestion un-dismissed.
    expect(a).toBe(b);
  });

  it("separates two candidates that share a display name", () => {
    const one = buildCandidateId({
      advertiser: "Acme",
      registrableDomain: "acme.com",
      advertiserPageId: null,
    });
    const two = buildCandidateId({
      advertiser: "Acme",
      registrableDomain: "acme.co.uk",
      advertiserPageId: null,
    });
    expect(one).not.toBe(two);
  });
});

describe("getCompetitorSuggestionCaps (#3175)", () => {
  it("gives free a frozen snapshot and nothing tracked continuously", () => {
    expect(getCompetitorSuggestionCaps("free")).toEqual({
      visible: 5,
      tracked: 0,
      frozen: true,
    });
  });

  it("caps paid plans at their own watchlist limit, bounded by the ceiling", () => {
    // Scout tracks 3, so it may only ever show 3 — showing more would invite
    // the customer to build a list the plan cannot save.
    expect(getCompetitorSuggestionCaps("scout")).toEqual({
      visible: 3,
      tracked: 3,
      frozen: false,
    });
    // Starter and Agency track more than the ceiling, so the ceiling binds.
    expect(getCompetitorSuggestionCaps("starter").visible).toBe(8);
    expect(getCompetitorSuggestionCaps("agency").visible).toBe(8);
  });

  it("never lets a plan's visible cap exceed what it can track", () => {
    for (const plan of ["scout", "starter", "agency"] as const) {
      const caps = getCompetitorSuggestionCaps(plan);
      expect(caps.visible).toBeLessThanOrEqual(caps.tracked);
      expect(caps.frozen).toBe(false);
    }
  });
});
