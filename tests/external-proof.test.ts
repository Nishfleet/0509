import { describe, expect, it } from "vitest";

import { buildExternalProofAd } from "~/lib/external-proof.server";

describe("external proof builder", () => {
  it("turns a manual cross-channel proof link into saved evidence", () => {
    const ad = buildExternalProofAd(
      {
        advertiser: "Mamaearth",
        proofUrl: "https://www.linkedin.com/posts/mamaearth-campaign#comments",
        channel: "LinkedIn",
        hook: "Creator-led sunscreen routine",
        offer: "Combo launch",
        cta: "Shop now",
        note: "Seen in the competitor launch review.",
        observedAt: "2026-06-06",
      },
      new Date("2026-06-06T10:00:00.000Z"),
    );

    expect(ad).toMatchObject({
      metaAdId: expect.stringMatching(/^external:linkedin:fnv1a-/),
      advertiser: "Mamaearth",
      hook: "Creator-led sunscreen routine",
      offer: "Combo launch",
      cta: "Shop now",
      source: "external",
      format: "unknown",
      platforms: ["LinkedIn"],
      landingPageUrl: null,
      adSnapshotUrl: null,
      firstSeenAt: "2026-06-06T00:00:00.000Z",
      lastSeenAt: null,
      active: false,
      tags: ["LinkedIn", "manual proof"],
      creativeText: null,
      creativeTextCaptureMethod: null,
    });
    expect(ad.analysisFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldKey: "channel", fieldValue: "LinkedIn" }),
        expect.objectContaining({
          fieldKey: "proof_url",
          fieldValue: "https://www.linkedin.com/posts/mamaearth-campaign#comments",
        }),
      ]),
    );
  });

  it("does not invent optional offer or CTA evidence", () => {
    const ad = buildExternalProofAd(
      {
        advertiser: "Nykaa",
        proofUrl: "https://www.tiktok.com/@nykaa/video/123",
        channel: "TikTok",
        hook: "Routine-first creator hook",
      },
      new Date("2026-06-06T10:00:00.000Z"),
    );

    expect(ad.offer).toBe("");
    expect(ad.cta).toBe("");
    expect(ad.format).toBe("unknown");
    expect(ad.landingPageUrl).toBeNull();
    expect(ad.analysisFields).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ fieldKey: "offer" }),
        expect.objectContaining({ fieldKey: "cta" }),
      ]),
    );
  });
});
