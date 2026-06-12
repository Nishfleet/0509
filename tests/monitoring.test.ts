import { describe, expect, it } from "vitest";

import { diffWatchlistObservations } from "~/lib/monitoring.server";
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
});
