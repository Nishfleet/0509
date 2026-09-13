import { describe, expect, it } from "vitest";

import { listAdsByIds, upsertAd } from "~/lib/data.server";
import { SEARCH_LIKELY_CONFIRM_SIGNUP_SOURCE } from "~/lib/funnel-measurement.server";
import {
  applySignupSourceToNewUser,
  readUserSignupSource,
  rememberAllowlistedSignupSource,
} from "~/lib/signup-source";
import type { AdRecord } from "~/lib/types";

import { appEnv, db, seedUser, uid } from "./fixtures";

/**
 * Issue #3306 (BET 2 finish line) against the REAL bindings:
 *
 * - signed-in: the Likely-row confirm keeps the plain record href, whose
 *   selection persistence is `upsertAd` — keyed by the ad's id, so repeat
 *   clicks fold into ONE row instead of duplicating. This suite clicks it
 *   twice against real D1 and reads the confirmation back through the same
 *   surface the results table uses.
 * - signed-out: the confirm's signup intent carries
 *   `source=search-likely-confirm`; the marker must survive the real 0087
 *   CHECK constraint (`signup_source` allowlist + open slug shape) through
 *   remember → apply → read, and a repeat click must overwrite, never
 *   duplicate.
 *
 * No migration ships (that is the acceptance): this proves the 0087 open
 * slug shape already accepts the new marker. The node-project companion
 * (tests/search-likely-confirm.integration.test.ts) pins the rendered
 * control; this suite pins the records those clicks produce.
 */

/** Minimal likely-match fixture — mirrors the BET 2 /search result shape. */
function likelyConfirmAd(metaAdId: string): AdRecord {
  return {
    metaAdId,
    advertiser: "Notion",
    body: "The connected workspace where better, faster work happens.",
    previewHeadline: "One tool for your whole company",
    previewSubhead: "Fixture source evidence",
    hook: "One tool for your whole company",
    offer: "Free for students",
    cta: "Get started",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://notion.so",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Live fixture",
    source: "meta_library_browser",
    analysisFields: [],
    tags: [],
    domainMatch: {
      level: "likely_brand_name",
      reason: "Advertiser name fits this brand",
      matchedDomain: null,
    },
  } as AdRecord;
}

async function pendingRowCount(email: string) {
  const row = await db()
    .prepare("SELECT COUNT(*) AS n FROM signup_source_pending WHERE email = ?")
    .bind(email)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("search Likely-confirm against real D1 (issue #3306, BET 2 finish line)", () => {
  it("records a signed-in confirm through the selection persistence; repeat clicks are idempotent", async () => {
    const metaAdId = uid("lc_src");
    const ad = likelyConfirmAd(metaAdId);

    // Two clicks = the selection persistence exercised twice: the same
    // confirmation upserted again, exactly what a second ?selected= reload
    // of the same Likely row does.
    await upsertAd(appEnv, ad);
    await upsertAd(appEnv, ad);

    const row = await db()
      .prepare("SELECT advertiser, landing_page_url, is_active FROM ad WHERE id = ?")
      .bind(metaAdId)
      .first<{ advertiser: string; landing_page_url: string; is_active: number }>();
    expect(row).toBeDefined();
    expect(row!.advertiser).toBe("Notion");
    expect(row!.landing_page_url).toBe("https://notion.so");
    expect(row!.is_active).toBe(1);

    // Exactly ONE record — the repeat click folded in, no duplicate.
    const counted = await db()
      .prepare("SELECT COUNT(*) AS n FROM ad WHERE id = ?")
      .bind(metaAdId)
      .first<{ n: number }>();
    expect(counted?.n).toBe(1);

    // And the confirmation READS back through the same surface the results
    // table uses.
    const readBack = await listAdsByIds(appEnv, [metaAdId]);
    expect(readBack).toHaveLength(1);
    expect(readBack[0]?.metaAdId).toBe(metaAdId);
    expect(readBack[0]?.advertiser).toBe("Notion");
    expect(readBack[0]?.landingPageUrl).toBe("https://notion.so");
  });

  it("carries the signed-out confirm intent through the 0087 CHECK: remember, apply, read, repeat", async () => {
    const userId = await seedUser(uid("lc_user"));
    const email = `${userId}@example.test`;
    await db()
      .prepare("UPDATE user SET email = ? WHERE id = ?")
      .bind(email, userId)
      .run();

    // Click 1 (the signed-out confirm → signup-start intent): the marker
    // must pass the real CHECK constraint.
    expect(
      await rememberAllowlistedSignupSource(appEnv, {
        email,
        source: SEARCH_LIKELY_CONFIRM_SIGNUP_SOURCE,
      }),
    ).toBe("search-likely-confirm");
    const pending = await db()
      .prepare("SELECT signup_source FROM signup_source_pending WHERE email = ?")
      .bind(email)
      .first<{ signup_source: string }>();
    expect(pending?.signup_source).toBe("search-likely-confirm");

    // Signup completes: the pending marker lands on the user row and reads
    // back through the signup-source surface.
    expect(
      await applySignupSourceToNewUser(appEnv, { user: { id: userId, email } }),
    ).toBe("search-likely-confirm");
    expect(await readUserSignupSource(appEnv, userId)).toBe("search-likely-confirm");
    // Consumed: the pending row is gone.
    expect(await pendingRowCount(email)).toBe(0);

    // The visitor clicks confirm AGAIN (another signup-start): the pending
    // row is overwritten, not duplicated, and the first-write-wins
    // attribution on the user row keeps the same marker.
    expect(
      await rememberAllowlistedSignupSource(appEnv, { email, source: "search-likely-confirm" }),
    ).toBe("search-likely-confirm");
    expect(await pendingRowCount(email)).toBe(1);
    expect(await readUserSignupSource(appEnv, userId)).toBe("search-likely-confirm");
  });
});
