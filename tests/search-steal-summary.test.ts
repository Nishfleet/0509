import { describe, expect, it, vi } from "vitest";

import {
  buildSearchStealSummary,
  buildStealSummaryAdLines,
  NO_OFFERS_STEAL_LINE,
  shouldGenerateStealSummary,
  STEAL_SUMMARY_MODEL,
  validateStealBullets,
} from "~/lib/search-steal-summary.server";
import type { AdRecord } from "~/lib/types";

const NOW = new Date("2026-07-19T00:00:00.000Z");

function makeAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "meta-1",
    advertiser: "SecretBrandCo",
    body: "Secret body copy that must never reach the model",
    previewHeadline: "Preview headline",
    previewSubhead: "Preview subhead",
    hook: "Bass bhi. Battery bhi.",
    offer: "Launch pricing",
    cta: "Buy now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://secret.example.com/lp",
    adSnapshotUrl: "https://cdn.example.com/meta-1.png",
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: "2026-05-15T00:00:00.000Z",
    lastSeenAt: null,
    active: true,
    researchSummary: "Secret research summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function threeAds(): AdRecord[] {
  return [
    makeAd({ metaAdId: "meta-1", variantCount: 3 }),
    makeAd({ metaAdId: "meta-2", hook: "60 hours playback", offer: "", cta: "Shop now" }),
    makeAd({ metaAdId: "meta-3", hook: "Battery that lasts", firstSeenAt: null }),
  ];
}

describe("buildStealSummaryAdLines", () => {
  it("includes only hook, offer, cta, running days, variants, and format", () => {
    const lines = buildStealSummaryAdLines(threeAds(), NOW);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "Ad 1 | hook: Bass bhi. Battery bhi. | offer: Launch pricing | cta: Buy now | running: 65 days | variants: 3 | format: image",
    );
    // Disallowed fields never leak into the prompt.
    const joined = lines.join("\n");
    expect(joined).not.toContain("SecretBrandCo");
    expect(joined).not.toContain("Secret body copy");
    expect(joined).not.toContain("secret.example.com");
    expect(joined).not.toContain("Preview headline");
    expect(joined).not.toContain("Secret research summary");
  });

  it("marks missing offers and unknown longevity honestly", () => {
    const lines = buildStealSummaryAdLines(threeAds(), NOW);

    expect(lines[1]).toContain("offer: none");
    expect(lines[1]).not.toContain("variants:");
    expect(lines[2]).toContain("running: unknown");
  });

  it("caps the prompt at 8 ads", () => {
    const ads = Array.from({ length: 12 }, (_value, index) =>
      makeAd({ metaAdId: `meta-${index}` }),
    );
    expect(buildStealSummaryAdLines(ads, NOW)).toHaveLength(8);
  });
});

describe("validateStealBullets", () => {
  const corpus = [
    "Ads analyzed: 3",
    ...buildStealSummaryAdLines(threeAds(), NOW),
  ].join("\n");

  it("accepts exactly 3 grounded bullets", () => {
    const raw = [
      "- Every hook leads with battery claims",
      "- Bass bhi. Battery bhi. has run 65 days with 3 variants",
      "- Buy now is the CTA across the ads",
    ].join("\n");

    expect(validateStealBullets(raw, corpus)).toEqual([
      "Every hook leads with battery claims",
      "Bass bhi. Battery bhi. has run 65 days with 3 variants",
      "Buy now is the CTA across the ads",
    ]);
  });

  it("accepts the honest no-offers fallback bullet", () => {
    const raw = [
      "- Battery claims dominate the hooks",
      "- Bass bhi. Battery bhi. has run 65 days",
      `- ${NO_OFFERS_STEAL_LINE}`,
    ].join("\n");

    expect(validateStealBullets(raw, corpus)?.[2]).toBe(NO_OFFERS_STEAL_LINE);
  });

  it("rejects a fabricated number not present in the input", () => {
    const raw = [
      "- Every hook leads with battery claims",
      "- Bass bhi. Battery bhi. has run 90 days",
      "- Buy now is the CTA across the ads",
    ].join("\n");

    expect(validateStealBullets(raw, corpus)).toBeNull();
  });

  it("rejects a fabricated brand name not present in the input", () => {
    const raw = [
      "- Every hook mimics the Nykaa playbook",
      "- Bass bhi. Battery bhi. has run 65 days",
      "- Buy now is the CTA across the ads",
    ].join("\n");

    expect(validateStealBullets(raw, corpus)).toBeNull();
  });

  it("exempts only the sentence-initial capitalized word", () => {
    const raw = [
      "- Urgency drives every hook",
      "- Bass bhi. Battery bhi. has run 65 days",
      "- Shop now and Buy now are the two ctas",
    ].join("\n");

    // "Urgency" leads its bullet (style, not a claim); "Shop"/"Buy" appear in
    // the input ctas.
    expect(validateStealBullets(raw, corpus)).not.toBeNull();
  });

  it("rejects bullets over 140 characters", () => {
    const raw = [
      `- ${"battery ".repeat(20)}claims`,
      "- Bass bhi. Battery bhi. has run 65 days",
      "- Buy now is the CTA across the ads",
    ].join("\n");

    expect(validateStealBullets(raw, corpus)).toBeNull();
  });

  it("rejects output without exactly 3 bullets", () => {
    expect(
      validateStealBullets("- one battery hook\n- Buy now everywhere", corpus),
    ).toBeNull();
    expect(
      validateStealBullets(
        "- battery\n- battery\n- battery\n- battery",
        corpus,
      ),
    ).toBeNull();
    expect(validateStealBullets("Plain prose, no bullets at all.", corpus)).toBeNull();
  });

  it("ignores non-bullet preamble lines but rejects prompt echoes", () => {
    const preambled = [
      "Here are the takeaways:",
      "- Every hook leads with battery claims",
      "- Bass bhi. Battery bhi. has run 65 days",
      "- Buy now is the CTA across the ads",
    ].join("\n");
    expect(validateStealBullets(preambled, corpus)).toHaveLength(3);

    const echoed = [
      "- Every hook leads with battery claims",
      "- Bass bhi. Battery bhi. has run 65 days",
      "- As an AI I wrote exactly 3 bullets",
    ].join("\n");
    expect(validateStealBullets(echoed, corpus)).toBeNull();
  });
});

