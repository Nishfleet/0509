import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  loadRecentSitemapTimelineCaptureDays,
  orderSitemapTimelineCohortByCaptureStaleness,
  parseSitemapTimelineBackfillRowId,
  runSitemapTimelineBackfill,
} from "~/lib/sitemap-timeline-backfill.server";
import {
  emptySitemapTimelineTier,
  type SitemapTimelineCohortEntry,
  type SitemapTimelineTier,
} from "~/lib/sitemap-timeline-cohort";

/**
 * Issue #3357's half of the sitemap-timeline rail suite, split out of
 * `tests/sitemap-timeline-backfill.server.test.ts` so neither file crosses
 * the tests/ 800-line ratchet (the ratchet's seed list only ever shrinks).
 * Same hoisted-mock + reset contract as the sibling file: the node project
 * shares a module registry with the sneaker-resale suite, so every mock is a
 * hoisted re-declare and `afterEach` restores + resets.
 */

const queryOne = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
const queryAll = vi.hoisted(() => vi.fn());
const replaceAnalysisFields = vi.hoisted(() => vi.fn());
const loadIndexableTimelineEntries = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryOne,
  execute,
  queryAll,
  queryIn: vi.fn(),
  ensureDb: vi.fn(),
}));

vi.mock("~/lib/data/ads.server", () => ({
  // Issue #2442: the backfill writes now dedupe on the schema's
  // content_key generated column and call this helper for the skip-path
  // read-back. Mirror the real implementation.
  landingPageSnapshotContentKey: (snapshot: {
    canonicalUrl: string;
    normalizedHeadlineHash: string;
    ctaText?: string | null;
    priceText?: string | null;
    formPresent?: boolean | null;
  }) =>
    [
      snapshot.canonicalUrl,
      snapshot.normalizedHeadlineHash,
      snapshot.ctaText ?? "",
      snapshot.priceText ?? "",
      typeof snapshot.formPresent === "boolean" ? (snapshot.formPresent ? 1 : 0) : -1,
    ].join("|"),
  replaceAnalysisFields,
}));

vi.mock("~/lib/landing-pages.server", () => ({
  captureLandingPageSnapshot: vi.fn(),
}));

// Mock at the adapter boundary (wraps `loadIndexableTimelineEntries`).
vi.mock("~/lib/sitemap.server", () => ({
  loadIndexableTimelineEntries,
  loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([]),
}));

afterEach(() => {
  vi.restoreAllMocks();
  queryOne.mockReset();
  execute.mockReset();
  queryAll.mockReset();
  replaceAnalysisFields.mockReset();
  loadIndexableTimelineEntries.mockReset();
});

beforeEach(() => {
  replaceAnalysisFields.mockResolvedValue(undefined);
  loadIndexableTimelineEntries.mockResolvedValue([]);
});

/**
 * Every fixture instant in this suite is a fixed, injected clock (#3215's
 * no-time-bomb guard): the rail reads time only through `options.now` /
 * `options.deadlineAt` and these constants. The deadline tests at the
 * bottom deliberately use the real clock and construct their deadline
 * relative to `Date.now()`.
 */
const PINNED_NOW = "2026-09-05T01:00:00.000Z"; // fixed-date: the rail's injected `now` — deterministic by construction
const PINNED_NEXT_DAY = "2026-09-06T01:00:00.000Z"; // fixed-date: PINNED_NOW +1d — the second capture day
const PINNED_LATER = "2026-09-13T01:00:00.000Z"; // fixed-date: PINNED_NOW +8d — the stalest-first head instant
const CAPTURED_AT = "2026-09-05T01:30:00.000Z"; // fixed-date: row payload, passed through; the #2873 freshness check is read-side

function tier(overrides: Partial<SitemapTimelineTier>): SitemapTimelineTier {
  return {
    ...emptySitemapTimelineTier(),
    ...overrides,
  };
}

function cohort(
  ...entries: Array<{ domain: string; overrides?: Partial<SitemapTimelineTier> }>
): SitemapTimelineCohortEntry[] {
  return entries.map((entry) => ({
    domain: entry.domain,
    tier: tier({
      verifiedCount: 1,
      likelyCount: 0,
      hasCoverage: true,
      cacheStatus: "fresh",
      ...(entry.overrides ?? {}),
    }),
  }));
}

