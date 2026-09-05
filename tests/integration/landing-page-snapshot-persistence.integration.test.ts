import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #1484 (BET 3): landing_page_snapshot persistence end-to-end against
 * real (local workerd) D1 with the repo's real migrations applied.
 *
 * The monitoring workflow's persistence writer is `createLandingPageSnapshot`
 * (wrapped by `persistLandingPageSnapshotRow` in monitoring.server.ts and
 * called with the captured `LandingPageSnapshotData`). This suite drives that
 * exact writer — the same function the workflow calls after a successful
 * landing-page capture — and asserts the three accept criteria of the issue:
 *
 *   (a) a successful capture inserts a `landing_page_snapshot` row,
 *   (b) a duplicate capture (identical captured state / content hash) does
 *       NOT insert a second row,
 *   (c) a state change creates a new row with a new content hash.
 *
 * It also verifies accept criterion #4: `loadOfferTimeline` returns the
 * persisted snapshots as a dated ledger.
 *
 * Mocked D1 cannot see the real schema, the canonical-url index (migration
 * 0078), the `IS` null-safe dedup comparison, or whether a write still lands
 * after the dedup read — this file exercises the real schema.
 */

const DOMAIN = "snappersist.example";

function hexKey(seed: string, ext: "html" | "jpeg") {
  // 32 hex chars from a stable seed so artifact keys pass the proof-key
  // validators (`landing-pages/YYYY-MM-DD/<hex>.(html|jpeg)`).
  let hash = "";
  for (let i = 0; i < 32; i += 1) {
    hash += seed.charCodeAt(i % seed.length).toString(16).padStart(2, "0").slice(-1);
  }
  return `landing-pages/2026-09-01/${hash}.${ext}`;
}

interface CaptureInput {
  canonicalUrl: string;
  headline: string;
  ctaText: string;
  priceText: string;
  capturedAt: string;
  formPresent?: boolean;
}

/** Exactly what the monitoring workflow does after a successful capture. */
async function persistCapture(input: CaptureInput, seed: string) {
  return createLandingPageSnapshot(appEnv, {
    rawUrl: input.canonicalUrl,
    canonicalUrl: input.canonicalUrl,
    rawHeadline: input.headline,
    normalizedHeadline: input.headline.toLowerCase(),
    normalizedHeadlineHash: `hash_${input.headline}`,
    captureMethod: "browser_render",
    artifactKey: hexKey(seed, "html"),
    metadata: {
      screenshotArtifactKey: hexKey(seed, "jpeg"),
      htmlArtifactKey: hexKey(seed, "html"),
      extractorVersion: "lp-signals-v1",
    },
    ctaText: input.ctaText,
    priceText: input.priceText,
    formPresent: input.formPresent ?? true,
    capturedAt: input.capturedAt,
  });
}

