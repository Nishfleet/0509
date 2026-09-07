import { describe, expect, it } from "vitest";

import { TIMELINE_SNAPSHOT_LIMIT } from "~/lib/offer-timeline.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";
import { loadIndexableTimelineEntries } from "~/lib/sitemap.server";

import { appEnv, db, seedAd, seedRun, seedUser, seedWatchlist } from "./fixtures";

/**
 * Issue #1928: sitemap parity invariant on real D1.
 *
 * The sitemap timeline lister (`loadIndexableTimelineEntries`) and the public
 * route loader (`loadOfferTimeline`) must agree on the renderable set:
 * every domain the lister emits must render a non-empty ledger when the
 * loader is called for that domain, and every domain whose loader returns
 * an empty ledger must NOT be listed. A 410 in the sitemap is a soft-404
 * shell to Google — exactly the BET 3 moat failure mode §1.6 names.
 *
 * This suite applies the real migrations and seeds the per-domain row shapes
 * that decide each invariant. Mocked bindings cannot see the row window or
 * the loader's `ORDER BY ... ASC LIMIT 200` query plan, so a unit test on
 * `indexableTimelineEntriesFromRows` (tests/sitemap.server.test.ts) is the
 * filter-shape gate; this file is the read-plan + read-shape gate.
 */

const FILE_TAG = "ts-parity-1928";

function hexKey(day: string, hex: string, ext: "html" | "jpeg") {
  return `landing-pages/${day}/${hex}.${ext}`;
}

/** Day index -> captured_at ISO (one capture per day, deterministic). */
function dayIso(dayIndex: number): string {
  // 2026-01-01 + dayIndex days, 12:00 UTC (the lister's ORDER BY captured_at
  // ASC puts day 0 first; loadOfferTimeline reads the same ASC window).
  const baseMs = Date.UTC(2026, 0, 1, 12, 0, 0);
  return new Date(baseMs + dayIndex * 86_400_000).toISOString();
}

function dayTag(dayIndex: number): string {
  return dayIso(dayIndex).slice(0, 10);
}

interface SeedOptions {
  /** Number of OLDEST proof-less backfill rows to seed (filled the window). */
  backfillInWindow?: number;
  /** Number of NEWER proof-complete rows past the window (or anywhere). */
  passingRows?: number;
  /** If true, every passing row is marked as ad-destination. */
  adDestination?: boolean;
}

async function seedDomain(
  domain: string,
  options: SeedOptions,
): Promise<{ passingCount: number; backfillCount: number }> {
  const stmt = db().prepare(
    `INSERT INTO landing_page_snapshot (
       id, raw_url, canonical_url, raw_headline, normalized_headline,
       normalized_headline_hash, capture_method, artifact_key, metadata_json,
       cta_text, price_text, form_present, ocr_text, translated_text,
       captured_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  );

  let backfillCount = 0;
  let passingCount = 0;

  for (let i = 0; i < (options.backfillInWindow ?? 0); i += 1) {
    const day = dayTag(i);
    const dayMs = dayIso(i);
    const id = `${FILE_TAG}-${domain}-bf-${i.toString().padStart(4, "0")}`;
    const canonicalUrl = `https://www.${domain}/landing`;
    const headline = `Backfill ${domain} day ${i}`;
    await stmt
      .bind(
        id,
        canonicalUrl,
        canonicalUrl,
        headline,
        headline.toLowerCase(),
        `hash-bf-${domain}-${i}`,
        "demo_backfill",
        null,
        JSON.stringify({ backfill: true, source: "demo_brand_seed" }),
        null,
        null,
        null,
        dayMs,
        dayMs,
      )
      .run();
    backfillCount += 1;
  }

  for (let i = 0; i < (options.passingRows ?? 0); i += 1) {
    // Place passing rows AFTER the backfill rows so they sit past the loader
    // window when the backfill count exceeds TIMELINE_SNAPSHOT_LIMIT.
    const dayOffset =
      (options.backfillInWindow ?? 0) + i;
    const day = dayTag(dayOffset);
    const dayMs = dayIso(dayOffset);
    const id = `${FILE_TAG}-${domain}-pr-${i.toString().padStart(4, "0")}`;
    const canonicalUrl = `https://www.${domain}/landing`;
    const headline = `Offer ${domain} day ${dayOffset}`;
    const htmlKey = hexKey(day, "a".repeat(32), "html");
    const screenshotKey = hexKey(day, "b".repeat(32), "jpeg");
    await stmt
      .bind(
        id,
        canonicalUrl,
        canonicalUrl,
        headline,
        headline.toLowerCase(),
        `hash-pr-${domain}-${i}`,
        "landing_page_fetch",
        htmlKey,
        JSON.stringify({
          screenshotArtifactKey: screenshotKey,
          htmlArtifactKey: htmlKey,
        }),
        "Buy now",
        `$${(i + 1) * 10}`,
        1,
        dayMs,
        dayMs,
      )
      .run();
    passingCount += 1;
  }

  if (options.adDestination && (options.passingRows ?? 0) > 0) {
    // Mirror the real ad-capture flow: an ad_observation row with a non-null
    // ad_id points at the landing_page_snapshot, which makes the EXISTS(...)
    // subquery in loadOfferTimeline / loadIndexableTimelineEntries evaluate
    // to 1 (is_ad_destination = 1) — the #1729 gate's signal.
    const userId = await seedUser(`${FILE_TAG}-user-${domain}`);
    const watchlistId = await seedWatchlist(userId, `${FILE_TAG}-wl-${domain}`);
    const runId = await seedRun(watchlistId, { id: `${FILE_TAG}-run-${domain}` });
    const adId = await seedAd(`${FILE_TAG}-ad-${domain}`);
    for (let i = 0; i < (options.passingRows ?? 0); i += 1) {
      const dayOffset = (options.backfillInWindow ?? 0) + i;
      const dayMs = dayIso(dayOffset);
      const snapshotId = `${FILE_TAG}-${domain}-pr-${i.toString().padStart(4, "0")}`;
      const canonicalUrl = `https://www.${domain}/landing`;
      await db()
        .prepare(
          `INSERT INTO ad_observation (
             id, ad_id, watchlist_run_id, landing_page_snapshot_id, seen_at,
             is_active, landing_page_url, metadata_json, created_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, '{}', ?)`,
        )
        .bind(
          `${FILE_TAG}-obs-${domain}-${i.toString().padStart(4, "0")}`,
          adId,
          runId,
          snapshotId,
          dayMs,
          canonicalUrl,
          dayMs,
        )
        .run();
    }
  }

  return { passingCount, backfillCount };
}

