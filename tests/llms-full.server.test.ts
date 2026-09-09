import { describe, expect, it } from "vitest";

import {
  brandTimelinesFromRows,
  buildLlmsFullText,
  type LlmsFullSnapshotRow,
} from "~/lib/llms-full.server";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";

const NOW = new Date("2026-09-10T12:00:00.000Z");

function ledgerEntry(overrides: Partial<OfferLedgerEntry>): OfferLedgerEntry {
  return {
    id: "snap_1",
    capturedAt: "2026-09-09T10:00:00.000Z",
    dateLabel: "9 Sept 2026",
    canonicalUrl: "https://nike.com/",
    headline: "Shop the drop",
    ctaText: "Shop now",
    priceText: "$149",
    formPresent: true,
    screenshotHref: "/artifacts/proof/landing-pages/2026-09-09/aaaa.jpeg",
    pageTextHref: "/artifacts/page-text/landing-pages/2026-09-09/aaaa.html",
    transition: null,
    runExtentLabel: null,
    evidenceNote: null,
    ...overrides,
  };
}

/**
 * Pure honesty-gate coverage for the /llms-full.txt renderer (issue #2043):
 * no fabricated states, no unevidenced states, honest empty corpus, and the
 * existing freshness vocabulary with an explicit STALE marker. The real-D1
 * read path is covered by tests/integration/llms-full-feed.integration.test.ts.
 */
describe("buildLlmsFullText", () => {
  it("renders a dated offer state with evidence links and the Meta source line", () => {
    const text = buildLlmsFullText(
      [{ domain: "nike.com", brandName: "Nike", entries: [ledgerEntry({})] }],
      NOW,
    );

    expect(text).toContain("## nike.com");
    expect(text).toContain('As of 2026-09-09: "Shop the drop" — CTA: Shop now — Price: $149');
    expect(text).toContain(
      "Evidence: [screenshot](https://0509.io/artifacts/proof/landing-pages/2026-09-09/aaaa.jpeg) · [page text](https://0509.io/artifacts/page-text/landing-pages/2026-09-09/aaaa.html)",
    );
    expect(text).toContain("- Offer source: Meta Ad Library via public search");
    expect(text).toContain("https://0509.io/timeline/nike.com");
    expect(text).toMatch(/captured about a day ago/);
    expect(text).not.toContain("STALE");
  });

  it("skips entries without BOTH proof links — never renders an unevidenced state", () => {
    const text = buildLlmsFullText(
      [
        {
          domain: "nike.com",
          brandName: "Nike",
          entries: [
            ledgerEntry({ id: "a", headline: "Fully evidenced" }),
            ledgerEntry({
              id: "b",
              headline: "Screenshot only",
              pageTextHref: null,
            }),
            ledgerEntry({
              id: "c",
              headline: "Page text only",
              screenshotHref: null,
            }),
          ],
        },
      ],
      NOW,
    );

    expect(text).toContain("Fully evidenced");
    expect(text).not.toContain("Screenshot only");
    expect(text).not.toContain("Page text only");
  });

  it("labels stale proof with the existing freshness vocabulary plus STALE", () => {
    const text = buildLlmsFullText(
      [
        {
          domain: "oldbrand.com",
          brandName: "Old Brand",
          entries: [
            ledgerEntry({
              capturedAt: "2026-08-20T10:00:00.000Z",
              screenshotHref: "/artifacts/proof/landing-pages/2026-08-20/bbbb.jpeg",
              pageTextHref: "/artifacts/page-text/landing-pages/2026-08-20/bbbb.html",
            }),
          ],
        },
      ],
      NOW,
    );

    // Older than the 7-day indexability window: the honest capture-age label
    // the brand pages already use, plus an explicit STALE marker.
    expect(text).toMatch(/captured about 21 days ago — STALE/);
  });

  it("renders an honest empty state when no brand has captured data", () => {
    const text = buildLlmsFullText([], NOW);
    expect(text).toContain("No brand records stored yet");
    expect(text).toContain("only once a complete proof capture");
    expect(text).not.toMatch(/## /);
  });

  it("skips empty brand sections entirely", () => {
    const text = buildLlmsFullText(
      [{ domain: "ghost.com", brandName: "Ghost", entries: [] }],
      NOW,
    );
    expect(text).not.toContain("ghost.com");
    expect(text).toContain("No brand records stored yet");
  });
});

/**
 * The pure reducer mirrors the /timeline loader's gates: proof gate,
 * ad-destination gate, per-domain window. Fixture rows are ordered
 * captured_at ASC like the SQL read.
 */
describe("brandTimelinesFromRows", () => {
  function row(overrides: Partial<LlmsFullSnapshotRow>): LlmsFullSnapshotRow {
    return {
      id: "snap_1",
      canonical_url: "https://nike.com/",
      captured_at: "2026-09-09T10:00:00.000Z",
      artifact_key: "landing-pages/2026-09-09/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html",
      metadata_json: JSON.stringify({
        screenshotArtifactKey: "landing-pages/2026-09-09/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg",
      }),
      raw_headline: "Shop the drop",
      cta_text: "Shop now",
      price_text: "$149",
      form_present: 1,
      capture_method: "landing_page_fetch",
      is_ad_destination: 0,
      ...overrides,
    };
  }

  it("builds a ledger only from proof-complete, non-ad-destination rows", () => {
    const sections = brandTimelinesFromRows([
      row({ id: "snap_1" }),
      // Proof-less row (the seeded-backfill shape): must never surface.
      row({
        id: "snap_2",
        captured_at: "2026-09-09T11:00:00.000Z",
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true }),
        raw_headline: "Fabricated would go here",
      }),
      // Ad-destination row: the ad wall's surface, never a dated offer.
      row({
        id: "snap_3",
        captured_at: "2026-09-09T12:00:00.000Z",
        is_ad_destination: 1,
        raw_headline: "Ad destination",
      }),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.domain).toBe("nike.com");
    expect(
      sections[0]?.entries.every((entry) => entry.headline !== "Fabricated would go here"),
    ).toBe(true);
    expect(
      sections[0]?.entries.every((entry) => entry.headline !== "Ad destination"),
    ).toBe(true);
  });

  it("drops a domain whose only rows fail the gates", () => {
    const sections = brandTimelinesFromRows([
      row({ id: "snap_1", artifact_key: null, metadata_json: "{}" }),
    ]);
    expect(sections).toEqual([]);
  });
});
