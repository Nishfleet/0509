import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import type { WeeklyPublicMove } from "~/lib/weekly-public-moves.server";

/**
 * Issue #2143 — /briefs/weekly + the weekly-offer-moves data post.
 *
 * Covered here:
 *   1. loadWeeklyPublicMoves publishes moves ONLY for sitemap-indexable
 *      domains (the reused sitemap gate helpers) and can never leak
 *      customer-private strings (PII by construction).
 *   2. The route renders an honest quiet state when nothing moved.
 *   3. The report script prints a sub-400-word post with >= 5 public links
 *      from the fixture.
 */

const SINCE = "2026-09-02T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Loader tests — mocked D1 (queryAll) + mocked sitemap gate helpers.
// ---------------------------------------------------------------------------

let queryAll: ReturnType<typeof vi.fn>;
let loadOfferTimeline: ReturnType<typeof vi.fn>;
let loadIndexableBrandPageEntries: ReturnType<typeof vi.fn>;
let loadIndexableTimelineEntries: ReturnType<typeof vi.fn>;

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "landing_page_offer_changed",
    title: "Landing page offer changed",
    metadata_json: JSON.stringify({ from: "₹999", to: "₹799" }),
    created_at: "2026-09-08T04:31:00.000Z",
    target_id: "https://nykaa.com",
    ...overrides,
  };
}

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    canonical_url: "https://nykaa.com/glow-serum",
    captured_at: "2026-09-08T04:30:00.000Z",
    artifact_key: null,
    metadata_json: null,
    is_ad_destination: 0,
    ...overrides,
  };
}

function ledgerEntry(overrides: Partial<OfferLedgerEntry> = {}): OfferLedgerEntry {
  return {
    id: "entry-1",
    capturedAt: "2026-09-08T04:30:00.000Z",
    dateLabel: "8 Sept 2026",
    canonicalUrl: "https://nykaa.com/glow-serum",
    headline: "Glow serum",
    ctaText: "Shop the sale",
    priceText: "₹799",
    formPresent: null,
    screenshotHref: null,
    pageTextHref: null,
    evidenceNote: null,
    transition: null,
    runExtentLabel: null,
    ...overrides,
  };
}

function installLoaderMocks(options: {
  eventRows?: unknown[];
  snapshotRows?: unknown[];
  adsPaths?: string[];
  timelinePaths?: string[];
  ledgerEntries?: OfferLedgerEntry[];
} = {}) {
  queryAll = vi.fn().mockImplementation((_env: unknown, sql: string) => {
    if (sql.includes("FROM watch_event")) {
      return Promise.resolve(options.eventRows ?? []);
    }
    if (sql.includes("FROM landing_page_snapshot")) {
      return Promise.resolve(options.snapshotRows ?? []);
    }
    return Promise.resolve([]);
  });
  loadIndexableBrandPageEntries = vi.fn().mockResolvedValue(
    (options.adsPaths ?? ["/ads/nykaa.com", "/ads/meesho.com"]).map((path) => ({ path })),
  );
  loadIndexableTimelineEntries = vi.fn().mockResolvedValue(
    (options.timelinePaths ?? ["/timeline/nykaa.com"]).map((path) => ({ path })),
  );
  loadOfferTimeline = vi.fn().mockResolvedValue({
    entries: options.ledgerEntries ?? [],
    asOfState: null,
  });

  vi.doMock("~/lib/data/d1.server", () => ({ queryAll }));
  vi.doMock("~/lib/sitemap.server", async () => {
    const actual = await vi.importActual<typeof import("~/lib/sitemap.server")>(
      "~/lib/sitemap.server",
    );
    return {
      ...actual,
      loadIndexableBrandPageEntries,
      loadIndexableTimelineEntries,
    };
  });
  vi.doMock("~/lib/offer-timeline.server", async () => {
    const actual = await vi.importActual<typeof import("~/lib/offer-timeline.server")>(
      "~/lib/offer-timeline.server",
    );
    return { ...actual, loadOfferTimeline };
  });
}

async function runMovesLoader(env: Record<string, unknown> = { DB: {} }) {
  const { loadWeeklyPublicMoves } = await import("~/lib/weekly-public-moves.server");
  return loadWeeklyPublicMoves(env as never, { since: SINCE });
}

