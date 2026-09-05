import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  demoProof,
  SAMPLE_SOURCE_TRAIL_NOTE,
  SAMPLE_UNAVAILABLE_COPY,
  sampleProofValue,
} from "~/lib/demo-proof";

const marketingRoute = readFileSync("app/routes/marketing.tsx", "utf8");

const digestFieldKeys = [
  "subject",
  "whatChanged",
  "whyItMatters",
  "priority",
  "proofStatus",
  "source",
  "freshness",
  "recommendedMove",
] as const;

describe("sample proof value guard", () => {
  it("returns the fixture value when the sample supports it", () => {
    expect(sampleProofValue("Verified evidence")).toBe("Verified evidence");
    expect(sampleProofValue("  Review before next campaign refresh  ")).toBe(
      "Review before next campaign refresh",
    );
  });

  it("returns the explicit unavailable state instead of a blank label", () => {
    expect(sampleProofValue("")).toBe(SAMPLE_UNAVAILABLE_COPY);
    expect(sampleProofValue("   ")).toBe(SAMPLE_UNAVAILABLE_COPY);
    expect(sampleProofValue(null)).toBe(SAMPLE_UNAVAILABLE_COPY);
    expect(sampleProofValue(undefined)).toBe(SAMPLE_UNAVAILABLE_COPY);
    expect(SAMPLE_UNAVAILABLE_COPY).toBe("Not available in this sample");
  });
});

describe("sample brief fixture truthfulness", () => {
  it("backs every decision-summary proof field with non-empty sample content", () => {
    for (const key of digestFieldKeys) {
      expect(demoProof.digestPreview[key]).toBeTruthy();
      expect(demoProof.digestPreview[key].trim()).not.toBe("");
    }
  });

  it("backs the source trail with real non-empty items and no fake URLs", () => {
    expect(demoProof.proofTrail.length).toBeGreaterThan(0);
    for (const item of demoProof.proofTrail) {
      expect(item.signal.trim()).not.toBe("");
      expect(item.evidence.trim()).not.toBe("");
      expect(item.source.trim()).not.toBe("");
      expect(item.source).not.toMatch(/^https?:\/\//);
      expect(item.evidence).not.toMatch(/^https?:\/\//);
    }
  });

  it("labels the sample source trail as illustrative", () => {
    expect(SAMPLE_SOURCE_TRAIL_NOTE).toContain("Illustrative sample");
    expect(SAMPLE_SOURCE_TRAIL_NOTE).toContain("not linked");
    expect(SAMPLE_SOURCE_TRAIL_NOTE).toContain("Live briefs link each change");
  });
});

describe("anonymous homepage sample brief rendering", () => {
  it("guards every proof label so a blank definition can never render", () => {
    for (const key of digestFieldKeys) {
      expect(marketingRoute).toContain(`sampleProofValue(demoProof.digestPreview.${key})`);
    }
  });

  it("renders the explicit unavailable state for empty source trails", () => {
    expect(marketingRoute).toContain("demoProof.proofTrail.length > 0");
    expect(marketingRoute).toContain("Not available in this sample");
    expect(marketingRoute).toContain("{SAMPLE_SOURCE_TRAIL_NOTE}");
  });

  it("labels source-trail sources instead of linking fake URLs", () => {
    expect(marketingRoute).toContain("sampleProofValue(item.signal)");
    expect(marketingRoute).toContain("sampleProofValue(item.evidence)");
    expect(marketingRoute).toContain("sampleProofValue(item.source)");
    expect(marketingRoute).not.toMatch(/href=["']https?:\/\//);
  });

  it("keeps the decision summary before the source trail in the reading order", () => {
    expect(marketingRoute.indexOf("Decision summary")).toBeLessThan(
      marketingRoute.indexOf("Source trail"),
    );
  });
});