describe("landing-page snapshot persistence against real D1", () => {
  it("(a) persists a successful capture as a landing_page_snapshot row", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const url = `https://${DOMAIN}/glow`;
    const captureId = await persistCapture(
      {
        canonicalUrl: url,
        headline: "Glow serum sale",
        ctaText: "Shop now",
        priceText: "₹499",
        capturedAt: "2026-09-01T10:00:00.000Z",
      },
      `a-${uid("k")}`,
    );

    const rows = await db()
      .prepare(
        `SELECT id, canonical_url, raw_headline, normalized_headline_hash,
                cta_text, price_text, form_present, artifact_key, captured_at
         FROM landing_page_snapshot WHERE id = ?`,
      )
      .bind(captureId)
      .all<{
        id: string;
        canonical_url: string;
        raw_headline: string;
        normalized_headline_hash: string;
        cta_text: string;
        price_text: string;
        form_present: number;
        artifact_key: string;
        captured_at: string;
      }>();
    expect(rows.results).toHaveLength(1);
    const row = rows.results![0]!;
    expect(row.canonical_url).toBe(url);
    expect(row.raw_headline).toBe("Glow serum sale");
    expect(row.normalized_headline_hash).toBe("hash_Glow serum sale");
    expect(row.cta_text).toBe("Shop now");
    expect(row.price_text).toBe("₹499");
    expect(row.form_present).toBe(1);
    expect(row.artifact_key).toMatch(/\.html$/);
    expect(row.captured_at).toBe("2026-09-01T10:00:00.000Z");
    void watchlistId;
  });

  it("(b) a duplicate capture does NOT create a second row", async () => {
    const url = `https://${DOMAIN}/dup`;
    const firstId = await persistCapture(
      {
        canonicalUrl: url,
        headline: "Flat 30% off",
        ctaText: "Get offer",
        priceText: "₹799",
        capturedAt: "2026-09-01T10:00:00.000Z",
      },
      "b-first",
    );
    // Same canonical URL and identical captured state (same content hash),
    // but a different screenshot artifact — dedup must key on content state,
    // not on the artifact keys.
    const secondId = await persistCapture(
      {
        canonicalUrl: url,
        headline: "Flat 30% off",
        ctaText: "Get offer",
        priceText: "₹799",
        capturedAt: "2026-09-02T10:00:00.000Z",
      },
      "b-second",
    );

    expect(secondId).toBe(firstId);
    const rows = await db()
      .prepare(
        `SELECT id FROM landing_page_snapshot WHERE canonical_url = ? ORDER BY captured_at ASC`,
      )
      .bind(url)
      .all<{ id: string }>();
    expect(rows.results).toHaveLength(1);
  });

  it("(c) a state change creates a new row with a new content hash", async () => {
    const url = `https://${DOMAIN}/state-change`;
    const firstId = await persistCapture(
      {
        canonicalUrl: url,
        headline: "Flat 30% off",
        ctaText: "Get offer",
        priceText: "₹799",
        capturedAt: "2026-09-01T10:00:00.000Z",
      },
      "c-first",
    );
    const secondId = await persistCapture(
      {
        canonicalUrl: url,
        headline: "Flat 40% off",
        ctaText: "Shop the sale",
        priceText: "₹699",
        capturedAt: "2026-09-05T10:00:00.000Z",
      },
      "c-second",
    );

    expect(secondId).not.toBe(firstId);
    const rows = await db()
      .prepare(
        `SELECT id, normalized_headline_hash, captured_at
         FROM landing_page_snapshot WHERE canonical_url = ? ORDER BY captured_at ASC`,
      )
      .bind(url)
      .all<{
        id: string;
        normalized_headline_hash: string;
        captured_at: string;
      }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results![0]!.normalized_headline_hash).toBe("hash_Flat 30% off");
    expect(rows.results![1]!.normalized_headline_hash).toBe("hash_Flat 40% off");
  });

  it("dedup + state-change rows compose into a dated timeline (accept #4)", async () => {
    // Isolated domain: loadOfferTimeline queries by domain and buildOfferLedger
    // computes transitions across every URL in that domain, so this test must
    // own its domain to avoid rows seeded by tests (a)-(c) leaking into the
    // transition math.
    const LEDGER_DOMAIN = "ledger-persist.example";
    const domainUrl = `https://${LEDGER_DOMAIN}/offer`;
    await persistCapture(
      {
        canonicalUrl: domainUrl,
        headline: "Launch offer",
        ctaText: "Try now",
        priceText: "Free",
        capturedAt: "2026-09-01T09:00:00.000Z",
      },
      "d-one",
    );
    // Duplicate of the launch state — must not add a timeline entry.
    await persistCapture(
      {
        canonicalUrl: domainUrl,
        headline: "Launch offer",
        ctaText: "Try now",
        priceText: "Free",
        capturedAt: "2026-09-02T09:00:00.000Z",
      },
      "d-dup",
    );
    // Real state change — the second dated entry.
    await persistCapture(
      {
        canonicalUrl: domainUrl,
        headline: "Summer sale",
        ctaText: "Shop now",
        priceText: "₹299",
        capturedAt: "2026-09-10T09:00:00.000Z",
      },
      "d-two",
    );

    const loaded = await loadOfferTimeline(appEnv, {
      domain: LEDGER_DOMAIN,
      asOf: null,
    });
    expect(loaded.entries).toHaveLength(2);
    expect(loaded.entries[0]?.headline).toBe("Launch offer");
    expect(loaded.entries[0]?.transition).toBeNull();
    expect(loaded.entries[1]?.headline).toBe("Summer sale");
    expect(loaded.entries[1]?.transition?.headline).toEqual({
      before: "Launch offer",
      after: "Summer sale",
    });
    // Proof gate (issue #1284): both persisted rows carry a screenshot and a
    // page-text artifact, so both render with working artifact links.
    expect(
      loaded.entries.every((entry) => entry.screenshotHref?.startsWith("/artifacts/proof/")),
    ).toBe(true);
    expect(
      loaded.entries.every((entry) => entry.pageTextHref?.startsWith("/artifacts/page-text/")),
    ).toBe(true);
  });
});