describe("shouldGenerateStealSummary", () => {
  const freshResult = {
    ads: threeAds(),
    cacheStatus: "miss" as const,
    source: "meta_library_browser" as const,
  };

  it("requires a signed-in user", () => {
    expect(shouldGenerateStealSummary({ isSignedIn: false, result: freshResult })).toBe(false);
    expect(shouldGenerateStealSummary({ isSignedIn: true, result: freshResult })).toBe(true);
  });

  it("requires at least 3 ads", () => {
    expect(
      shouldGenerateStealSummary({
        isSignedIn: true,
        result: { ...freshResult, ads: freshResult.ads.slice(0, 2) },
      }),
    ).toBe(false);
  });

  it("skips cache-served and external results", () => {
    expect(
      shouldGenerateStealSummary({
        isSignedIn: true,
        result: { ...freshResult, cacheStatus: "hit" },
      }),
    ).toBe(false);
    expect(
      shouldGenerateStealSummary({
        isSignedIn: true,
        result: { ...freshResult, cacheStatus: "stale" },
      }),
    ).toBe(false);
    expect(
      shouldGenerateStealSummary({
        isSignedIn: true,
        result: { ...freshResult, source: "external" },
      }),
    ).toBe(false);
  });
});

describe("buildSearchStealSummary", () => {
  it("returns 3 validated bullets from the model response", async () => {
    const run = vi.fn().mockResolvedValue({
      response: [
        "- Every hook leads with battery claims",
        "- Bass bhi. Battery bhi. has run 65 days with 3 variants",
        "- Buy now is the CTA across the ads",
      ].join("\n"),
    });

    const summary = await buildSearchStealSummary(
      { AI: { run } } as never,
      threeAds(),
      { now: NOW },
    );

    expect(summary).toEqual({
      bullets: [
        "Every hook leads with battery claims",
        "Bass bhi. Battery bhi. has run 65 days with 3 variants",
        "Buy now is the CTA across the ads",
      ],
    });
    expect(run).toHaveBeenCalledTimes(1);
    const [model, payload] = run.mock.calls[0] as [string, { messages: Array<{ content: string }> }];
    expect(model).toBe(STEAL_SUMMARY_MODEL);
    const userMessage = payload.messages[1]?.content ?? "";
    expect(userMessage).toContain("running: 65 days");
    expect(userMessage).not.toContain("SecretBrandCo");
    expect(userMessage).not.toContain("secret.example.com");
  });

  it("returns null when the model fabricates ungrounded content", async () => {
    const run = vi.fn().mockResolvedValue({
      response: [
        "- Copy the Nykaa festive angle",
        "- Bass bhi. Battery bhi. has run 65 days",
        "- Buy now is the CTA across the ads",
      ].join("\n"),
    });

    expect(
      await buildSearchStealSummary({ AI: { run } } as never, threeAds(), { now: NOW }),
    ).toBeNull();
  });

  it("returns null on AI errors, missing binding, or too few ads", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("model unavailable"));
    expect(
      await buildSearchStealSummary({ AI: { run: failing } } as never, threeAds(), { now: NOW }),
    ).toBeNull();

    expect(await buildSearchStealSummary({} as never, threeAds(), { now: NOW })).toBeNull();

    const run = vi.fn();
    expect(
      await buildSearchStealSummary({ AI: { run } } as never, threeAds().slice(0, 2), {
        now: NOW,
      }),
    ).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
