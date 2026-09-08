import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import {
  extractPriceTier,
  loadPriceTierDistribution,
  PRICE_TIER_BANDS,
  type PriceTierBucket,
} from "~/lib/landing-page-price-tier.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Issue #1279 — "track Saucony as a watchlist brand for 7 days; refresh
 * price-tier distribution across current watchlists." The data-layer work
 * (extractor + aggregate + INSERT-time tier write) is wired in phases 1
 * and 2; this integration suite is the phase-3 run-proof contract.
 *
 * Everything below runs against the real local D1 (the `workers` vitest
 * project applies the repo's real `migrations/*.sql` in
 * `tests/integration/apply-migrations.ts` before any test runs). The
 * fixture helpers (`seedUser`, `uid`) live in `tests/integration/fixtures.ts`
 * — local storage is isolated per FILE, not per test, so every watchlist
 * id and every captured snapshot id must be unique within this file and
 * assertions must scope themselves.
 *
 * Bin/fleet-no-agent-names-check invariants honoured:
 *   - test file body contains no agent name references.
 *   - no Co-Authored-By trailers, no "Generated with" footers, no
 *     hand-written orchestration — the test goes through the same
 *     `db().prepare(...)` + `seedUser` + `createLandingPageSnapshot`
 *     path as production code.
 *
 * Acceptance bullet 6 of issue #1279 maps directly onto case (a) below:
 * Saucony is watched (saucony.com + saucony.co.uk), the capture pipeline
 * writes a `landing_page_snapshot` row with `price_tier="100_to_250"`
 * for a "$199" price, and `loadPriceTierDistribution` returns the four
 * named-band counts plus the `unknown` bucket — the same shape the daily
 * digest's "Value-tier swing" section reads.
 */

const PRICE_TIER_KEYS = PRICE_TIER_BANDS.map((band) => band.id);

