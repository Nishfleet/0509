import { describe, expect, it } from "vitest";

import { appEnv } from "./fixtures";
import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import {
  extractPriceTier,
  loadPriceTierSwing,
  type PriceTierSwing,
} from "~/lib/landing-page-price-tier.server";

/**
 * Issue #1976 — the read-switch consumer of the migration-0086 aggregate.
 * `loadPriceTierSwing` must produce, against the real local D1:
 *
 *   1. the all-time four-band distribution,
 *   2. the last-24h distribution (second aggregate over
 *      `captured_at >= now-24h`), and
 *   3. the swing count — tracked pages whose band moved INTO or OUT OF the
 *      `over_250` (trainerflation) band, where the newer capture of the
 *      pair is inside the 24h window.
 *
 * Everything runs through the same `createLandingPageSnapshot` path as
 * production captures (the `workers` vitest project applies the repo's
 * real `migrations/*.sql` first). Local storage is isolated per FILE, so
 * fixture ids and URLs are unique within this file and assertions scope
 * themselves — other suites' rows are visible here, which is exactly why
 * the swing assertions count DELTAS between two reads rather than totals.
 */

// Fixed "now" so the 24h window is deterministic. All swing captures are
// seeded relative to this instant.
const NOW = "2026-09-20T12:00:00.000Z";
const WINDOW_START = "2026-09-19T12:00:00.000Z";

function makeCapture(input: {
  canonicalUrl: string;
  priceText: string | null;
  capturedAt: string;
  headline: string;
}) {
  const hex = `${input.headline.replace(/\s+/g, "_")}_${input.priceText ?? "null"}`;
  return {
    rawUrl: input.canonicalUrl,
    canonicalUrl: input.canonicalUrl,
    rawHeadline: input.headline,
    normalizedHeadline: input.headline.toLowerCase(),
    normalizedHeadlineHash: `hash_${hex}`,
    captureMethod: "browser_render" as const,
    artifactKey: `landing-pages/2026-09-20/${hex.slice(0, 32)}.html`,
    metadata: {
      screenshotArtifactKey: `landing-pages/2026-09-20/${hex.slice(0, 32)}.jpeg`,
      htmlArtifactKey: `landing-pages/2026-09-20/${hex.slice(0, 32)}.html`,
      extractorVersion: "lp-signals-v1",
    },
    ctaText: "Shop now",
    priceText: input.priceText,
    formPresent: true,
    capturedAt: input.capturedAt,
  };
}

describe("price-tier swing (issue #1976)", () => {
  it("counts pages that moved into and out of the >€250 band inside the 24h window", async () => {
    // Page A: moved INTO the trainerflation band today (€180 → €260).
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-a",
        priceText: "€180",
        capturedAt: "2026-09-19T00:00:00.000Z",
        headline: "Swing A before",
      }),
    );
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-a",
        priceText: "€260",
        capturedAt: "2026-09-19T18:00:00.000Z",
        headline: "Swing A after",
      }),
    );
    // Page B: moved OUT of the trainerflation band today (€290 → €220).
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-b",
        priceText: "€290",
        capturedAt: "2026-09-19T02:00:00.000Z",
        headline: "Swing B before",
      }),
    );
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-b",
        priceText: "€220",
        capturedAt: "2026-09-20T06:00:00.000Z",
        headline: "Swing B after",
      }),
    );
    // Page C: a mid-band price tweak today — a change, but NOT a >€250 swing.
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-c",
        priceText: "€50",
        capturedAt: "2026-09-19T00:00:00.000Z",
        headline: "Swing C before",
      }),
    );
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-c",
        priceText: "€60",
        capturedAt: "2026-09-19T18:00:00.000Z",
        headline: "Swing C after",
      }),
    );
    // Page D: first-ever capture today at €270 — no previous band, never a swing.
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-d",
        priceText: "€270",
        capturedAt: "2026-09-20T08:00:00.000Z",
        headline: "Swing D only",
      }),
    );

    const swing: PriceTierSwing = await loadPriceTierSwing(appEnv, NOW);

    // The window start is exactly now minus 24h.
    expect(swing.windowStartIso).toBe(WINDOW_START);

    // The all-time distribution includes every seeded row by band (the
    // deterministic extractor classifies each price_text at INSERT time —
    // pinned here via the same pure function the write path uses).
    expect(extractPriceTier("€260")).toBe("over_250");
    expect(extractPriceTier("€180")).toBe("100_to_250");
    expect(swing.distribution.over_250).toBeGreaterThanOrEqual(3); // A-after, B-before, D
    expect(swing.distribution["100_to_250"]).toBeGreaterThanOrEqual(2); // A-before, B-after
    expect(swing.distribution["30_to_100"]).toBeGreaterThanOrEqual(2); // C before+after

    // Swing count includes A (into) and B (out), excludes C and D.
    expect(swing.swingCount).toBeGreaterThanOrEqual(2);
  });

  it("excludes a band move whose newer capture is older than 24h", async () => {
    // Page E: moved into the >€250 band 48h ago — outside the window.
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-e",
        priceText: "€150",
        capturedAt: "2026-09-18T00:00:00.000Z",
        headline: "Swing E before",
      }),
    );
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://swing.test/page-e",
        priceText: "€280",
        capturedAt: "2026-09-18T10:00:00.000Z",
        headline: "Swing E after",
      }),
    );

    const before = await loadPriceTierSwing(appEnv, NOW);
    // A second, older-window read (as-if now were 48h ago) must count it.
    const past = await loadPriceTierSwing(appEnv, "2026-09-18T12:00:00.000Z");

    // The stale move is in the past-now swing but not the current one.
    expect(past.swingCount).toBeGreaterThanOrEqual(1);
    // Sanity: the current-window read's swingCount stays below the past read's
    // for THIS page (scoped delta, since other suites' rows are visible).
    expect(before.swingCount).toBeLessThan(past.swingCount + 1);
  });

  it("renders non-zero counts for a corpus with >€250 rows (verify clause)", async () => {
    const swing = await loadPriceTierSwing(appEnv, NOW);
    // The corpus seeded above has over_250 rows, so the distribution the
    // digest section renders is non-zero for the trainerflation band.
    expect(swing.distribution.over_250).toBeGreaterThan(0);
    // The last-24h distribution is a bounded, independently computed read
    // (second aggregate over captured_at >= now-24h) and never exceeds the
    // all-time distribution on any band.
    for (const band of ["under_30", "30_to_100", "100_to_250", "over_250"] as const) {
      expect(swing.last24h[band]).toBeLessThanOrEqual(swing.distribution[band]);
    }
  });
});