describe("loadWeeklyPublicMoves (issue #2143)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("~/lib/data/d1.server");
    vi.doUnmock("~/lib/sitemap.server");
    vi.doUnmock("~/lib/offer-timeline.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns the quiet state (no reads) when no domain is sitemap-indexable", async () => {
    installLoaderMocks({ adsPaths: [], timelinePaths: [], eventRows: [eventRow()] });

    const moves = await runMovesLoader();

    expect(moves).toEqual([]);
    // The privacy gate short-circuits before any content read: a
    // customer-private watchlist's rows are never even selected.
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("returns nothing when D1 is absent", async () => {
    installLoaderMocks();
    await expect(runMovesLoader({})).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("publishes only sitemap-indexable domains and never leaks customer-private strings", async () => {
    installLoaderMocks({
      eventRows: [
        // Indexable domain — included. The metadata deliberately carries PII
        // in fields the loader must never read.
        eventRow({
          metadata_json: JSON.stringify({
            from: "₹999",
            to: "₹799",
            capturedAt: "2026-09-08T04:30:00.000Z",
            note: "call ravi@example.com for context",
            watchlistName: "Nish's secret watch",
          }),
        }),
        // Non-indexable (customer-private) domain — excluded even though a
        // confirmed event exists.
        eventRow({
          metadata_json: JSON.stringify({ from: "$50", to: "$40" }),
          created_at: "2026-09-08T05:00:00.000Z",
          target_id: "https://internal-secret.com",
        }),
        // First-scan baseline bookkeeping is not a competitor move.
        eventRow({
          event_type: "ad_new",
          title: "Baseline captured: 12 active ads",
          metadata_json: JSON.stringify({ kind: "baseline", adsSeen: 12 }),
          created_at: "2026-09-08T06:00:00.000Z",
        }),
        // Aggregate new-ads event on a second indexable domain — included.
        eventRow({
          event_type: "ad_new",
          title: "3 new ads launched",
          metadata_json: JSON.stringify({ kind: "ad_new_aggregate", count: 3 }),
          created_at: "2026-09-07T11:00:00.000Z",
          target_id: "https://meesho.com",
        }),
      ],
      snapshotRows: [
        snapshotRow(),
        // In-window snapshot for a non-indexable domain — its ledger is
        // never even read.
        snapshotRow({ id: "snap-x", canonical_url: "https://internal-secret.com/offer" }),
      ],
      ledgerEntries: [
        // The price half duplicates the watch event (deduped); the CTA half
        // is a second, distinct move.
        ledgerEntry({
          transition: {
            headline: null,
            priceText: { before: "₹999", after: "₹799" },
            ctaText: { before: "Shop now", after: "Shop the sale" },
            formPresent: null,
          },
        }),
        // Suppressed by the capture-validity gate — never published.
        ledgerEntry({
          id: "entry-geo",
          capturedAt: "2026-09-07T10:00:00.000Z",
          suppressedReason: "differs only by geo locale",
          transition: {
            headline: { before: "A", after: "B" },
            priceText: null,
            ctaText: null,
            formPresent: null,
          },
        }),
        // Older than the 7-day window — excluded.
        ledgerEntry({
          id: "entry-old",
          capturedAt: "2026-08-20T10:00:00.000Z",
          transition: {
            headline: { before: "Old", after: "Older" },
            priceText: null,
            ctaText: null,
            formPresent: null,
          },
        }),
      ],
    });

    const moves = await runMovesLoader();

    // 3 moves: nykaa offer (watch event), nykaa CTA (ledger), meesho new ads.
    expect(moves).toHaveLength(3);
    expect(moves.map((move) => move.domain).sort()).toEqual([
      "meesho.com",
      "nykaa.com",
      "nykaa.com",
    ]);

    // The non-indexable domain's event AND snapshot are both excluded, and
    // its ledger read never happens.
    const serialized = JSON.stringify(moves);
    expect(serialized).not.toContain("internal-secret.com");
    expect(loadOfferTimeline).toHaveBeenCalledTimes(1);
    expect(loadOfferTimeline).toHaveBeenCalledWith(expect.anything(), {
      domain: "nykaa.com",
      asOf: null,
    });

    // PII by construction: customer-private strings from event metadata
    // never reach the output, and the event SELECT never touches the
    // watchlist name or user id.
    expect(serialized).not.toContain("ravi@example.com");
    expect(serialized).not.toContain("Nish's secret watch");
    const eventSql = queryAll.mock.calls[0]![1] as string;
    expect(eventSql).not.toMatch(/w\.name|user_id/);
    expect(eventSql).toContain("we.status = 'confirmed'");
    expect(queryAll.mock.calls[0]![2]).toBe(SINCE);

    // The baseline event is not a move.
    expect(serialized).not.toContain("Baseline captured");

    // Brand labels derive from the public domain, never customer input.
    const offerMove = moves.find(
      (move) => move.domain === "nykaa.com" && move.field === "Offer / price",
    );
    expect(offerMove).toMatchObject({
      brand: "Nykaa",
      beforeText: "₹999",
      afterText: "₹799",
      capturedAt: "2026-09-08T04:30:00.000Z",
      adsPath: "/ads/nykaa.com",
      timelinePath: "/timeline/nykaa.com",
    });

    // A domain whose timeline is NOT sitemap-indexable gets no timeline
    // link (a 410/noindex page is never linked), but keeps its /ads link.
    const adsMove = moves.find((move) => move.domain === "meesho.com");
    expect(adsMove).toMatchObject({
      brand: "Meesho",
      field: "New ads",
      afterText: "3 new ads launched",
      adsPath: "/ads/meesho.com",
      timelinePath: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Route tests — loader wiring + honest quiet state.
// ---------------------------------------------------------------------------

function createContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

describe("/briefs/weekly route (issue #2143)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/weekly-public-moves.server");
    vi.doUnmock("react-router");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("loader reads the last 7 days and passes the moves through", async () => {
    const loadWeeklyPublicMoves = vi.fn().mockResolvedValue([
      {
        brand: "Nykaa",
        domain: "nykaa.com",
        field: "Offer / price",
        beforeText: "₹999",
        afterText: "₹799",
        sourceUrl: "https://nykaa.com/glow-serum",
        capturedAt: "2026-09-08T04:30:00.000Z",
        adsPath: "/ads/nykaa.com",
        timelinePath: "/timeline/nykaa.com",
      },
    ]);
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/weekly-public-moves.server", () => ({
      loadWeeklyPublicMoves,
      WEEKLY_MOVES_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
    }));

    const { loader } = await import("~/routes/briefs.weekly");
    const before = Date.now();
    const data = await (loader as (args: unknown) => Promise<{
      moves: unknown[];
      since: string;
    }>)({ context: createContext({ DB: {} }) });
    const after = Date.now();

    expect(data.moves).toHaveLength(1);
    const sinceMs = Date.parse(data.since);
    const windowMs = 7 * 24 * 60 * 60 * 1000;
    expect(sinceMs).toBeGreaterThanOrEqual(before - windowMs - 1000);
    expect(sinceMs).toBeLessThanOrEqual(after - windowMs + 1000);
    expect(loadWeeklyPublicMoves).toHaveBeenCalledWith(expect.anything(), {
      since: data.since,
    });
  });

  it("loader degrades to the quiet state when the read throws", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/weekly-public-moves.server", () => ({
      loadWeeklyPublicMoves: vi.fn().mockRejectedValue(new Error("D1 down")),
      WEEKLY_MOVES_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
    }));

    const { loader } = await import("~/routes/briefs.weekly");
    const data = await (loader as (args: unknown) => Promise<{ moves: unknown[] }>)({
      context: createContext({ DB: {} }),
    });
    expect(data.moves).toEqual([]);
  });

  async function renderRoute(data: { moves: WeeklyPublicMove[]; since: string }) {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        useLoaderData: () => data,
        useRouteLoaderData: () => undefined,
        Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      };
    });
    const { default: BriefsWeeklyRoute } = await import("~/routes/briefs.weekly");
    return renderToStaticMarkup(createElement(BriefsWeeklyRoute));
  }

  it("renders an honest quiet state when nothing moved — never a fabricated list", async () => {
    const markup = await renderRoute({ moves: [], since: SINCE });

    expect(markup).toContain("quiet week");
    expect(markup).toContain("no brand with a public page changed its");
    expect(markup).not.toContain("ld-trail");
  });

  it("renders each move with before/after, capture date, source, and /ads + /timeline links", async () => {
    const markup = await renderRoute({
      since: SINCE,
      moves: [
        {
          brand: "Nykaa",
          domain: "nykaa.com",
          field: "Offer / price",
          beforeText: "₹999",
          afterText: "₹799",
          sourceUrl: "https://nykaa.com/glow-serum",
          capturedAt: "2026-09-08T04:30:00.000Z",
          adsPath: "/ads/nykaa.com",
          timelinePath: "/timeline/nykaa.com",
        },
      ],
    });

    expect(markup).toContain("Offer / price");
    expect(markup).toContain("₹999 → ₹799");
    expect(markup).toContain('href="/ads/nykaa.com"');
    expect(markup).toContain('href="/timeline/nykaa.com"');
    expect(markup).toContain('href="https://nykaa.com/glow-serum"');
    expect(markup).toContain('dateTime="2026-09-08T04:30:00.000Z"');
  });
});

