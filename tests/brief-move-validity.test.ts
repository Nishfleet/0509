/**
 * Move-validity gate for the public offer-moves brief (issue #3128).
 *
 * A placeholder-price row ($0.00 → £0.00), a baseline-only row ($149 with no
 * prior capture) and one real offer change must render exactly ONE move row.
 * The fixture mirrors the two sources the /briefs/weekly render draws from:
 * the offer-ledger diff (offer-timeline) and the watch-event mapper
 * (weekly-public-moves).
 */
import { describe, expect, it } from "vitest";

import {
  buildOfferLedger,
  isPlaceholderOfferPrice,
  type OfferSnapshotInput,
} from "~/lib/offer-timeline";
import {
  isPublishableWeeklyMove,
  offerLedgerEntryToPublicMoves,
  watchEventRowToPublicMove,
  WEEKLY_MOVE_FIELD,
} from "~/lib/weekly-public-moves.server";

const LINKS = { adsPath: "/ads/mamaearth.com", timelinePath: "/timeline/mamaearth.com" };

function snapshot(capturedAt: string, priceText: string | null): OfferSnapshotInput {
  return {
    id: `snap-${capturedAt}`,
    canonicalUrl: "https://mamaearth.com/en-fr",
    capturedAt,
    headline: "Headline",
    ctaText: "Add to cart",
    priceText,
    formPresent: true,
    screenshotKey: "screenshots/valid-key-1.jpg",
    pageTextKey: "page-text/valid-key-1.txt",
    evidenceNote: null,
  };
}

describe("isPlaceholderOfferPrice", () => {
  it("flags the observed currency-zero placeholders", () => {
    expect(isPlaceholderOfferPrice("$0.00")).toBe(true);
    expect(isPlaceholderOfferPrice("£0.00")).toBe(true);
    expect(isPlaceholderOfferPrice("€0,00")).toBe(true);
  });

  it("accepts real prices", () => {
    expect(isPlaceholderOfferPrice("$149")).toBe(false);
    expect(isPlaceholderOfferPrice("$29.99")).toBe(false);
    expect(isPlaceholderOfferPrice("Up to 25% Off")).toBe(false);
  });
});

describe("brief move-validity (issue #3128)", () => {
  it("a ledger with two placeholder prices and one real change yields NO placeholder move", () => {
    const ledger = buildOfferLedger([
      snapshot("2026-09-09T04:01:56.218Z", "$0.00"),
      snapshot("2026-09-10T04:01:57.721Z", "€0,00"),
      snapshot("2026-09-11T04:01:58.000Z", "$29.99"),
    ]);
    const priceMoves = ledger.flatMap((entry) =>
      offerLedgerEntryToPublicMoves(entry, "mamaearth.com", LINKS).filter(
        (move) => move.field === WEEKLY_MOVE_FIELD.offerPrice,
      ),
    );
    // currency-only placeholder diffs ($0.00 → €0,00) are not moves; the
    // first REAL prior→new pair ($0.00 → $29.99) is also gated because the
    // before half is a placeholder. Nothing placeholder ever renders.
    expect(priceMoves).toHaveLength(0);
  });

  it("a real offer change still renders exactly one move row", () => {
    const ledger = buildOfferLedger([
      snapshot("2026-09-09T04:01:56.218Z", "$24.99"),
      snapshot("2026-09-11T04:01:58.000Z", "$19.99"),
    ]);
    const moves = ledger.flatMap((entry) =>
      offerLedgerEntryToPublicMoves(entry, "mamaearth.com", LINKS),
    );
    expect(moves.filter((m) => m.field === WEEKLY_MOVE_FIELD.offerPrice)).toHaveLength(1);
  });

  it("a baseline-only watch event (single value) is never a move", () => {
    // Mirror of the live Nike row: a confirmed offer_changed event with only
    // a "to" value and no prior capture.
    const row = {
      event_type: "landing_page_offer_changed",
      title: "Offer flagged",
      metadata_json: JSON.stringify({ to: "$149", capturedAt: "2026-09-10T04:00:53.533Z" }),
      created_at: "2026-09-10T04:00:53.533Z",
      target_id: "https://nike.com",
    };
    const move = watchEventRowToPublicMove(row, "nike.com", LINKS);
    expect(move).toBeNull();
  });

  it("a placeholder-pair watch event ($0.00 → £0.00) is never a move", () => {
    const row = {
      event_type: "landing_page_offer_changed",
      title: "Offer changed",
      metadata_json: JSON.stringify({ from: "$0.00", to: "£0.00" }),
      created_at: "2026-09-11T04:02:38.601Z",
      target_id: "https://mamaearth.com",
    };
    const move = watchEventRowToPublicMove(row, "mamaearth.com", LINKS);
    expect(move).toBeNull();
  });

  it("the final gate fixture: placeholder + baseline + real change → exactly one move", () => {
    const candidates = [
      {
        field: WEEKLY_MOVE_FIELD.offerPrice,
        beforeText: "$0.00",
        afterText: "£0.00",
      },
      {
        field: WEEKLY_MOVE_FIELD.offerPrice,
        beforeText: null,
        afterText: "$149",
      },
      {
        field: WEEKLY_MOVE_FIELD.offerPrice,
        beforeText: "$24.99",
        afterText: "$19.99",
      },
    ] as const;
    const published = candidates.filter((m) => isPublishableWeeklyMove(m));
    expect(published).toHaveLength(1);
    expect(published[0]!.beforeText).toBe("$24.99");
    expect(published[0]!.afterText).toBe("$19.99");
  });
});
