import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db, seedAd, seedRun, seedUser, seedWatchlist, uid } from "./fixtures";

const DOMAIN = "calendly.example";

function hexKey(day: string, hex: string, ext: "html" | "jpeg") {
  return `landing-pages/${day}/${hex}.${ext}`;
}

async function seedSnapshot(input: {
  canonicalUrl: string;
  headline: string;
  capturedAt: string;
  htmlHex: string;
  shotHex: string;
}) {
  return createLandingPageSnapshot(appEnv, {
    rawUrl: input.canonicalUrl,
    canonicalUrl: input.canonicalUrl,
    rawHeadline: input.headline,
    normalizedHeadline: input.headline.toLowerCase(),
    normalizedHeadlineHash: `hash_${input.headline}`,
    captureMethod: "landing_page_fetch",
    artifactKey: hexKey(input.capturedAt.slice(0, 10), input.htmlHex, "html"),
    metadata: {
      screenshotArtifactKey: hexKey(input.capturedAt.slice(0, 10), input.shotHex, "jpeg"),
      htmlArtifactKey: hexKey(input.capturedAt.slice(0, 10), input.htmlHex, "html"),
    },
    ctaText: input.headline.includes("Scaling Call") ? "Show more" : null,
    priceText: null,
    formPresent: false,
    capturedAt: input.capturedAt,
  });
}

/**
 * Brand-page attribution on a public Offer Timeline (issue #1729). A dated
 * offer state must be the brand's OWN landing page:
 *  1. a snapshot on a DIFFERENT registrable domain (another brand) is
 *     excluded — the existing canonical-domain gate,
 *  2. a snapshot on the SAME registrable domain but reached as an AD
 *     DESTINATION (e.g. an affiliate's booking page on a shared SaaS
 *     platform like calendly.com/adflex360/*) is excluded — the new
 *     ad-destination gate — because affiliates/partner ads belong on the ad
 *     wall, never on the offer timeline as the brand's offer,
 *  3. a same-brand snapshot of the brand's own page is included.
 * Applies the real migrations (mocked D1 cannot see the index or the LIKE
 * ESCAPE correlation) and asserts both the READ gate and the seeded WRITE.
 */
describe("timeline brand attribution against real D1", () => {
  it("includes the brand's own page and excludes a different-domain brand and a same-domain ad destination", async () => {
    const day = "2026-08-28";

    // The brand's own landing page — must be included.
    const brandSnapshotId = await seedSnapshot({
      canonicalUrl: `https://${DOMAIN}/`,
      headline: "Meeting Scheduling Software and AI Meeting Tools",
      capturedAt: `${day}T09:00:00.000Z`,
      htmlHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shotHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    // A DIFFERENT brand on a DIFFERENT registrable domain — must be excluded
    // by the registrable-domain gate.
    await seedSnapshot({
      canonicalUrl: `https://adflex.digital/offer`,
      headline: "Adflex Digital agency offer",
      capturedAt: `${day}T09:00:00.000Z`,
      htmlHex: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      shotHex: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    // An AD-DESTINATION snapshot on the SAME registrable domain: an
    // affiliate's Calendly booking subaccount page that merely shares the
    // brand's host. It passes the domain gate but must still be excluded as
    // an ad destination.
    const adDestinationSnapshotId = await seedSnapshot({
      canonicalUrl: `https://${DOMAIN}/adflex360/brand-scaling-call`,
      headline: "Brand Scaling Call - Adflex Digital",
      capturedAt: `${day}T09:00:00.000Z`,
      htmlHex: "cccccccccccccccccccccccccccccccc",
      shotHex: "cccccccccccccccccccccccccccccccc",
    });

    // Link the ad-destination snapshot to a stored ad (ad_id NOT NULL) — this
    // is exactly how an ad capture flows creates its landing_page_snapshot:
    // via ad_observation with a non-null ad_id.
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId);
    const adId = await seedAd();
    await db()
      .prepare(
        `INSERT INTO ad_observation (
           id, ad_id, watchlist_run_id, landing_page_snapshot_id, seen_at,
           is_active, landing_page_url, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, '{}', ?)`,
      )
      .bind(
        `ao_${uid("obs")}`,
        adId,
        runId,
        adDestinationSnapshotId,
        `${day}T09:00:00.000Z`,
        `https://${DOMAIN}/adflex360/brand-scaling-call`,
        `${day}T09:00:00.000Z`,
      )
      .run();

    const loaded = await loadOfferTimeline(appEnv, { domain: DOMAIN, asOf: null });

    expect(loaded.entries.map((entry) => entry.id)).toEqual([brandSnapshotId]);
    expect(loaded.entries[0]?.headline).toBe(
      "Meeting Scheduling Software and AI Meeting Tools",
    );
    expect(
      loaded.entries.some((entry) => entry.headline.includes("Adflex")),
    ).toBe(false);
  });

  it("keeps a same-domain non-ad brand page even when no cross-domain or ad rows exist", async () => {
    const isolatedDomain = `brandonly-${uid("dom")}.example`;
    const day = "2026-08-28";
    await seedSnapshot({
      canonicalUrl: `https://www.${isolatedDomain}/`,
      headline: "The World's Most Comfortable Shoes",
      capturedAt: `${day}T08:00:00.000Z`,
      htmlHex: "dddddddddddddddddddddddddddddddd",
      shotHex: "dddddddddddddddddddddddddddddddd",
    });

    const loaded = await loadOfferTimeline(appEnv, { domain: isolatedDomain, asOf: null });
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]?.headline).toBe("The World's Most Comfortable Shoes");
  });
});
