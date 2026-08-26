import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db, uid } from "./fixtures";

const DOMAIN = "timeline967.example";
const SIBLING = "nottimeline967.example";

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
  formPresent?: boolean;
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
    formPresent: input.formPresent ?? true,
    capturedAt: input.capturedAt,
  });
}

/**
 * The public Offer Timeline reads `landing_page_snapshot` by canonical_url
 * (migration 0078 indexes that column). Mocked D1 cannot see the index, the
 * LIKE ESCAPE clause, or whether a write still lands after the index exists.
 * This file applies the real migrations and asserts both the new READ and
 * the existing WRITE against local D1.
 */
describe("offer timeline against real D1", () => {
  it("writes three versioned snapshots and reads them back as a dated ledger", async () => {
    const day1 = "2026-08-01";
    const day2 = "2026-08-10";
    const day3 = "2026-08-20";
    const html1 = hexKey(day1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "html");
    const html2 = hexKey(day2, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "html");
    const html3 = hexKey(day3, "cccccccccccccccccccccccccccccccc", "html");
    const shot1 = hexKey(day1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "jpeg");
    const shot2 = hexKey(day2, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "jpeg");
    const shot3 = hexKey(day3, "cccccccccccccccccccccccccccccccc", "jpeg");

    const id1 = await seedSnapshot({
      canonicalUrl: `https://${DOMAIN}/glow`,
      headline: "Glow serum",
      ctaText: "Shop now",
      priceText: "₹499",
      capturedAt: `${day1}T10:00:00.000Z`,
      htmlKey: html1,
      screenshotKey: shot1,
    });
    const id2 = await seedSnapshot({
      canonicalUrl: `https://www.${DOMAIN}/glow`,
      headline: "Festive glow kit",
      ctaText: "Get the kit",
      priceText: "₹799",
      capturedAt: `${day2}T10:00:00.000Z`,
      htmlKey: html2,
      screenshotKey: shot2,
    });
    const id3 = await seedSnapshot({
      canonicalUrl: `https://shop.${DOMAIN}/glow`,
      headline: "Festive glow kit",
      ctaText: "Get the kit",
      priceText: "₹599",
      capturedAt: `${day3}T10:00:00.000Z`,
      htmlKey: html3,
      screenshotKey: shot3,
    });
    await seedSnapshot({
      canonicalUrl: `https://${SIBLING}/glow`,
      headline: "Other brand",
      ctaText: "Buy",
      priceText: "₹1",
      capturedAt: `${day1}T12:00:00.000Z`,
      htmlKey: hexKey(day1, "dddddddddddddddddddddddddddddddd", "html"),
      screenshotKey: hexKey(day1, "dddddddddddddddddddddddddddddddd", "jpeg"),
    });

    const written = await db()
      .prepare(
        `SELECT id FROM landing_page_snapshot WHERE id IN (?, ?, ?) ORDER BY captured_at ASC`,
      )
      .bind(id1, id2, id3)
      .all<{ id: string }>();
    expect(written.results?.map((row) => row.id)).toEqual([id1, id2, id3]);

    const loaded = await loadOfferTimeline(appEnv, { domain: DOMAIN, asOf: "2026-08-15" });

    expect(loaded.entries).toHaveLength(3);
    expect(loaded.entries.map((entry) => entry.id)).toEqual([id1, id2, id3]);
    expect(loaded.entries[0]?.transition).toBeNull();
    expect(loaded.entries[1]?.transition?.headline).toEqual({
      before: "Glow serum",
      after: "Festive glow kit",
    });
    expect(loaded.entries[2]?.transition?.priceText).toEqual({
      before: "₹799",
      after: "₹599",
    });
    expect(loaded.entries.every((entry) => entry.screenshotHref?.startsWith("/artifacts/proof/"))).toBe(
      true,
    );
    expect(loaded.entries.every((entry) => entry.pageTextHref?.startsWith("/artifacts/page-text/"))).toBe(
      true,
    );
    expect(loaded.asOfState?.id).toBe(id2);
    expect(loaded.entries.some((entry) => entry.headline === "Other brand")).toBe(false);
  });

  it("returns an empty ledger for a domain with no stored snapshots", async () => {
    const loaded = await loadOfferTimeline(appEnv, {
      domain: `absent-${uid("dom")}.example`,
      asOf: null,
    });
    expect(loaded).toEqual({ entries: [], asOfState: null });
  });
});
