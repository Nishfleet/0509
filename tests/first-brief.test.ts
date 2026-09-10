import { describe, expect, it } from "vitest";

import {
  FIRST_BRIEF_KIND,
  buildFirstBriefDigestItems,
  evidenceUrlFromMetadata,
  findFirstBriefDigest,
  firstBriefDigestHref,
  firstBriefEmailSubject,
  firstBriefPeriod,
  hasEvidenceLinkedItem,
  isFirstBriefDigest,
  marketDeskItemsFromFirstBrief,
  pickSignupFirstBriefBrandSuggestions,
  resolveEvidenceUrl,
  shouldEnsureFirstBrief,
  watchlistDomainForExistingHistory,
} from "~/lib/first-brief";

const event = {
  id: "event-1",
  eventType: "ad_new" as const,
  title: "Baseline captured: 3 active ads",
  summary: "We recorded 3 active ads for Glowkart as your starting point.",
  proofCaptureId: "proof-1",
  adId: null,
  createdAt: "2026-08-26T10:00:00.000Z",
  confirmedAt: "2026-08-26T10:00:01.000Z",
  metadata: { kind: "baseline", adsSeen: 3 },
};

const ad = {
  metaAdId: "ad-1",
  landingPageUrl: "https://glowkart.example/sale",
  adSnapshotUrl: "https://www.facebook.com/ads/library/?id=ad-1",
};

