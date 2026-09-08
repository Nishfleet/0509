import { describe, expect, it } from "vitest";

import {
  scoreChangeCriticality,
  scoreWebsitePageChange,
} from "~/lib/change-criticality.server";

describe("scoreChangeCriticality", () => {
  it("returns the default zero cosmetic score when nothing changed", () => {
    const result = scoreChangeCriticality({});
    expect(result.score).toBe(0);
    expect(result.band).toBe("cosmetic");
    expect(result.reasons).toEqual([]);
  });

  it("scores a price-token hit as material", () => {
    const result = scoreChangeCriticality({
      before: "From ₹499",
      after: "From ₹799",
    });
    expect(result.band).toBe("material");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(75);
    expect(result.reasons).toContain("price-token");
  });

  it("scores an offerPrice field change as material even when the text misses the price-token regex", () => {
    const result = scoreWebsitePageChange({
      kind: "field-changed",
      field: "offerPrice",
      before: "$19/mo",
      after: "$29/mo",
    });
    expect(result.band).toBe("material");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.reasons).toContain("price-token");
  });

  it("scores a CTA-string field change as material", () => {
    const result = scoreWebsitePageChange({
      kind: "field-changed",
      field: "cta",
      before: "Buy now",
      after: "Get started",
    });
    expect(result.band).toBe("material");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.reasons).toContain("cta-string-change");
  });

  it("scores a page-added fact as critical (new-landing-page)", () => {
    const result = scoreWebsitePageChange({
      kind: "page-added",
      field: "page",
      before: null,
      after: "https://competitor.example/pricing",
    });
    expect(result.band).toBe("critical");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.reasons).toContain("new-landing-page");
  });

  it("scores a page-removed fact as material", () => {
    const result = scoreWebsitePageChange({
      kind: "page-removed",
      field: "page",
      before: "https://competitor.example/about",
      after: null,
    });
    expect(result.band).toBe("material");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(75);
    expect(result.reasons).toContain("page-removed");
  });

  it("scores an asset-hash change as material", () => {
    const result = scoreChangeCriticality({ assetHashChanged: true });
    expect(result.band).toBe("material");
    expect(result.reasons).toContain("asset-hash-change");
  });

  it("scores a footer-only text tweak as cosmetic", () => {
    const result = scoreChangeCriticality({
      before:
        "Welcome to our home. We help teams ship faster with a clear changelog and docs. Copyright 2025. All rights reserved.",
      after:
        "Welcome to our home. We help teams ship faster with a clear changelog and docs. Copyright 2026. All rights reserved.",
    });
    expect(result.band).toBe("cosmetic");
    expect(result.score).toBeLessThan(25);
    expect(result.reasons).toContain("low-text-diff-ratio");
  });

  it("keeps score in 0-100 and never invents a fifth band", () => {
    const result = scoreWebsitePageChange({
      kind: "page-added",
      field: "page",
      before: null,
      after: "https://competitor.example/new",
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(["cosmetic", "routine", "material", "critical"]).toContain(result.band);
  });
});
