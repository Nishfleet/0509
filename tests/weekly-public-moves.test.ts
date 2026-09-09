import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryAllMock, loadOfferTimelineMock } = vi.hoisted(() => ({
  queryAllMock: vi.fn(),
  loadOfferTimelineMock: vi.fn(),
}));

vi.mock("~/lib/data/d1.server", () => ({
  queryAll: queryAllMock,
}));

vi.mock("~/lib/offer-timeline.server", () => ({
  loadOfferTimeline: loadOfferTimelineMock,
}));

import { loadWeeklyPublicMoves } from "~/lib/weekly-public-moves.server";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const IN_WINDOW = "2026-09-08T06:00:00.000Z";
const OUT_OF_WINDOW = "2026-08-20T06:00:00.000Z";

function ledgerEntry(overrides: Record<string, unknown>) {
  return {
    id: "entry-1",
    capturedAt: IN_WINDOW,
    dateLabel: "8 Sep 2026",
    canonicalUrl: "https://nike.com/",
    headline: "Just do it",
    ctaText: "Shop now",
    priceText: "30% off",
    formPresent: null,
    screenshotHref: null,
    pageTextHref: null,
    evidenceNote: null,
    transition: null,
    suppressedReason: null,
    ...overrides,
  };
}

describe("loadWeeklyPublicMoves", () => {
  beforeEach(() => {
    queryAllMock.mockReset();
    loadOfferTimelineMock.mockReset();
  });

  it("returns [] without a D1 binding", async () => {
    await expect(loadWeeklyPublicMoves({} as never, { now: NOW })).resolves.toEqual([]);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  it("returns [] when the snapshot table does not exist (local/dev parity)", async () => {
    queryAllMock.mockRejectedValue(new Error("no such table: landing_page_snapshot"));
    await expect(
      loadWeeklyPublicMoves({ DB: {} } as never, { now: NOW }),
    ).resolves.toEqual([]);
  });

  it("rethrows unexpected D1 failures rather than hiding them", async () => {
    queryAllMock.mockRejectedValue(new Error("disk i/o error"));
    await expect(
      loadWeeklyPublicMoves({ DB: {} } as never, { now: NOW }),
    ).rejects.toThrow("disk i/o error");
  });

  it("returns the newest in-window public offer move with its timeline path", async () => {
    queryAllMock.mockResolvedValue([
      { canonical_url: "https://www.nike.com/", captured_at: IN_WINDOW },
    ]);
    loadOfferTimelineMock.mockResolvedValue({
      entries: [
        ledgerEntry({ id: "older", capturedAt: "2026-09-01T06:00:00.000Z" }),
        ledgerEntry({
          id: "newer",
          capturedAt: IN_WINDOW,
          transition: {
            priceText: { from: "20% off", to: "30% off" },
            ctaText: null,
            headline: null,
            formPresent: null,
          },
        }),
      ],
    });

    const moves = await loadWeeklyPublicMoves({ DB: {} } as never, { now: NOW });
    expect(moves).toEqual([
      {
        domain: "nike.com",
        brandName: "Nike",
        fieldLabel: "its offer",
        changedAt: IN_WINDOW,
        path: "/timeline/nike.com",
      },
    ]);
    // The candidate query is bounded and windowed (args: env, sql, ...binds).
    const [, sql, windowStart, limit] = queryAllMock.mock.calls[0];
    expect(sql).toContain("landing_page_snapshot");
    expect(windowStart).toBe("2026-09-02T12:00:00.000Z");
    expect(limit).toBe(60);
    // The domain is re-verified through the public page's own gate chain.
    expect(loadOfferTimelineMock).toHaveBeenCalledWith(
      { DB: {} },
      { domain: "nike.com", asOf: null },
    );
  });

  it("skips domains whose newest transitions fall outside the window", async () => {
    queryAllMock.mockResolvedValue([
      { canonical_url: "https://nike.com/", captured_at: IN_WINDOW },
    ]);
    loadOfferTimelineMock.mockResolvedValue({
      entries: [
        ledgerEntry({
          capturedAt: OUT_OF_WINDOW,
          transition: {
            priceText: { from: "20% off", to: "30% off" },
            ctaText: null,
            headline: null,
            formPresent: null,
          },
        }),
      ],
    });
    await expect(
      loadWeeklyPublicMoves({ DB: {} } as never, { now: NOW }),
    ).resolves.toEqual([]);
  });

  it("skips entries without a real transition (suppressed pairs never pose as moves)", async () => {
    queryAllMock.mockResolvedValue([
      { canonical_url: "https://nike.com/", captured_at: IN_WINDOW },
    ]);
    loadOfferTimelineMock.mockResolvedValue({
      entries: [
        ledgerEntry({
          capturedAt: IN_WINDOW,
          transition: null,
          suppressedReason: "geo_locale_only",
        }),
      ],
    });
    await expect(
      loadWeeklyPublicMoves({ DB: {} } as never, { now: NOW }),
    ).resolves.toEqual([]);
  });

  it("degrades a failing domain lookup instead of failing the digest send", async () => {
    queryAllMock.mockResolvedValue([
      { canonical_url: "https://nike.com/", captured_at: IN_WINDOW },
      { canonical_url: "https://adidas.com/", captured_at: IN_WINDOW },
    ]);
    loadOfferTimelineMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        entries: [
          ledgerEntry({
            canonicalUrl: "https://adidas.com/",
            transition: {
              priceText: null,
              ctaText: { from: "Shop now", to: "Join the club" },
              headline: null,
              formPresent: null,
            },
          }),
        ],
      });

    const moves = await loadWeeklyPublicMoves({ DB: {} } as never, { now: NOW });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      domain: "adidas.com",
      fieldLabel: "its call to action",
      path: "/timeline/adidas.com",
    });
  });

  it("caps candidate domains and respects the limit option", async () => {
    queryAllMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        canonical_url: `https://brand${index}.example.com/`,
        captured_at: IN_WINDOW,
      })),
    );
    loadOfferTimelineMock.mockResolvedValue({
      entries: [
        ledgerEntry({
          transition: {
            priceText: { from: "10% off", to: "20% off" },
            ctaText: null,
            headline: null,
            formPresent: null,
          },
        }),
      ],
    });

    const moves = await loadWeeklyPublicMoves(
      { DB: {} } as never,
      { now: NOW, limit: 2 },
    );
    expect(moves).toHaveLength(2);
    // Candidate domain cap: at most 5 timeline lookups no matter how many rows.
    expect(loadOfferTimelineMock.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
