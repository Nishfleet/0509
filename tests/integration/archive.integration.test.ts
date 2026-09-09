import { describe, expect, it } from "vitest";

import {
  loadPublicDomainArchive,
  loadWatchlistArchive,
} from "~/lib/archive.server";
import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import { createWatchEvent } from "~/lib/data/watch-events.server";
import { getWatchlist } from "~/lib/data/watchlists-core.server";

import { appEnv, db, seedRun, seedUser, seedWatchlist, uid } from "./fixtures";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function hexKey(day: string, hex: string, ext: "html" | "jpeg") {
  return `landing-pages/${day}/${hex}.${ext}`;
}

async function seedSnapshot(input: {
  canonicalUrl: string;
  headline: string;
  ctaText: string;
  priceText: string;
  capturedAt: string;
  htmlKey: string;
  screenshotKey: string;
}) {
  return createLandingPageSnapshot(appEnv, {
    rawUrl: input.canonicalUrl,
    canonicalUrl: input.canonicalUrl,
    rawHeadline: input.headline,
    normalizedHeadline: input.headline.toLowerCase(),
    normalizedHeadlineHash: `hash_${input.headline}`,
    captureMethod: "landing_page_fetch",
    artifactKey: input.htmlKey,
    metadata: { screenshotArtifactKey: input.screenshotKey, htmlArtifactKey: input.htmlKey },
    ctaText: input.ctaText,
    priceText: input.priceText,
    formPresent: true,
    capturedAt: input.capturedAt,
  });
}

async function seedAdForDomain(domain: string, id: string) {
  await db()
    .prepare(
      `INSERT INTO ad (
         id, advertiser, body, preview_headline, preview_subhead, hook,
         offer_text, cta, creative_format, language_label, destination_type,
         landing_page_url, countries_json, platforms_json, first_seen_at,
         last_seen_at, is_active, source, research_summary, raw_json,
         created_at, updated_at
       ) VALUES (?, ?, 'body', ?, 'subhead', 'hook',
         'offer', 'cta', 'image', 'en', 'website',
         ?, '[]', '[]', ?,
         ?, 1, 'meta', 'summary', '{}', ?, ?)`,
    )
    .bind(
      id,
      `Advertiser ${id}`,
      `Headline ${id}`,
      `https://${domain}/offer`,
      "2026-08-01T00:00:00.000Z",
      "2026-09-08T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "2026-09-08T00:00:00.000Z",
    )
    .run();
  return id;
}

/**
 * The proof archive's query layer (issue #2173) against real D1: the public
 * domain read must apply the same honesty gates as the offer timeline and
 * never carry workspace-private rows; the watchlist read must return
 * everything the account captured. Mocked D1 cannot see the LIKE ESCAPE
 * domain matching, the ad_observation join, or the GROUP BY tenure rollup.
 */
