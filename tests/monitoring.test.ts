import { describe, expect, it } from "vitest";

import {
  diffWatchlistObservations,
  filterSuppressedCreativeCopyDrafts,
} from "~/lib/monitoring.server";
import type { WatchlistRecord } from "~/lib/types";

const baseWatchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa weekly watch",
  targetType: "saved_query",
  targetId: "saved-1",
  targetFingerprint: "fp-1",
  targetLabel: "Nykaa competitors",
  targetCountry: null,
  isActive: true,
  lastScannedAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

function observation(overrides: Partial<ReturnType<typeof createObservation>> = {}) {
  return createObservation(overrides);
}

function createObservation(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "obs-1",
    ad_id: "ad-1",
    watchlist_run_id: "run-1",
    landing_page_snapshot_id: "lp-1",
    landing_page_url: "https://example.com/landing",
    normalized_headline_hash: "hash-a",
    raw_headline: "Landing headline",
    seen_at: "2026-03-28T00:00:00.000Z",
    is_active: 1,
    metadata_json: JSON.stringify({ advertiser: "Nykaa" }),
    ...overrides,
  };
}

describe("diffWatchlistObservations", () => {
  it("emits only scan-native ad_new and url change events against the baseline", () => {
    const events = diffWatchlistObservations(
      baseWatchlist,
      [
        observation({
          ad_id: "ad-1",
          landing_page_url: "https://example.com/new-url",
          normalized_headline_hash: "hash-b",
          raw_headline: "New headline",
        }),
        observation({
          id: "obs-2",
          ad_id: "ad-2",
          metadata_json: JSON.stringify({ advertiser: "Mamaearth" }),
        }),
      ],
      [observation()],
      [],
    );

    expect(events.map((event) => event.eventType)).toEqual([
      "landing_page_url_changed",
      "ad_new",
    ]);
  });

  it("does not emit headline-only changes during the cheap scan", () => {
    const events = diffWatchlistObservations(
      baseWatchlist,
      [
        observation({
          normalized_headline_hash: "hash-b",
          raw_headline: "New headline",
        }),
      ],
      [observation()],
      [],
    );

    expect(events).toEqual([]);
  });

  it("stays quiet for unchanged low-signal ads", () => {
    const events = diffWatchlistObservations(
      baseWatchlist,
      [
        observation({
          ad_id: "ad-1",
          landing_page_url: "https://example.com/landing",
          normalized_headline_hash: "hash-a",
          raw_headline: "Landing headline",
        }),
      ],
      [observation()],
      [observation()],
    );

    expect(events).toEqual([]);
  });

  it("marks an ad inactive only after two consecutive missed runs", () => {
    const events = diffWatchlistObservations(
      baseWatchlist,
      [],
      [],
      [observation({ ad_id: "ad-3" })],
    );

    expect(events).toEqual([
      expect.objectContaining({
        eventType: "ad_inactive",
        adId: "ad-3",
      }),
    ]);
  });

  it("emits one creative_copy event when hook/offer rewrite on a known ad", () => {
    const events = diffWatchlistObservations(
      baseWatchlist,
      [
        observation({
          ad_id: "ad-1",
          metadata_json: JSON.stringify({
            advertiser: "Nykaa",
            hook: "Weekend glow kit",
            offer: "20% off",
          }),
        }),
      ],
      [
        observation({
          ad_id: "ad-1",
          metadata_json: JSON.stringify({
            advertiser: "Nykaa",
            hook: "Soft skin kit",
            offer: "10% off",
          }),
        }),
      ],
      [],
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "landing_page_offer_changed",
      adId: "ad-1",
      title: "Ad creative copy changed",
      metadata: {
        kind: "creative_copy",
        from: "Hook: Soft skin kit · Offer: 10% off",
        to: "Hook: Weekend glow kit · Offer: 20% off",
        hookFrom: "Soft skin kit",
        hookTo: "Weekend glow kit",
        offerFrom: "10% off",
        offerTo: "20% off",
      },
    });
  });

  it("uses headline event type when only the hook rewrites", () => {
    const events = diffWatchlistObservations(
      baseWatchlist,
      [
        observation({
          metadata_json: JSON.stringify({
            advertiser: "Nykaa",
            hook: "New hook",
            offer: "Same offer",
          }),
        }),
      ],
      [
        observation({
          metadata_json: JSON.stringify({
            advertiser: "Nykaa",
            hook: "Old hook",
            offer: "Same offer",
          }),
        }),
      ],
      [],
    );

    expect(events).toEqual([
      expect.objectContaining({
        eventType: "landing_page_headline_changed",
        metadata: expect.objectContaining({ kind: "creative_copy" }),
      }),
    ]);
  });

  it("suppresses the same creative_copy pair within 48h either direction (FIX-2)", () => {
    const drafts = diffWatchlistObservations(
      baseWatchlist,
      [
        observation({
          ad_id: "ad-1",
          metadata_json: JSON.stringify({
            advertiser: "Nykaa",
            hook: "Ends in 2 days",
            offer: "20% off",
          }),
        }),
      ],
      [
        observation({
          ad_id: "ad-1",
          metadata_json: JSON.stringify({
            advertiser: "Nykaa",
            hook: "Ends in 3 days",
            offer: "20% off",
          }),
        }),
      ],
      [],
    );
    expect(drafts).toHaveLength(1);

    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const recent = [
      {
        adId: "ad-1",
        createdAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        metadata: {
          kind: "creative_copy",
          from: drafts[0]!.metadata.from,
          to: drafts[0]!.metadata.to,
        },
      },
    ];
    expect(filterSuppressedCreativeCopyDrafts(drafts, recent, now)).toEqual([]);

    // Reverse direction of the same pair is also suppressed.
    const reversed = [
      {
        adId: "ad-1",
        createdAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        metadata: {
          kind: "creative_copy",
          from: drafts[0]!.metadata.to,
          to: drafts[0]!.metadata.from,
        },
      },
    ];
    expect(filterSuppressedCreativeCopyDrafts(drafts, reversed, now)).toEqual([]);

    // Outside the 48h window the draft is allowed again.
    const stale = [
      {
        adId: "ad-1",
        createdAt: new Date(now - 50 * 60 * 60 * 1000).toISOString(),
        metadata: {
          kind: "creative_copy",
          from: drafts[0]!.metadata.from,
          to: drafts[0]!.metadata.to,
        },
      },
    ];
    expect(filterSuppressedCreativeCopyDrafts(drafts, stale, now)).toHaveLength(1);
  });

  it("collapses six ad_new drafts into one aggregate event", () => {
    const current = Array.from({ length: 6 }, (_, index) =>
      observation({
        id: `obs-new-${index}`,
        ad_id: `ad-new-${index}`,
        metadata_json: JSON.stringify({ advertiser: "Nykaa" }),
      }),
    );
    const events = diffWatchlistObservations(baseWatchlist, current, [], []);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "ad_new",
      adId: null,
      title: "6 new ads launched",
      metadata: {
        kind: "ad_new_aggregate",
        count: 6,
      },
    });
    expect((events[0]?.metadata as { adIds?: string[] }).adIds).toHaveLength(6);
  });

  it("does not collapse fewer than five ad_new events", () => {
    const current = Array.from({ length: 4 }, (_, index) =>
      observation({
        id: `obs-new-${index}`,
        ad_id: `ad-new-${index}`,
      }),
    );
    const events = diffWatchlistObservations(baseWatchlist, current, [], []);

    expect(events).toHaveLength(4);
    expect(events.every((event) => event.eventType === "ad_new")).toBe(true);
    expect(events.every((event) => event.metadata?.kind !== "ad_new_aggregate")).toBe(true);
  });
});
