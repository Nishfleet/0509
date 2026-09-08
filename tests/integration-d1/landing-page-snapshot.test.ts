import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import type { LandingPageSnapshotData } from "~/lib/types";
import { setupMigrations } from "./setup";

/**
 * P10-A job 1 — D1 integration tests for the landing_page_snapshot read/write
 * path. Snapshot reads are one of the three highest-risk D1 surfaces named in
 * the recos doc (§1.5): the hash index that dedupes snapshots and the
 * analysis_field rows written alongside them are verified by nothing under
 * the old mock-only suite. Runs on real workerd via Miniflare with the real
 * migration chain applied.
 */

const NOW = "2026-08-25T10:00:00.000Z";

function snapshot(overrides: Partial<LandingPageSnapshotData> = {}): LandingPageSnapshotData {
  return {
    rawUrl: "https://example.com/",
    canonicalUrl: "https://example.com/",
    rawHeadline: "Example Headline",
    normalizedHeadline: "example headline",
    normalizedHeadlineHash: "a".repeat(64),
    captureMethod: "landing_page_fetch",
    capturedAt: NOW,
    ...overrides,
  };
}

type AppEnv = typeof env;

describe("landing_page_snapshot write/read path (real D1, real migrations)", () => {
  beforeEach(async () => {
    await setupMigrations();
  });

  it("createLandingPageSnapshot inserts a row and returns its id", async () => {
    const id = await createLandingPageSnapshot(env, snapshot());
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const row = await env.DB.prepare(
      `SELECT raw_url, canonical_url, raw_headline, normalized_headline, normalized_headline_hash, capture_method, cta_text, price_text, form_present, captured_at FROM landing_page_snapshot WHERE id = ?`,
    )
      .bind(id)
      .first();
    expect(row).toMatchObject({
      raw_url: "https://example.com/",
      canonical_url: "https://example.com/",
      raw_headline: "Example Headline",
      normalized_headline: "example headline",
      normalized_headline_hash: "a".repeat(64),
      capture_method: "landing_page_fetch",
      cta_text: null,
      price_text: null,
      form_present: null,
      captured_at: NOW,
    });
  });

  it("the normalized_headline_hash index supports a dedupe read", async () => {
    const hash = "b".repeat(64);
    await createLandingPageSnapshot(env, snapshot({ normalizedHeadlineHash: hash }));
    await createLandingPageSnapshot(
      env,
      snapshot({
        normalizedHeadlineHash: hash,
        rawHeadline: "Example Headline v2",
        capturedAt: "2026-08-25T11:00:00.000Z",
      }),
    );

    // The dedupe query the monitoring path uses: find the latest snapshot
    // for a given hash. Two rows share the hash; the read returns the newer
    // one. This is the read the change-detection logic depends on.
    const latest = await env.DB.prepare(
      `SELECT id, raw_headline, captured_at FROM landing_page_snapshot WHERE normalized_headline_hash = ? ORDER BY captured_at DESC LIMIT 1`,
    )
      .bind(hash)
      .first<{ raw_headline: string; captured_at: string }>();
    expect(latest?.raw_headline).toBe("Example Headline v2");
    expect(latest?.captured_at).toBe("2026-08-25T11:00:00.000Z");
  });

  it("createLandingPageSnapshot writes the paired analysis_field rows", async () => {
    const id = await createLandingPageSnapshot(
      env,
      snapshot({
        ctaText: "Shop Now",
        priceText: "₹400",
        formPresent: true,
      }),
    );

    const fields = await env.DB.prepare(
      `SELECT field_key, field_value FROM analysis_field WHERE scope_type = 'landing_page' AND scope_id = ? ORDER BY field_key`,
    )
      .bind(id)
      .all<{ field_key: string; field_value: string }>();
    const keys = fields.results.map((r) => r.field_key);
    expect(keys).toContain("cta_text");
    expect(keys).toContain("price_text");
    expect(keys).toContain("form_present");
    const cta = fields.results.find((r) => r.field_key === "cta_text");
    expect(cta?.field_value).toBe("Shop Now");
  });
});