// ---------------------------------------------------------------------------
// Script tests — word and link counts from the fixture.
// ---------------------------------------------------------------------------

describe("weekly-offer-moves-report.mjs (issue #2143)", () => {
  function runScript(args: string[]) {
    return execFileSync(
      process.execPath,
      ["scripts/weekly-offer-moves-report.mjs", ...args],
      { encoding: "utf8" },
    );
  }

  function writeFixture(moves: Array<Record<string, unknown>>) {
    const dir = mkdtempSync(join(tmpdir(), "offer-moves-"));
    const path = join(dir, "moves.json");
    writeFileSync(path, JSON.stringify(moves));
    return path;
  }

  function offerMove(beforeText: string, afterText: string) {
    return {
      brand: "Nykaa",
      domain: "nykaa.com",
      field: "Offer / price",
      beforeText,
      afterText,
      capturedAt: "2026-09-08T04:30:00.000Z",
      adsPath: "/ads/nykaa.com",
      timelinePath: "/timeline/nykaa.com",
    };
  }

  it("prints a sub-400-word post with at least five public links from the fixture", () => {
    const output = runScript([
      "--dry-run",
      "--fixture",
      "tests/fixtures/offer-moves.json",
    ]);

    const words = output.trim().split(/\s+/).length;
    expect(words).toBeGreaterThan(0);
    expect(words).toBeLessThanOrEqual(400);

    const links = output.match(/https:\/\/0509\.io\/(ads|timeline)\//g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(5);

    // Counts from the fixture: 3 new ads, 3 offer changes, 2 price drops.
    expect(output).toContain("3 new ads");
    expect(output).toContain("3 offer changes");
    expect(output).toContain("2 price drops");

    // Top-five moves carry capture timestamps.
    expect(output).toContain("captured 2026-09-08");

    // The sixth (oldest) fixture move is truncated out of the top five.
    expect(output).not.toContain("₹1,299");
  });

  it("does not count a BOGO-shaped offer move as a price drop (issue #2488)", () => {
    const fixture = writeFixture([
      offerMove("buy 2 get 1", "buy 1 get 1"),
    ]);
    const output = runScript(["--dry-run", "--fixture", fixture]);
    expect(output).toContain("1 offer changes");
    expect(output).not.toContain("1 price drops");
  });

  it.each([
    ["up to 70% off", "up to 50% off"],
    ["₹999", "up to 50% off"],
    ["$100", "₹50"],
    ["999", "799"],
  ])(
    "does not count %j -> %j as a price drop (issue #2488)",
    (beforeText, afterText) => {
      const fixture = writeFixture([offerMove(beforeText, afterText)]);
      const output = runScript(["--dry-run", "--fixture", fixture]);
      expect(output).toContain("0 price drops");
    },
  );

  it("counts only same-currency decreases as price drops (issue #2488)", () => {
    const fixture = writeFixture([
      offerMove("up to 70% off", "up to 50% off"),
      offerMove("₹999", "up to 50% off"),
      offerMove("$100", "₹50"),
      offerMove("999", "799"),
      offerMove("₹1,299", "₹999"),
      offerMove("USD 100", "USD 50"),
    ]);
    const output = runScript(["--dry-run", "--fixture", fixture]);
    expect(output).toContain("6 offer changes");
    expect(output).toContain("2 price drops");
  });

  it("refuses to run without --dry-run (there is no posting mode)", () => {
    expect(() =>
      runScript(["--fixture", "tests/fixtures/offer-moves.json"]),
    ).toThrow();
  });

  it("refuses to run without a fixture (never touches live data)", () => {
    expect(() => runScript(["--dry-run"])).toThrow();
  });
});
