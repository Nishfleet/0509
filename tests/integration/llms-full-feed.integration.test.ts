import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import { loadLlmsFullBrandBlocks } from "~/lib/llms-full.server";
import { buildLlmsFullText } from "~/lib/llms-full.server";
import { SITEMAP_TIMELINE_READ_LIMIT } from "~/lib/sitemap.server";

import { appEnv, uid } from "./fixtures";

// `uid` emits `dom_NNNN` (underscore). `normalizeBrandPageDomain` (the gate
// `timelineDomainFromSnapshotRow` reuses) only accepts `[a-zA-Z0-9.-]`, so
// strip the underscore before composing the `.com` hostname — a real TLD,
// not a reserved one (.example/.test are rejected by isReservedBrandPageDomain).
const dom = (prefix: string) => `${prefix}${uid("dom").replace("_", "")}.com`;

const DOMAIN = dom("llmsfull");
const SIBLING = dom("other");

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
    metadata: {
      screenshotArtifactKey: input.screenshotKey,
      htmlArtifactKey: input.htmlKey,
    },
    ctaText: input.ctaText,
    priceText: input.priceText,
    formPresent: input.formPresent ?? true,
    capturedAt: input.capturedAt,
  });
}

/**
 * The /llms-full.txt feed reads `landing_page_snapshot` by the same bounded
 * window the sitemap uses, then reuses the /timeline/:domain ledger logic.
 * Mocked D1 cannot see the index, the LIKE ESCAPE clause, or the
 * ad_observation correlation. This file applies the real migrations and
 * asserts the feed surfaces at least one tracked brand with at least one
 * dated offer state AND an evidence link — the issue #2043 acceptance
 * metric.
 */
describe("/llms-full.txt against real D1 (issue #2043)", () => {
  it("surfaces a tracked brand with a dated offer state and an evidence link", async () => {
    const day1 = "2026-09-01";
    const day2 = "2026-09-07";
    const html1 = hexKey(day1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "html");
    const shot1 = hexKey(day1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "jpeg");
    const html2 = hexKey(day2, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "html");
    const shot2 = hexKey(day2, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "jpeg");

    await seedSnapshot({
      canonicalUrl: `https://${DOMAIN}/shop`,
      headline: "Air Max",
      ctaText: "Shop now",
      priceText: "$149",
      capturedAt: `${day1}T10:00:00.000Z`,
      htmlKey: html1,
      screenshotKey: shot1,
    });
    await seedSnapshot({
      canonicalUrl: `https://www.${DOMAIN}/shop`,
      headline: "Air Max Pro",
      ctaText: "Buy",
      priceText: "$179",
      capturedAt: `${day2}T10:00:00.000Z`,
      htmlKey: html2,
      screenshotKey: shot2,
    });
    // A sibling brand that must NOT bleed into the first brand's block.
    await seedSnapshot({
      canonicalUrl: `https://${SIBLING}/glow`,
      headline: "Other brand",
      ctaText: "Buy",
      priceText: "$1",
      capturedAt: `${day1}T12:00:00.000Z`,
      htmlKey: hexKey(day1, "dddddddddddddddddddddddddddddddd", "html"),
      screenshotKey: hexKey(day1, "dddddddddddddddddddddddddddddddd", "jpeg"),
    });

    const blocks = await loadLlmsFullBrandBlocks(appEnv, SITEMAP_TIMELINE_READ_LIMIT);
    const block = blocks.find((b) => b.domain === DOMAIN);
    expect(block, `${DOMAIN} must appear in the feed`).toBeDefined();

    // Issue #2043 acceptance: at least one dated offer state.
    expect(block!.entries.length).toBeGreaterThan(0);
    const firstEntry = block!.entries[0]!;
    expect(firstEntry.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    // Issue #2043 acceptance: at least one evidence link.
    expect(firstEntry.screenshotHref ?? firstEntry.pageTextHref).not.toBeNull();

    // The rendered feed body carries the domain, a dated state, and an
    // evidence link a crawler can cite.
    const text = buildLlmsFullText(blocks);
    expect(text).toContain(`## ${DOMAIN}`);
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).toMatch(/https:\/\/0509\.io\/artifacts\/(proof|page-text)\//);
    // Meta Ad Library source link for the brand.
    expect(text).toContain("facebook.com/ads/library/");
    // Offer fields captured.
    expect(text).toContain("$149");

    // The sibling brand is a separate block, not merged into the first.
    const siblingBlock = blocks.find((b) => b.domain === SIBLING);
    expect(siblingBlock).toBeDefined();
  });

  it("omits a brand whose only row is proof-less (issue #1284)", async () => {
    const prooflessDomain = dom("proofless-");
    await appEnv.DB!.prepare(
      `INSERT INTO landing_page_snapshot (
        id, raw_url, canonical_url, raw_headline, normalized_headline,
        normalized_headline_hash, capture_method, artifact_key, metadata_json,
        cta_text, price_text, form_present, ocr_text, translated_text,
        captured_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
      .bind(
        `proofless-${prooflessDomain}`,
        `https://www.${prooflessDomain}/`,
        `https://www.${prooflessDomain}/`,
        "Proof-less backfill",
        "proof-less backfill",
        `proofless-${prooflessDomain}`,
        "demo_backfill",
        JSON.stringify({ backfill: true, source: "demo_brand_seed" }),
        "2026-09-05T00:00:00.000Z",
        "2026-09-06T00:00:00.000Z",
      )
      .run();

    const blocks = await loadLlmsFullBrandBlocks(appEnv, SITEMAP_TIMELINE_READ_LIMIT);
    expect(blocks.find((b) => b.domain === prooflessDomain)).toBeUndefined();
  });

  it("degrades to an honest empty feed when no brand has proof-complete captures", async () => {
    // No snapshots seeded for a unique absent domain; the feed over the whole
    // table may still contain other brands, so assert the empty-body contract
    // on buildLlmsFullText directly.
    const text = buildLlmsFullText([]);
    expect(text).toContain("No tracked brands with proof-complete captures yet.");
  });
});