describe("sitemap timeline ↔ loader parity on real D1 (issue #1928)", () => {
  it("every domain listed by loadIndexableTimelineEntries also renders a non-empty ledger via loadOfferTimeline", async () => {
    // WIN domain: a handful of passing rows (well under TIMELINE_SNAPSHOT_LIMIT)
    // so the loader window contains the passing rows and the loader returns
    // non-empty entries.
    const winDomain = `${FILE_TAG}-win.com`;
    const winShape = await seedDomain(winDomain, { passingRows: 5 });
    expect(winShape.passingCount).toBe(5);

    // LOSE domain: TIMELINE_SNAPSHOT_LIMIT proof-less backfill rows fill the
    // ASC window; 50 NEWER passing rows sit past the loader window. The
    // loader's `ORDER BY captured_at ASC LIMIT TIMELINE_SNAPSHOT_LIMIT` read
    // returns the backfill rows only — every one fails the proof gate, so
    // loadOfferTimeline returns entries=[] (the route would 410). The
    // sitemap must therefore NOT list this domain.
    const loseDomain = `${FILE_TAG}-lose.com`;
    const loseShape = await seedDomain(loseDomain, {
      backfillInWindow: TIMELINE_SNAPSHOT_LIMIT,
      passingRows: 50,
    });
    expect(loseShape.backfillCount).toBe(TIMELINE_SNAPSHOT_LIMIT);
    expect(loseShape.passingCount).toBe(50);

    // ADGATE domain: only passing rows, but every one is an ad-destination.
    // The loader's #1729 gate filters them out, so loadOfferTimeline returns
    // entries=[]. The sitemap must NOT list this domain either.
    const adDomain = `${FILE_TAG}-adgate.com`;
    const adShape = await seedDomain(adDomain, {
      passingRows: 30,
      adDestination: true,
    });
    expect(adShape.passingCount).toBe(30);

    const entries = await loadIndexableTimelineEntries(appEnv);
    const paths = new Set(entries.map((entry) => entry.path));

    expect(paths.has(`/timeline/${winDomain}`)).toBe(true);
    expect(paths.has(`/timeline/${loseDomain}`)).toBe(false);
    expect(paths.has(`/timeline/${adDomain}`)).toBe(false);

    // Parity invariant: every listed domain's loader call returns
    // non-empty entries on real D1.
    for (const entry of entries) {
      const path = entry.path;
      if (!path.startsWith("/timeline/")) continue;
      const domain = path.replace("/timeline/", "");
      if (!domain.startsWith(FILE_TAG)) continue; // scope to this test's fixtures
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries.length, `${path} should render a non-empty ledger`).toBeGreaterThan(0);
    }

    // Symmetric invariant: a domain whose loader returns empty is NOT listed.
    const loseLoaded = await loadOfferTimeline(appEnv, {
      domain: loseDomain,
      asOf: null,
    });
    expect(loseLoaded.entries).toEqual([]);
    expect(paths.has(`/timeline/${loseDomain}`)).toBe(false);

    const adLoaded = await loadOfferTimeline(appEnv, {
      domain: adDomain,
      asOf: null,
    });
    expect(adLoaded.entries).toEqual([]);
    expect(paths.has(`/timeline/${adDomain}`)).toBe(false);
  });

  it("a domain whose loader window is ALL proof-less is excluded even when newer passing rows exist past the window", async () => {
    // Same shape as LOSE above but exercised as a stand-alone case so a
    // regression of the per-domain window logic surfaces here, not in the
    // parity assertion above.
    const domain = `${FILE_TAG}-windowfail.com`;
    await seedDomain(domain, {
      backfillInWindow: TIMELINE_SNAPSHOT_LIMIT,
      passingRows: 25,
    });

    const entries = await loadIndexableTimelineEntries(appEnv);
    expect(entries.map((entry) => entry.path)).not.toContain(
      `/timeline/${domain}`,
    );

    const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
    expect(loaded.entries).toEqual([]);
  });

  it("a domain with only ad-destination rows is excluded from the sitemap (#1729 gate parity)", async () => {
    const domain = `${FILE_TAG}-adonly.com`;
    await seedDomain(domain, {
      passingRows: 10,
      adDestination: true,
    });

    const entries = await loadIndexableTimelineEntries(appEnv);
    expect(entries.map((entry) => entry.path)).not.toContain(
      `/timeline/${domain}`,
    );

    const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
    expect(loaded.entries).toEqual([]);
  });
});