/** A real-shaped `LandingPageSnapshotData` for a capture URL. */
function snapshotForUrl(url: string) {
  const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
  return {
    rawUrl: url,
    canonicalUrl: url,
    rawHeadline: `headline for ${domain}`,
    normalizedHeadline: `headline for ${domain}`,
    normalizedHeadlineHash: `hash-${domain}`,
    ctaText: "Book a demo",
    priceText: null,
    formPresent: false,
    captureMethod: "browser_render",
    capturedAt: CAPTURED_AT,
    artifactKey: `artifacts/${domain}.html`,
    metadata: { captureMethod: "browser_render" },
  };
}

describe("parseSitemapTimelineBackfillRowId (issue #3357 ledger ids)", () => {
  it("recovers the canonical domain (dots and dashes included) and the day", () => {
    expect(parseSitemapTimelineBackfillRowId("timeline-boat-lifestyle.com-2026-09-13")).toEqual({
      domain: "boat-lifestyle.com",
      day: "2026-09-13",
    });
    expect(parseSitemapTimelineBackfillRowId("timeline-nike.com-2026-09-13")).toEqual({
      domain: "nike.com",
      day: "2026-09-13",
    });
  });

  it("returns null for other rails' rows so the ledger read ignores them by construction", () => {
    expect(parseSitemapTimelineBackfillRowId("demo-calendly.com-2026-09-13")).toBeNull();
    expect(parseSitemapTimelineBackfillRowId("sneaker-nike.com-2026-09-13")).toBeNull();
    expect(parseSitemapTimelineBackfillRowId("backfill-nike.com-2026-09-13")).toBeNull();
  });

  it("returns null for anything that is not a well-formed rail id, never guessing", () => {
    expect(parseSitemapTimelineBackfillRowId("timeline-nike.com")).toBeNull();
    expect(parseSitemapTimelineBackfillRowId("timeline--2026-09-13")).toBeNull();
    expect(parseSitemapTimelineBackfillRowId("")).toBeNull();
    expect(parseSitemapTimelineBackfillRowId(42)).toBeNull();
    expect(parseSitemapTimelineBackfillRowId(null)).toBeNull();
  });
});

describe("orderSitemapTimelineCohortByCaptureStaleness (issue #3357 starvation fix)", () => {
  it("captures never-captured domains first, then oldest last-captured day, freshest last", () => {
    const entries = cohort(
      { domain: "b.com" },
      { domain: "c.com" },
      { domain: "a.com" },
    );
    const days = new Map([
      ["b.com", "2026-09-10"],
      ["a.com", "2026-09-08"],
    ]);

    expect(
      orderSitemapTimelineCohortByCaptureStaleness(entries, days).map(
        (entry) => entry.domain,
      ),
    ).toEqual(["c.com", "a.com", "b.com"]);
  });

  it("keeps the cohort's sitemap first-seen order within a staleness bucket (stable sort)", () => {
    const entries = cohort(
      { domain: "x.com" },
      { domain: "y.com" },
      { domain: "z.com" },
    );
    const days = new Map([
      ["x.com", "2026-09-10"],
      ["z.com", "2026-09-10"],
    ]);

    // y.com was never captured (stalest, first); x.com precedes z.com in
    // the cohort and both share a day bucket, so that relative order holds.
    expect(
      orderSitemapTimelineCohortByCaptureStaleness(entries, days).map(
        (entry) => entry.domain,
      ),
    ).toEqual(["y.com", "x.com", "z.com"]);
  });

  it("returns the cohort unchanged for an empty ledger — the degrade-to-cohort-order contract", () => {
    const entries = cohort({ domain: "b.com" }, { domain: "a.com" });

    expect(
      orderSitemapTimelineCohortByCaptureStaleness(entries, new Map()).map(
        (entry) => entry.domain,
      ),
    ).toEqual(["b.com", "a.com"]);
  });
});