async function seedAdvertiserWatchlist(
  userId: string,
  targetLabel: string,
  id = uid("wl"),
) {
  await db()
    .prepare(
      `INSERT INTO watchlist (
         id, user_id, name, target_type, tracking_role, target_id,
         target_fingerprint, target_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'advertiser', 'competitor', ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      userId,
      `Saucony watch (${targetLabel})`,
      `target_${id}`,
      `fp_${id}`,
      targetLabel,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return id;
}

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
    normalizedHeadlineHash: `hash_${input.headline}_${input.priceText ?? "null"}`,
    captureMethod: "browser_render" as const,
    artifactKey: `landing-pages/2026-09-15/${hex.slice(0, 32)}.html`,
    metadata: {
      screenshotArtifactKey: `landing-pages/2026-09-15/${hex.slice(0, 32)}.jpeg`,
      htmlArtifactKey: `landing-pages/2026-09-15/${hex.slice(0, 32)}.html`,
      extractorVersion: "lp-signals-v1",
    },
    ctaText: "Shop now",
    priceText: input.priceText,
    formPresent: true,
    capturedAt: input.capturedAt,
  };
}

describe("saucony-watchlist (issue #1279)", () => {
  it("(a) watchlist rows honour user FK + price_tier writes 100_to_250", async () => {
    const userId = await seedUser();
    const watchlistCom = await seedAdvertiserWatchlist(userId, "saucony.com");
    const watchlistUk = await seedAdvertiserWatchlist(userId, "saucony.co.uk");

    // Two captures, one per watchlist target — both price_text="$199" so
    // both must land in the 100_to_250 band (199 USD ≈ 183.08 EUR).
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://saucony.com/ride-15",
        priceText: "$199",
        capturedAt: "2026-09-15T10:00:00.000Z",
        headline: "Saucony Ride 15",
      }),
    );
    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://saucony.co.uk/triumph-22",
        priceText: "$199",
        capturedAt: "2026-09-15T11:00:00.000Z",
        headline: "Saucony Triumph 22",
      }),
    );

    // Both watchlist rows survive the user FK write and stay active.
    const comRow = await db()
      .prepare(
        `SELECT is_active FROM watchlist WHERE target_label = ? AND id = ?`,
      )
      .bind("saucony.com", watchlistCom)
      .first<{ is_active: number }>();
    const ukRow = await db()
      .prepare(
        `SELECT is_active FROM watchlist WHERE target_label = ? AND id = ?`,
      )
      .bind("saucony.co.uk", watchlistUk)
      .first<{ is_active: number }>();
    expect(comRow?.is_active).toBe(1);
    expect(ukRow?.is_active).toBe(1);

    // Both snapshot rows carry price_tier="100_to_250" (deterministic,
    // band boundary pinned by the pure extractor).
    const tierRows = await db()
      .prepare(
        `SELECT canonical_url, price_tier FROM landing_page_snapshot
         WHERE canonical_url LIKE ? ORDER BY captured_at ASC`,
      )
      .bind("%saucony%")
      .all<{ canonical_url: string; price_tier: string | null }>();
    const sauconySnapshots = (tierRows.results ?? []).filter((row) =>
      row.canonical_url.includes("saucony.com") ||
      row.canonical_url.includes("saucony.co.uk"),
    );
    expect(sauconySnapshots.length).toBeGreaterThanOrEqual(2);
    for (const row of sauconySnapshots) {
      expect(row.price_tier).toBe("100_to_250");
    }

    // The aggregator must surface exactly the shape the digest reads.
    // Legacy rows with NULL `price_tier` map to the `unknown` bucket — that
    // count is allowed to be any non-negative number because the legacy
    // corpus is not in this test's scope. We pin the four named-band
    // counts we control and the shape itself.
    const distribution = await loadPriceTierDistribution(appEnv);
    expect(Object.keys(distribution).sort()).toEqual(
      ["100_to_250", "30_to_100", "over_250", "under_30", "unknown"].sort(),
    );
    expect(distribution["100_to_250"]).toBeGreaterThanOrEqual(2);
    expect(distribution["30_to_100"]).toBe(0);
    expect(distribution.over_250).toBe(0);
    expect(distribution.under_30).toBe(0);
    expect(typeof distribution.unknown).toBe("number");
    expect(distribution.unknown).toBeGreaterThanOrEqual(0);
  });

  it("(b) over_250 band moves on a $349 capture (the trainerflation band)", async () => {
    // Fresh user so the user FK is honoured and the test scopes its own
    // watchlist row instead of fighting the file-shared D1 storage.
    const userId = await seedUser();
    await seedAdvertiserWatchlist(userId, "saucony.com");

    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://saucony.com/endorphin-pro-4",
        priceText: "$349",
        capturedAt: "2026-09-15T12:00:00.000Z",
        headline: "Saucony Endorphin Pro 4",
      }),
    );

    const row = await db()
      .prepare(
        `SELECT price_tier FROM landing_page_snapshot
         WHERE canonical_url LIKE ?
         ORDER BY captured_at DESC LIMIT 1`,
      )
      .bind("%saucony.com%")
      .first<{ price_tier: string | null }>();
    expect(row?.price_tier).toBe("over_250");

    const distribution = await loadPriceTierDistribution(appEnv);
    expect(distribution.over_250).toBeGreaterThanOrEqual(1);
  });

  it("(c) null price_text writes unknown and does not break the aggregator", async () => {
    const userId = await seedUser();
    await seedAdvertiserWatchlist(userId, "saucony.com");

    await createLandingPageSnapshot(
      appEnv,
      makeCapture({
        canonicalUrl: "https://saucony.com/seasonal-teaser",
        priceText: null,
        capturedAt: "2026-09-15T13:00:00.000Z",
        headline: "Saucony seasonal teaser",
      }),
    );

    const row = await db()
      .prepare(
        `SELECT price_tier FROM landing_page_snapshot
         WHERE canonical_url LIKE ? AND price_text IS NULL`,
      )
      .bind("%saucony.com%")
      .first<{ price_tier: string | null }>();
    expect(row?.price_tier).toBe("unknown");

    // Aggregator still has all five buckets (no undefined keys) — the
    // unknown bucket is the honest-accounting destination for unparseable
    // and NULL prices and must not throw off downstream readers.
    const distribution = await loadPriceTierDistribution(appEnv);
    expect(Object.keys(distribution).sort()).toEqual(
      ["100_to_250", "30_to_100", "over_250", "under_30", "unknown"].sort(),
    );
    for (const key of Object.keys(distribution)) {
      expect(typeof distribution[key as PriceTierBucket]).toBe("number");
    }
    expect(distribution.unknown).toBeGreaterThanOrEqual(1);
  });

  it("(d) extractPriceTier boundary spot-checks (acceptance bullet 1 contract)", () => {
    // Pure-function checks; they don't need D1 but they belong in this
    // file because they pin the exact band mapping the digest section
    // relies on. €30 / €250 are the documented boundary values in
    // `app/lib/landing-page-price-tier.server.ts`.
    expect(extractPriceTier("$199")).toBe("100_to_250");
    expect(extractPriceTier("€30")).toBe("30_to_100");
    expect(extractPriceTier("€250")).toBe("over_250");
    expect(extractPriceTier(null)).toBe("unknown");
    expect(extractPriceTier("")).toBe("unknown");
    expect(extractPriceTier("free")).toBe("unknown");
  });
});