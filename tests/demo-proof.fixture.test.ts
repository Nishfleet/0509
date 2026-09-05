import { describe, expect, it } from "vitest";

import {
  demoProof,
  SAMPLE_FIELD_UNAVAILABLE,
  sampleField,
} from "~/lib/demo-proof";

// Truthfulness contract for the public sample brief fixture: every displayed
// proof field must carry a real fixture-backed value, and the sample source
// trail must stay link-free (the live product attaches capture links; a fake
// URL here would look like live evidence).
describe("demo proof fixture", () => {
  it("labels the whole fixture as sample-only", () => {
    expect(demoProof.status).toBe("sample_only");
    expect(demoProof.generatedAt).toBe("sample");
    expect(demoProof.summary.toLowerCase()).toContain("sample");
    expect(demoProof.trackedPreview.loop).toContain("Run the public search preview");
  });

  it("gives every decision-summary field a non-empty value", () => {
    const fields = [
      demoProof.digestPreview.subject,
      demoProof.digestPreview.whatChanged,
      demoProof.digestPreview.whyItMatters,
      demoProof.digestPreview.priority,
      demoProof.digestPreview.proofStatus,
      demoProof.digestPreview.source,
      demoProof.digestPreview.freshness,
      demoProof.digestPreview.recommendedMove,
    ];
    for (const field of fields) {
      expect(field.trim(), `decision summary field must be non-empty: "${field}"`).not.toBe("");
      expect(field).not.toBe(SAMPLE_FIELD_UNAVAILABLE);
    }
  });

  it("gives the competitor lead card non-empty values", () => {
    expect(demoProof.competitor.name.trim()).not.toBe("");
    expect(demoProof.competitor.website.trim()).not.toBe("");
    expect(demoProof.competitor.market.trim()).not.toBe("");
  });

  it("keeps the source trail populated with non-empty items and no fake URLs", () => {
    expect(demoProof.proofTrail.length).toBeGreaterThanOrEqual(3);
    for (const item of demoProof.proofTrail) {
      expect(item.signal.trim()).not.toBe("");
      expect(item.evidence.trim()).not.toBe("");
      expect(item.source.trim()).not.toBe("");
      expect(item.source).not.toMatch(/https?:\/\//i);
      expect(item.evidence).not.toMatch(/https?:\/\//i);
    }
  });

  it("keeps report and insight previews populated", () => {
    expect(demoProof.reportPreview.title.trim()).not.toBe("");
    expect(demoProof.reportPreview.rows.length).toBeGreaterThanOrEqual(1);
    for (const row of demoProof.reportPreview.rows) {
      expect(row.trim()).not.toBe("");
    }
    expect(demoProof.insightPreview.topHooks.length).toBeGreaterThanOrEqual(1);
    expect(demoProof.insightPreview.creativeTimeline.length).toBeGreaterThanOrEqual(1);
    expect(demoProof.insightPreview.mediaMix.length).toBeGreaterThanOrEqual(1);
    expect(demoProof.exports.digestMarkdown.trim()).not.toBe("");
  });

  it("never ships a URL-shaped link inside the sample fixture", () => {
    const serialized = JSON.stringify(demoProof);
    expect(serialized).not.toMatch(/https?:\/\//i);
  });
});

describe("sampleField", () => {
  it("returns the fixture value when present", () => {
    expect(sampleField("Nykaa moved the pricing page")).toBe(
      "Nykaa moved the pricing page",
    );
  });

  it("returns the explicit unavailable state for blank or missing values", () => {
    expect(sampleField("")).toBe(SAMPLE_FIELD_UNAVAILABLE);
    expect(sampleField("   ")).toBe(SAMPLE_FIELD_UNAVAILABLE);
    expect(sampleField(undefined)).toBe(SAMPLE_FIELD_UNAVAILABLE);
    expect(sampleField(null)).toBe(SAMPLE_FIELD_UNAVAILABLE);
  });
});