describe("loadRecentSitemapTimelineCaptureDays (issue #3357 ledger cursor)", () => {
  it("keeps the rail's own rows, latest day per domain, and skips other rails' ids", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryAll.mockResolvedValue([
      { id: "timeline-b.com-2026-09-10" },
      { id: "timeline-b.com-2026-09-12" },
      { id: "timeline-a.com-2026-09-08" },
      { id: "timeline-boat-lifestyle.com-2026-09-13" },
      { id: "demo-b.com-2026-09-12" },
      { id: "timeline--2026-09-13" },
      { id: "garbage" },
    ]);

    const days = await loadRecentSitemapTimelineCaptureDays(env, PINNED_NEXT_DAY);

    expect(days.get("b.com")).toBe("2026-09-12");
    expect(days.get("a.com")).toBe("2026-09-08");
    expect(days.get("boat-lifestyle.com")).toBe("2026-09-13");
    expect(days.size).toBe(3);
    expect(queryAll).toHaveBeenCalledTimes(1);
    expect(queryAll).toHaveBeenCalledWith(
      env,
      expect.stringContaining("LIKE 'timeline-%'"),
      PINNED_NEXT_DAY,
    );
  });

  it("degrades to an empty map when the D1 read fails — a ledger hiccup never throws", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryAll.mockRejectedValue(new Error("ledger hiccup"));

    await expect(
      loadRecentSitemapTimelineCaptureDays(env, PINNED_NEXT_DAY),
    ).resolves.toEqual(new Map());
  });

  it("returns an empty map without touching D1 when there is no DB", async () => {
    await expect(
      loadRecentSitemapTimelineCaptureDays({} as unknown as AppEnv, PINNED_NEXT_DAY),
    ).resolves.toEqual(new Map());
    expect(queryAll).not.toHaveBeenCalled();
  });
});

describe("runSitemapTimelineBackfill (issue #3357 deadline + stalest-first resume)", () => {
  it("reports truncated: true and starts no capture when the deadline already passed", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    const captureStub = vi.fn(async (_env: AppEnv, url: string) =>
      snapshotForUrl(url),
    );

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date(PINNED_NOW),
      cohort: cohort({ domain: "calendly.com" }, { domain: "adspyder.io" }),
      deadlineAt: Date.now() - 5_000,
      capture: captureStub as never,
    });

    expect(result.truncated).toBe(true);
    expect(result.domains).toEqual([]);
    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(captureStub).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("stops STARTING new captures at the deadline: head captured, cut tail reported, never swallowed", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });

    const deadlineAt = Date.now() + 250;
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      // The FIRST capture alone burns past the deadline (the 04:00 rail's
      // shared-wall shape: one slow screenshot eats the remaining budget).
      await new Promise((resolve) => setTimeout(resolve, 500));
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date(PINNED_NOW),
      cohort: cohort(
        { domain: "calendly.com" },
        { domain: "adspyder.io" },
        { domain: "notion.com" },
      ),
      deadlineAt,
      capture: captureStub as never,
    });

    expect(result.truncated).toBe(true);
    expect(result.capturedCount).toBe(1);
    expect(result.domains.map((entry) => entry.domain)).toEqual(["calendly.com"]);
    expect(result.domains[0]?.status).toBe("captured");
    expect(captureStub).toHaveBeenCalledTimes(1);
  });

  it("captures the STALEST domains first through the full loop: the ledger rows are the resume cursor", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    // The cohort arrives in sitemap first-seen order (capture-backed b.com
    // would historically be served FIRST every night); the ledger says
    // a.com (2026-09-08) and b.com (2026-09-10) are recent, c.com is not —
    // so the starved c.com must lead, exactly the #3357 starvation fix.
    queryAll.mockResolvedValue([
      { id: "timeline-b.com-2026-09-10" },
      { id: "timeline-a.com-2026-09-08" },
    ]);

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      capturedDomains.push(url.replace(/^https:\/\/www\./, "").replace(/\/$/, ""));
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date(PINNED_LATER),
      cohort: cohort(
        { domain: "b.com" },
        { domain: "c.com" },
        { domain: "a.com" },
      ),
      capture: captureStub as never,
    });

    expect(capturedDomains).toEqual(["c.com", "a.com", "b.com"]);
    expect(result.domains.map((entry) => entry.domain)).toEqual(["c.com", "a.com", "b.com"]);
    expect(result.truncated).toBe(false);
    expect(result.capturedCount).toBe(3);
  });

  it("degrades to cohort order, never throwing, when the ledger read fails mid-run setup", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    queryAll.mockRejectedValue(new Error("ledger hiccup"));

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      capturedDomains.push(url.replace(/^https:\/\/www\./, "").replace(/\/$/, ""));
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date(PINNED_LATER),
      cohort: cohort(
        { domain: "b.com" },
        { domain: "c.com" },
        { domain: "a.com" },
      ),
      capture: captureStub as never,
    });

    expect(capturedDomains).toEqual(["b.com", "c.com", "a.com"]);
    expect(result.truncated).toBe(false);
    expect(result.capturedCount).toBe(3);
    expect(result.failedCount).toBe(0);
  });
});