describe("first brief helpers", () => {
  it("recognizes a first-brief digest by summary.kind", () => {
    expect(isFirstBriefDigest({ summary: { kind: FIRST_BRIEF_KIND } })).toBe(true);
    expect(isFirstBriefDigest({ summary: { kind: "weekly" } })).toBe(false);
    expect(isFirstBriefDigest({ summary: {} })).toBe(false);
    expect(findFirstBriefDigest([
      {
        summary: { kind: FIRST_BRIEF_KIND },
        createdAt: "2026-08-26T10:00:00.000Z",
        items: [],
      },
    ])?.summary?.kind).toBe(FIRST_BRIEF_KIND);
  });

  it("builds a stable weekly-span period from the watchlist created time", () => {
    const period = firstBriefPeriod("2026-08-26T10:00:00.000Z");
    expect(period.periodStart).toBe("2026-08-26T10:00:00.000Z");
    expect(period.periodEnd).toBe("2026-09-02T10:00:00.000Z");
  });

  it("names the first-brief email without control characters", () => {
    expect(firstBriefEmailSubject("Glowkart")).toBe("Your first brief: Glowkart");
    expect(firstBriefEmailSubject("Glow\nkart\rBcc: x")).toBe("Your first brief: Glow kart Bcc: x");
    expect(firstBriefEmailSubject("   ")).toBe("Your first brief");
  });

  it("builds digest items only when an evidence URL exists", () => {
    const items = buildFirstBriefDigestItems({
      watchlistId: "watch-1",
      watchlistName: "Glowkart",
      events: [event],
      ads: [ad],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.metadata.eventId).toBe("event-1");
    expect(items[0]?.metadata.sourceUrl).toBe(
      "https://www.facebook.com/ads/library/?id=ad-1",
    );
    expect(items[0]?.metadata.proofCaptureId).toBe("proof-1");
    expect(hasEvidenceLinkedItem(items)).toBe(true);
  });

  it("drops events that have no capture, screenshot, or ad URL", () => {
    const items = buildFirstBriefDigestItems({
      watchlistId: "watch-1",
      watchlistName: "Glowkart",
      events: [event],
      ads: [],
    });
    expect(items).toEqual([]);
    expect(hasEvidenceLinkedItem(items)).toBe(false);
  });

  it("rejects javascript and other non-http evidence URLs", () => {
    expect(evidenceUrlFromMetadata({ sourceUrl: "javascript:alert(1)" })).toBeNull();
    expect(
      resolveEvidenceUrl({
        event: { ...event, metadata: { sourceUrl: "ftp://files.example/ad" } },
        ads: [],
      }),
    ).toBeNull();
  });

  it("turns a filed first brief into dashboard rows with working in-app links", () => {
    const rows = marketDeskItemsFromFirstBrief({
      digestId: "digest-1",
      items: [
        {
          watchlistId: "watch-1",
          title: "Baseline captured: 3 active ads",
          summary: "Starting point for Glowkart.",
          eventType: "ad_new",
          metadata: {
            eventId: "event-1",
            sourceUrl: "https://glowkart.example/sale",
          },
        },
      ],
    });
    expect(rows).toEqual([
      {
        label: "Evidence",
        title: "Baseline captured: 3 active ads",
        detail: "Starting point for Glowkart.",
        href: "/app/watchlists?watchlist=watch-1&event=event-1",
      },
    ]);
    expect(firstBriefDigestHref("digest-1")).toBe(
      "/app/digests?digest=digest-1&firstrun=1#first-brief-detail",
    );
  });

  it("catch-up files when an active watchlist has no evidence brief yet", () => {
    expect(
      shouldEnsureFirstBrief({
        watchlists: [{ isActive: true, lastScannedAt: "2026-08-26T10:00:00.000Z" }],
        digests: [],
      }),
    ).toBe(true);
    expect(
      shouldEnsureFirstBrief({
        watchlists: [{ isActive: true, lastScannedAt: null }],
        digests: [],
      }),
    ).toBe(true);
    expect(
      shouldEnsureFirstBrief({
        watchlists: [{ isActive: false, lastScannedAt: "2026-08-26T10:00:00.000Z" }],
        digests: [],
      }),
    ).toBe(false);
    expect(
      shouldEnsureFirstBrief({
        watchlists: [{ isActive: true, lastScannedAt: "2026-08-26T10:00:00.000Z" }],
        digests: [
          {
            summary: { kind: FIRST_BRIEF_KIND },
            createdAt: "2026-08-26T10:00:00.000Z",
            items: [
              {
                id: "item-1",
                digestRunId: "digest-1",
                watchlistId: "watch-1",
                watchlistName: "Glowkart",
                eventType: "ad_new",
                title: "Baseline captured",
                summary: "Starting point.",
                createdAt: "2026-08-26T10:00:00.000Z",
                metadata: { sourceUrl: "https://glowkart.example/sale" },
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it("reads the competitor host from a website watchlist target", () => {
    expect(
      watchlistDomainForExistingHistory({
        targetId: "https://www.nike.com/in",
        targetLabel: "Nike",
      }),
    ).toBe("nike.com");
    expect(
      watchlistDomainForExistingHistory({
        targetId: "saved-query-1",
        targetLabel: "running shoes",
      }),
    ).toBeNull();
    expect(
      watchlistDomainForExistingHistory({
        targetLabel: "Pending Labs",
      }),
    ).toBeNull();
  });
});

/**
 * Issue #2411 — the `no_ads` terminal state offers adjacent already-tracked
 * brands instead of dead-ending. These lock the picker's three properties:
 * same-category siblings come first, the user's own competitor is never
 * suggested, and the result is deterministic and bounded.
 */
describe("pickSignupFirstBriefBrandSuggestions (issue #2411)", () => {
  const brands = [
    { name: "Nike", domain: "nike.com", path: "/ads/nike.com" },
    { name: "Adidas", domain: "adidas.com", path: "/ads/adidas.com" },
    { name: "HubSpot", domain: "hubspot.com", path: "/ads/hubspot.com" },
    { name: "Nykaa", domain: "nykaa.com", path: "/ads/nykaa.com" },
    { name: "Mamaearth", domain: "mamaearth.com", path: "/ads/mamaearth.com" },
  ];

  it("prefers brands in the same buyer category as the current competitor", () => {
    // adidas.com is "Sport & footwear"; nike.com and allbirds.com share it.
    const picked = pickSignupFirstBriefBrandSuggestions(brands, "nike.com");
    expect(picked.map((brand) => brand.domain)).toEqual([
      "adidas.com",
      "hubspot.com",
      "mamaearth.com",
    ]);
    // The user's own competitor is never suggested.
    expect(picked.map((brand) => brand.domain)).not.toContain("nike.com");
  });

  it("fills the slot with same-category siblings before falling back", () => {
    const picked = pickSignupFirstBriefBrandSuggestions(brands, "nykaa.com");
    // Nykaa is "Beauty & personal care" — mamaearth.com is the only other
    // member in this fixture, so it leads and the rest fill deterministically.
    expect(picked.map((brand) => brand.domain)).toEqual([
      "mamaearth.com",
      "adidas.com",
      "hubspot.com",
    ]);
  });

  it("is bounded to three and deterministic across calls", () => {
    const first = pickSignupFirstBriefBrandSuggestions(brands, "nike.com");
    const second = pickSignupFirstBriefBrandSuggestions(brands, "nike.com");
    expect(first).toHaveLength(3);
    expect(first).toEqual(second);
  });

  it("degrades to the deterministic slice for an unknown or absent competitor", () => {
    // glowkart.example is in the "More brands" fallback bucket, and a null
    // competitor has no category at all — both must still produce real tracked
    // brands rather than an empty cluster or an invented one.
    for (const current of ["glowkart.example", null]) {
      const picked = pickSignupFirstBriefBrandSuggestions(brands, current);
      expect(picked).toHaveLength(3);
      expect(picked.map((brand) => brand.domain)).toEqual([
        "adidas.com",
        "hubspot.com",
        "mamaearth.com",
      ]);
    }
  });

  it("returns an empty list when nothing else is tracked", () => {
    expect(
      pickSignupFirstBriefBrandSuggestions(
        [{ name: "Nike", domain: "nike.com", path: "/ads/nike.com" }],
        "nike.com",
      ),
    ).toEqual([]);
    expect(pickSignupFirstBriefBrandSuggestions([], "nike.com")).toEqual([]);
  });
});