describe("proof archive against real D1", () => {
  it("public archive: ledger rows + ad tenure, proof gate intact, no private rows", async () => {
    const domain = `archpub-${uid("dom")}.example`;
    const day1 = "2026-08-01";
    const day2 = "2026-08-10";
    await seedSnapshot({
      canonicalUrl: `https://${domain}/`,
      headline: "Glow serum",
      ctaText: "Shop now",
      priceText: "₹499",
      capturedAt: `${day1}T10:00:00.000Z`,
      htmlKey: hexKey(day1, "aaaaaaa1aaaaaaaaaaaaaaaaaaaaaaa1", "html"),
      screenshotKey: hexKey(day1, "aaaaaaa1aaaaaaaaaaaaaaaaaaaaaaa1", "jpeg"),
    });
    await seedSnapshot({
      canonicalUrl: `https://${domain}/`,
      headline: "Glow serum",
      ctaText: "Get the kit",
      priceText: "₹799",
      capturedAt: `${day2}T10:00:00.000Z`,
      htmlKey: hexKey(day2, "bbbbbbb2bbbbbbbbbbbbbbbbbbbbbbb2", "html"),
      screenshotKey: hexKey(day2, "bbbbbbb2bbbbbbbbbbbbbbbbbbbbbbb2", "jpeg"),
    });
    // A proof-less row (no artifacts) must stay out of the public archive.
    await db()
      .prepare(
        `INSERT INTO landing_page_snapshot (
          id, raw_url, canonical_url, raw_headline, normalized_headline,
          normalized_headline_hash, capture_method, artifact_key, metadata_json,
          cta_text, price_text, form_present, ocr_text, translated_text,
          captured_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'demo_backfill', NULL, '{"backfill":true}', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(
        `proofless-${domain}`,
        `https://${domain}/`,
        `https://${domain}/`,
        "Seeded state",
        "seeded state",
        `proofless-hash-${domain}`,
        "2026-08-05T10:00:00.000Z",
        "2026-08-05T10:00:00.000Z",
      )
      .run();
    await seedAdForDomain(domain, uid("ad"));

    const loaded = await loadPublicDomainArchive(appEnv, { domain, asOf: null, now: NOW });

    // The ledger kept both proof-complete states; the proof-less row is gone.
    expect(loaded.entries).toHaveLength(2);

    const { archive } = loaded;
    // Every public row is offer-ledger sourced; nothing watch-event sourced
    // can exist on the public side, and no account-scoped status rides along.
    expect(archive.entries.length).toBeGreaterThan(0);
    expect(archive.entries.every((entry) => entry.source === "offer_ledger")).toBe(true);
    expect(archive.entries.every((entry) => entry.eventStatus === null)).toBe(true);
    // The CTA change row carries its mark, band, capture method and receipts.
    const ctaChange = archive.entries.find((entry) => entry.fieldLabel === "CTA");
    expect(ctaChange?.changeMark).toEqual({ from: "Shop now", to: "Get the kit" });
    expect(ctaChange?.criticality?.band).toBe("material");
    expect(ctaChange?.captureMethod).toBe("landing_page_fetch");
    expect(ctaChange?.beforeScreenshotHref?.startsWith("/artifacts/proof/")).toBe(true);
    expect(ctaChange?.afterScreenshotHref?.startsWith("/artifacts/proof/")).toBe(true);
    // Gap honesty reads ALL capture times, including the proof-less row's:
    // 1st→5th and 5th→10th both exceed the 3-day cadence tolerance, so the
    // archive shows both holes instead of smoothing the 1st→10th span.
    expect(archive.gaps).toEqual([
      { from: "2026-08-01T10:00:00.000Z", to: "2026-08-05T10:00:00.000Z", days: 4 },
      { from: "2026-08-05T10:00:00.000Z", to: "2026-08-10T10:00:00.000Z", days: 5 },
    ]);
    // Per-ad tenure is a public-ad fact: first seen / last seen / running days.
    expect(archive.adTenure).toHaveLength(1);
    expect(archive.adTenure[0]?.runningDays).toBe(39);
    expect(archive.adTenure[0]?.firstSeenLabel).toBe("1 Aug 2026");
    // Offer history series per landing page.
    expect(archive.offerHistory).toHaveLength(1);
    expect(archive.offerHistory[0]?.points.map((point) => point.priceText)).toEqual([
      "₹499",
      "₹799",
    ]);
  });

  it("watchlist archive: everything the account captured, status and all", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { startedAt: "2026-09-01T04:00:00.000Z" });
    const laterRunId = await seedRun(watchlistId, { startedAt: "2026-09-08T04:00:00.000Z" });

    const domain = `archpriv-${uid("dom")}.example`;
    const snapshotId = await seedSnapshot({
      canonicalUrl: `https://${domain}/`,
      headline: "Watched offer",
      ctaText: "Buy",
      priceText: "₹299",
      capturedAt: "2026-09-01T04:05:00.000Z",
      htmlKey: hexKey("2026-09-01", "ccccccc3ccccccccccccccccccccc3", "html"),
      screenshotKey: hexKey("2026-09-01", "ccccccc3ccccccccccccccccccccc3", "jpeg"),
    });
    const adId = await seedAdForDomain(domain, uid("ad"));
    // Link the snapshot and the ad to this watchlist's run.
    await db()
      .prepare(
        `INSERT INTO ad_observation (
           id, ad_id, watchlist_run_id, landing_page_snapshot_id, seen_at,
           is_active, landing_page_url, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, '{}', ?)`,
      )
      .bind(
        uid("obs"),
        adId,
        runId,
        snapshotId,
        "2026-09-01T04:05:00.000Z",
        `https://${domain}/offer`,
        "2026-09-01T04:05:00.000Z",
      )
      .run();

    await createWatchEvent(appEnv, {
      watchlistId,
      runId: laterRunId,
      eventType: "landing_page_cta_changed",
      adId: null,
      baselineFromRunId: null,
      title: "CTA changed",
      summary: "The call to action changed.",
      // capturedAt pins the archive row's date so the month-summary assertion
      // below is independent of the wall clock the test runs on.
      metadata: {
        from: "Buy",
        to: "Get it now",
        landingPageUrl: `https://${domain}/`,
        capturedAt: "2026-09-08T04:05:00.000Z",
      },
    });

    const watchlist = await getWatchlist(appEnv, watchlistId, userId);
    expect(watchlist).not.toBeNull();
    const archive = await loadWatchlistArchive(appEnv, { watchlist: watchlist!, now: NOW });

    // The watch event is present with its account-scoped status — the
    // private side shows everything the account captured.
    const eventEntry = archive.entries.find((entry) => entry.source === "watch_event");
    expect(eventEntry).toBeDefined();
    expect(eventEntry?.eventStatus).toBe("confirmed");
    expect(eventEntry?.changeMark).toEqual({ from: "Buy", to: "Get it now" });
    expect(eventEntry?.criticality?.band).toBe("material");
    // The run-linked snapshot became the ledger's first capture.
    const firstCapture = archive.entries.find((entry) => entry.kind === "first_capture");
    expect(firstCapture?.source).toBe("offer_ledger");
    expect(firstCapture?.captureMethod).toBe("landing_page_fetch");
    // Run cadence drives gap honesty: two runs a week apart → one gap.
    expect(archive.gaps).toEqual([
      { from: "2026-09-01T04:00:00.000Z", to: "2026-09-08T04:00:00.000Z", days: 7 },
    ]);
    // Tenure from the observed ad.
    expect(archive.adTenure).toHaveLength(1);
    expect(archive.adTenure[0]?.runningDays).toBe(39);
    // The month summary covers September captures.
    expect(archive.monthSummary?.monthKey).toBe("2026-09");
    expect(archive.monthSummary?.changeCount).toBeGreaterThan(0);
  });

  it("returns an empty archive for a watchlist with no captures", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const watchlist = await getWatchlist(appEnv, watchlistId, userId);
    const archive = await loadWatchlistArchive(appEnv, { watchlist: watchlist!, now: NOW });
    expect(archive.entries).toEqual([]);
    expect(archive.gaps).toEqual([]);
    expect(archive.adTenure).toEqual([]);
    expect(archive.monthSummary).toBeNull();
  });
});
