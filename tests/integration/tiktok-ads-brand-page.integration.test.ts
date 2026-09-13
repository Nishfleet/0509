import { describe, expect, it } from "vitest";

import { loadBrandPageSourceSnapshots } from "~/components/brand-page/source-snapshots.server";
import type { AppEnv } from "~/lib/env.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Issue #3195 — the /ads/:domain acceptance, at the real-D1 tier: the
 * "e2e fixture brand returns >=1 TikTok ad" bullet, proven against the REAL
 * read path (real workerd, real migrations, the real live-gate), not a mocked
 * binding.
 *
 * The gating here is exactly production's: implemented + requiresEnv(env) —
 * the TikTok flag (DECODO_SCRAPER_AUTH) — AND a stored `source_snapshot` row
 * for an advertiser watchlist whose target's registrable domain matches.
 * Capture-validity rides the same shape: a FAILED capture stores no snapshot
 * row, so a dead capture renders nothing rather than a phantom "no ads"
 * section (the #2873 no-phantom-events rule, applied to this source).
 *
 * Isolation note: local storage is isolated per test FILE, so these rows are
 * ours alone; each it() seeds its own watchlist and asserts by watchlist id.
 * Domains differ per case ("nike.com" / "puma.com") so neither it() sees the
 * other's rows.
 */

const envWithTiktok = { ...appEnv, DECODO_SCRAPER_AUTH: "dGVzdC1hdXRo" } as AppEnv;
const envWithoutTiktok = { ...appEnv, DECODO_SCRAPER_AUTH: undefined } as AppEnv;

const tiktokPayload = () => ({
  legalName: "NIKE, INC.",
  totalAds: 1,
  ads: [
    {
      adId: "tiktok-1",
      advertiser: "Nike",
      firstShown: "2026-08-10",
      lastShown: "2026-09-01",
      uniqueUsers: "1.2M",
      thumbnail: null,
    },
  ],
});

/**
 * Seeds one advertiser watchlist whose target_id is the watchlist's
 * normalized website URL (the #2200 contract — the registrable domain of
 * `target_id` decides the match) plus one stored TikTok snapshot holding
 * exactly one EU-shown ad. Returns the watchlist id for scoping.
 */
async function seedTiktokFixture(domain: string, withSnapshot = true) {
  const userId = await seedUser();
  const watchlistId = uid("wl");
  await db()
    .prepare(
      `INSERT INTO watchlist (
         id, user_id, name, target_type, target_id, target_fingerprint,
         target_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      watchlistId,
      userId,
      `TikTok fixture ${watchlistId}`,
      `https://www.${domain}`,
      `fp_${watchlistId}`,
      `Brand ${domain}`,
      ISO_T0,
      ISO_T0,
    )
    .run();
  if (withSnapshot) {
    await db()
      .prepare(
        `INSERT INTO source_snapshot (id, watchlist_id, source_id, fetched_at, payload_json, created_at)
         VALUES (?, ?, 'tiktok', ?, ?, ?)`,
      )
      .bind(uid("snap"), watchlistId, ISO_T0, JSON.stringify(tiktokPayload()), ISO_T0)
      .run();
  }
  return watchlistId;
}

describe("tiktok /ads brand-page read path (issue #3195)", () => {
  it("returns the stored TikTok snapshot with >=1 ad for the fixture brand, gated live", async () => {
    const watchlistId = await seedTiktokFixture("nike.com");

    const rows = await loadBrandPageSourceSnapshots(envWithTiktok, "nike.com");

    const tiktok = rows.find((row) => row.sourceId === "tiktok");
    expect(tiktok).toBeDefined();
    expect(tiktok?.snapshot.watchlistId).toBe(watchlistId);
    // THE acceptance bullet: the fixture brand returns >=1 TikTok ad.
    const payload = tiktok!.snapshot.payload as {
      ads: unknown[];
      totalAds: number;
      legalName: string;
    };
    expect(payload.ads.length).toBeGreaterThanOrEqual(1);
    expect(payload.totalAds).toBe(1);
    expect(payload.legalName).toBe("NIKE, INC.");
  });

  it("drops the TikTok section entirely when the flag credential is absent (kill flag at the read gate)", async () => {
    await seedTiktokFixture("puma.com");

    const rows = await loadBrandPageSourceSnapshots(envWithoutTiktok, "puma.com");

    expect(rows.find((row) => row.sourceId === "tiktok")).toBeUndefined();
  });

  it("renders no TikTok section when the capture never stored a snapshot — the #2873 no-phantom rule, even with the flag live", async () => {
    await seedTiktokFixture("adidas.com", false);

    const rows = await loadBrandPageSourceSnapshots(envWithTiktok, "adidas.com");

    // The #2873 capture-validity posture at the read tier: a failed or
    // never-run capture stores NO source_snapshot row, so the /ads page
    // omits the section entirely — never a phantom "No EU-shown TikTok ads
    // found" empty-ads state. (b) of the read gate: a snapshot must exist.
    expect(rows.find((row) => row.sourceId === "tiktok")).toBeUndefined();
  });
});
