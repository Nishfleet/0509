import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  formatAdvertiserIdentityNote,
  formatLandingPageHeadlineState,
} from "~/lib/landing-page-display";

describe("selected evidence — complete source-backed evidence", () => {
  it("renders the exact advertiser and headline values when present", () => {
    expect(formatAdvertiserIdentityNote("Nykaa")).toBeNull();
    expect(formatAdvertiserIdentityNote("  Nykaa  ")).toBeNull();

    const state = formatLandingPageHeadlineState({
      rawHeadline: "Glow Days Sale - Up to 50% Off",
      hasCapturedLandingPage: true,
      landingPageUrl: "https://nykaa.example.com/glow-days",
      enrichmentPending: false,
    });
    expect(state.heading).toBe("Glow Days Sale - Up to 50% Off");
    expect(state.note).toBeNull();
  });
});

describe("selected evidence — missing advertiser identity", () => {
  it("explains the identity gap instead of substituting the search query", () => {
    for (const missing of ["", "   ", null, undefined]) {
      const note = formatAdvertiserIdentityNote(missing);
      expect(note).not.toBeNull();
      expect(note).toContain("identity is unconfirmed");
      expect(note).toContain("never guess who ran an ad");
      expect(note).not.toContain("Nykaa");
    }
  });
});

describe("selected evidence — missing headline and landing signals", () => {
  it("shows a field-specific unavailable state when the capture has no headline", () => {
    const state = formatLandingPageHeadlineState({
      rawHeadline: "   ",
      hasCapturedLandingPage: true,
      landingPageUrl: "https://nykaa.example.com/glow-days",
      enrichmentPending: false,
    });
    expect(state.heading).toBe("Headline not detected");
    expect(state.note).toContain("captured snapshot");
    expect(state.note).toContain("Run a fresh search");
  });

  it("keeps the in-flight analysis state while enrichment is pending", () => {
    const state = formatLandingPageHeadlineState({
      rawHeadline: null,
      hasCapturedLandingPage: false,
      landingPageUrl: "https://nykaa.example.com/glow-days",
      enrichmentPending: true,
    });
    expect(state.heading).toBe("Analyzing creative…");
    expect(state.note).toBeNull();
  });

  it("never falls back to the unexplained not-captured-yet placeholder", () => {
    const states = [
      formatLandingPageHeadlineState({
        rawHeadline: null,
        hasCapturedLandingPage: true,
        landingPageUrl: "https://nykaa.example.com",
        enrichmentPending: false,
      }),
      formatLandingPageHeadlineState({
        rawHeadline: "",
        hasCapturedLandingPage: false,
        landingPageUrl: "https://nykaa.example.com",
        enrichmentPending: false,
      }),
      formatLandingPageHeadlineState({
        rawHeadline: null,
        hasCapturedLandingPage: false,
        landingPageUrl: null,
        enrichmentPending: false,
      }),
    ];
    for (const state of states) {
      expect(state.heading).not.toBe("Headline not captured yet");
      expect(`${state.heading} ${state.note ?? ""}`).not.toMatch(
        /headline not captured yet/i,
      );
    }
  });
});

describe("selected evidence — no-link and capture-unavailable combinations", () => {
  it("explains that the destination was recorded but the page text was not checked", () => {
    const state = formatLandingPageHeadlineState({
      rawHeadline: null,
      hasCapturedLandingPage: false,
      landingPageUrl: "https://nykaa.example.com/glow-days",
      enrichmentPending: false,
    });
    expect(state.heading).toBe("No landing page captured");
    expect(state.note).toContain("page text wasn't checked");
    expect(state.note).toContain("Open the link below to check the page yourself");
  });

  it("explains when there is no destination to capture and gives the next step", () => {
    const state = formatLandingPageHeadlineState({
      rawHeadline: null,
      hasCapturedLandingPage: false,
      landingPageUrl: null,
      enrichmentPending: false,
    });
    expect(state.heading).toBe("No landing page to check");
    expect(state.note).toContain("no destination link");
    expect(state.note).toContain("A fresh search");
  });
});

describe("selected evidence — pane language contract", () => {
  it("wires the explained states into the search route and keeps the old placeholder out", () => {
    const route = readFileSync("app/routes/search.tsx", "utf8");
    expect(route).toContain("formatLandingPageHeadlineState");
    expect(route).toContain("formatAdvertiserIdentityNote");
    expect(route).not.toContain("Headline not captured yet");
  });
});
