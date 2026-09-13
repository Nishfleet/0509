import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  loadRecentSitemapTimelineCaptureDays,
  orderSitemapTimelineCohortByCaptureStaleness,
  parseSitemapTimelineBackfillRowId,
  runSitemapTimelineBackfill,
  sitemapTimelineBackfillRowId,
  SITEMAP_TIMELINE_COHORT_CAP,
  summarizeSitemapTimelineBackfill,
  type SitemapTimelineBackfillDomainResult,
  type SitemapTimelineTierLookup,
} from "~/lib/sitemap-timeline-backfill.server";
import {
  emptySitemapTimelineTier,
  type SitemapTimelineCohortEntry,
  type SitemapTimelineTier,
} from "~/lib/sitemap-timeline-cohort";

/**
 * Phase-2 unit suite (issue #1958): pure helpers plus the no-D1 / no-cohort /
 * per-domain-failure / CAP branches of `runSitemapTimelineBackfill` on the
 * `node` project. The real D1 path lives in the integration suite (phase 4).
 * The node project shares a module registry with the sneaker-resale suite, so
 * every mock is a hoisted re-declare and `afterEach` restores + resets.
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

function emptyTierLookup(): SitemapTimelineTierLookup {
  return async () => new Map();
}

/** Compact domain-result fixture for summarize/log-line assertions. */
function dom(
  domain: string,
  status: SitemapTimelineBackfillDomainResult["status"],
  extra: Partial<SitemapTimelineBackfillDomainResult> = {},
): SitemapTimelineBackfillDomainResult {
  return {
    domain,
    status,
    snapshotId: null,
    reasonCode: null,
    canonicalUrl: null,
    capturedAt: null,
    error: null,
    tier: null,
    ...extra,
  };
}

function tierLookupFor(
  cohortEntries: SitemapTimelineCohortEntry[],
): SitemapTimelineTierLookup {
  return async () => {
    const map = new Map<string, SitemapTimelineTier>();
    for (const entry of cohortEntries) {
      map.set(entry.domain, entry.tier);
    }
    return map;
  };
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
    capturedAt: "2026-09-05T01:30:00.000Z",
    artifactKey: `artifacts/${domain}.html`,
    metadata: { captureMethod: "browser_render" },
  };
}

describe("sitemapTimelineBackfillRowId", () => {
  it("builds the deterministic `timeline-<domain>-<day>` row id per (domain, UTC day)", () => {
    expect(sitemapTimelineBackfillRowId("calendly.com", "2026-09-05")).toBe(
      "timeline-calendly.com-2026-09-05",
    );
    expect(sitemapTimelineBackfillRowId("adspyder.io", "2026-10-01")).toBe(
      "timeline-adspyder.io-2026-10-01",
    );
  });
});

describe("summarizeSitemapTimelineBackfill", () => {
  it("matches the sneaker summarize shape: day, cohort, captured, failed, per-domain tags", () => {
    const summary = summarizeSitemapTimelineBackfill({
      day: "2026-09-05",
      startedAt: "2026-09-05T01:00:00.000Z",
      capturedCount: 2,
      failedCount: 1,
      domains: [
        dom("calendly.com", "captured", {
          snapshotId: "timeline-calendly.com-2026-09-05",
        }),
        dom("adspyder.io", "skipped_already_captured", {
          snapshotId: "timeline-adspyder.io-2026-09-05",
        }),
        dom("notion.com", "capture_failed", { reasonCode: "screenshot_required" }),
      ],
    });

    expect(summary).toContain("sitemap-timeline-backfill day=2026-09-05");
    expect(summary).toContain("captured=2 failed=1");
    expect(summary).toContain("calendly.com:captured");
    expect(summary).toContain("adspyder.io:already");
    expect(summary).toContain("notion.com:failed:screenshot_required");
  });

  it("renders an :error:<name> tag for unexpected per-domain exceptions", () => {
    const summary = summarizeSitemapTimelineBackfill({
      day: "2026-09-06",
      startedAt: "2026-09-06T01:00:00.000Z",
      capturedCount: 0,
      failedCount: 1,
      domains: [dom("calendly.com", "error", { error: "BoomError" })],
    });

    expect(summary).toContain("calendly.com:error:BoomError");
  });

  it("surfaces evidence age as stale=N (phase-1 reviewer carry-forward)", () => {
    const summary = summarizeSitemapTimelineBackfill({
      day: "2026-09-05",
      startedAt: "2026-09-05T01:00:00.000Z",
      capturedCount: 1,
      failedCount: 0,
      domains: [
        dom("calendly.com", "captured", {
          snapshotId: "timeline-calendly.com-2026-09-05",
          tier: tier({ verifiedCount: 1, hasCoverage: true, cacheStatus: "stale" }),
        }),
        dom("adspyder.io", "captured", {
          snapshotId: "timeline-adspyder.io-2026-09-05",
          tier: tier({ verifiedCount: 1, hasCoverage: true, cacheStatus: "fresh" }),
        }),
      ],
    });

    expect(summary).toContain("stale=1");
  });

  it("returns the bare log line with empty brackets when no domains are processed", () => {
    const summary = summarizeSitemapTimelineBackfill({
      day: "2026-09-07",
      startedAt: "2026-09-07T01:00:00.000Z",
      capturedCount: 0,
      failedCount: 0,
      domains: [],
    });

    expect(summary).toBe(
      "sitemap-timeline-backfill day=2026-09-07 cohort=0 captured=0 failed=0 stale=0 []",
    );
  });
});

describe("runSitemapTimelineBackfill (no-D1 path)", () => {
  it("returns an empty degraded result without throwing when env.DB is missing", async () => {
    const result = await runSitemapTimelineBackfill(
      {} as unknown as AppEnv,
      {
        now: new Date("2026-09-05T01:00:00.000Z"),
        cohort: cohort({ domain: "calendly.com" }),
        capture: vi.fn(),
      },
    );

    expect(result.day).toBe("2026-09-05");
    expect(result.startedAt).toBe("2026-09-05T01:00:00.000Z");
    expect(result.domains).toEqual([]);
    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(queryOne).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("runSitemapTimelineBackfill (no-cohort path)", () => {
  it("returns an empty degraded result when the cohort is empty", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: [],
      capture: vi.fn(),
    });

    expect(result.domains).toEqual([]);
    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(queryOne).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("skips the D1 tier lookup when an explicit cohort is supplied", async () => {
    const tierLookup = vi.fn(emptyTierLookup());
    const env = { DB: {} } as unknown as AppEnv;

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: [],
      tierLookup,
      capture: vi.fn(),
    });

    expect(result.domains).toEqual([]);
    expect(tierLookup).not.toHaveBeenCalled();
  });

  it("returns an empty degraded result when the sitemap candidacy read comes back empty", async () => {
    const tierLookup = vi.fn(emptyTierLookup());
    const env = { DB: {} } as unknown as AppEnv;

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      tierLookup,
      capture: vi.fn(),
    });

    expect(result.domains).toEqual([]);
    expect(loadIndexableTimelineEntries).toHaveBeenCalledTimes(1);
    expect(tierLookup).not.toHaveBeenCalled();
    expect(queryOne).not.toHaveBeenCalled();
  });
});

describe("runSitemapTimelineBackfill (missing snapshot table)", () => {
  it("treats a `no such table: landing_page_snapshot` error as an empty degraded result (no throw)", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockRejectedValue(
      new Error("no such table: landing_page_snapshot"),
    );

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }),
      capture: vi.fn(),
    });

    expect(result.domains).toEqual([]);
    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("runSitemapTimelineBackfill (per-domain failure isolation)", () => {
  it("records a capture_failed domain without losing the other domains", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      if (domain === "adspyder.io") {
        return null;
      }
      capturedDomains.push(domain);
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort(
        { domain: "calendly.com" },
        { domain: "adspyder.io" },
        { domain: "notion.com" },
      ),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(
      result.domains.find((r) => r.domain === "adspyder.io")?.status,
    ).toBe("capture_failed");
    expect(
      result.domains.find((r) => r.domain === "adspyder.io")?.reasonCode,
    ).toBeNull();
    expect(
      result.domains.find((r) => r.domain === "calendly.com")?.status,
    ).toBe("captured");
    expect(capturedDomains.sort()).toEqual(["calendly.com", "notion.com"]);
  });

  it("records an unexpected per-domain error without aborting the other domains", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      if (domain === "calendly.com") {
        throw new Error("upstream provider unreachable");
      }
      capturedDomains.push(domain);
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }, { domain: "notion.com" }),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(
      result.domains.find((r) => r.domain === "calendly.com")?.status,
    ).toBe("error");
    expect(
      result.domains.find((r) => r.domain === "calendly.com")?.error,
    ).toBe("Error");
    expect(
      result.domains.find((r) => r.domain === "notion.com")?.status,
    ).toBe("captured");
    expect(capturedDomains).toEqual(["notion.com"]);
  });

  it("surfaces the capture pipeline's reasonCode for capture_failed domains", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);

    const captureStub = vi.fn(
      async (
        _env: AppEnv,
        _url: string,
        options: {
          onFailure: (detail: { reasonCode: string; metadata: Record<string, unknown> }) => void;
        },
      ) => {
        options.onFailure({ reasonCode: "screenshot_required", metadata: {} });
        return null;
      },
    );

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }),
      capture: captureStub as never,
    });

    expect(result.domains[0]?.status).toBe("capture_failed");
    expect(result.domains[0]?.reasonCode).toBe("screenshot_required");
  });
});

describe("runSitemapTimelineBackfill (idempotency + subset paths)", () => {
  it("marks an existing row as skipped_already_captured without re-capturing", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue({ id: "timeline-calendly.com-2026-09-05" });

    const captureStub = vi.fn();

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.domains[0]?.status).toBe("skipped_already_captured");
    expect(result.domains[0]?.snapshotId).toBe(
      "timeline-calendly.com-2026-09-05",
    );
    expect(captureStub).not.toHaveBeenCalled();
  });

  it("restricts the run to a caller-supplied, canonicalized domains subset", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }, { domain: "adspyder.io" }),
      domains: ["WWW.Calendly.com."],
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(1);
    expect(capturedDomains).toEqual(["calendly.com"]);
  });
});

describe("runSitemapTimelineBackfill (write path shape)", () => {
  it("INSERTs the snapshot row with the deterministic id and calls replaceAnalysisFields", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }),
      capture: (async (_env: AppEnv, url: string) =>
        snapshotForUrl(url)) as never,
    });

    expect(result.domains[0]?.snapshotId).toBe(
      "timeline-calendly.com-2026-09-05",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0];
        expect(call?.[1]).toMatch(/INSERT OR IGNORE INTO landing_page_snapshot/);
    expect(call?.[2]).toBe("timeline-calendly.com-2026-09-05");
    expect(replaceAnalysisFields).toHaveBeenCalledWith(
      env,
      "landing_page",
      "timeline-calendly.com-2026-09-05",
      expect.any(Array),
    );

    expect(call?.[3]).toBe("https://www.calendly.com/");
    expect(call?.[8]).toBe("browser_render");
  });

  // Issue #2466: the sitemap-timeline rail must tier its rows like its
  // sibling rails (demo-brand-backfill, sneaker-resale-backfill) do —
  // a parseable price_text becomes `extractPriceTier(...)` in `price_tier`,
  // not NULL.
  it("binds price_tier = extractPriceTier(price_text) on the INSERT", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }),
      capture: (async (_env: AppEnv, url: string) => ({
        ...snapshotForUrl(url),
        priceText: "$199",
      })) as never,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0];
    const sql = String(call?.[1]);
    expect(sql).toMatch(/price_tier/);
    // Same 15-? tuple as the sibling rails: every non-NULL-literal column
    // is bound, including price_tier.
    expect(sql).not.toMatch(/VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, NULL, NULL, \?, \?\)/);
    expect(call?.[14]).toBe("100_to_250");
  });

  it("binds price_tier = 'unknown' when price_text is not parseable", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "calendly.com" }),
      capture: (async (_env: AppEnv, url: string) =>
        snapshotForUrl(url)) as never,
    });

    const call = execute.mock.calls[0];
    expect(call?.[14]).toBe("unknown");
  });
});

describe("runSitemapTimelineBackfill (cohort derivation, default path)", () => {
  it("captures only sitemap candidates with hasCoverage — no-phantom-row on coverage false", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    loadIndexableTimelineEntries.mockResolvedValue([
      { path: "/timeline/calendly.com", lastmod: "2026-09-01" },
      { path: "/timeline/adspyder.io", lastmod: "2026-09-01" },
    ]);
    const tierLookup = tierLookupFor(cohort({ domain: "calendly.com" }));

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      tierLookup,
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(1);
    expect(capturedDomains).toEqual(["calendly.com"]);
    expect(result.domains.map((r) => r.domain)).toEqual(["calendly.com"]);
    expect(
      result.domains.every(
        (entry: SitemapTimelineBackfillDomainResult) =>
          entry.tier?.hasCoverage === true,
      ),
    ).toBe(true);
  });

  it("keeps demo and sneaker-seed domains out via the real exclusion set", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    loadIndexableTimelineEntries.mockResolvedValue([
      { path: "/timeline/calendly.com", lastmod: "2026-09-01" },
      { path: "/timeline/adspyder.io", lastmod: "2026-09-01" },
      { path: "/timeline/nike.com", lastmod: "2026-09-01" },
      { path: "/timeline/stockx.com", lastmod: "2026-09-01" },
    ]);
    const tierLookup = tierLookupFor(
      cohort(
        { domain: "calendly.com" },
        { domain: "adspyder.io" },
        { domain: "nike.com" },
        { domain: "stockx.com" },
      ),
    );

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      tierLookup,
      capture: captureStub as never,
    });

    expect(capturedDomains.sort()).toEqual(["adspyder.io", "calendly.com"]);
    expect(capturedDomains).not.toContain("nike.com");
    expect(capturedDomains).not.toContain("stockx.com");
    expect(result.domains.map((r) => r.domain).sort()).toEqual([
      "adspyder.io",
      "calendly.com",
    ]);
  });

  it("honors an injected exclusion set instead of the real one", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    loadIndexableTimelineEntries.mockResolvedValue([
      { path: "/timeline/calendly.com", lastmod: "2026-09-01" },
      { path: "/timeline/adspyder.io", lastmod: "2026-09-01" },
    ]);
    const tierLookup = tierLookupFor(cohort({ domain: "calendly.com" }));

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      tierLookup,
      excludedDomains: new Set(["calendly.com"]),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(0);
    expect(capturedDomains).toEqual([]);
  });
});

describe("runSitemapTimelineBackfill (CAP bound)", () => {
  it("slices the derived cohort at SITEMAP_TIMELINE_COHORT_CAP so spend is bounded", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue(null);
    execute.mockResolvedValue({ meta: { changes: 1 } });
    replaceAnalysisFields.mockResolvedValue(undefined);

    const oversized = Array.from(
      { length: SITEMAP_TIMELINE_COHORT_CAP + 5 },
      (_, i) => ({
        domain: `domain-${i}.example`,
        tier: tier({
          verifiedCount: 1,
          hasCoverage: true,
          cacheStatus: "fresh",
        }),
      }),
    );

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return snapshotForUrl(url);
    });

    const result = await runSitemapTimelineBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: oversized,
      capture: captureStub as never,
    });

    expect(result.domains).toHaveLength(SITEMAP_TIMELINE_COHORT_CAP);
    expect(result.capturedCount).toBe(SITEMAP_TIMELINE_COHORT_CAP);
    expect(captureStub).toHaveBeenCalledTimes(SITEMAP_TIMELINE_COHORT_CAP);
    expect(capturedDomains[0]).toBe("domain-0.example");
    expect(capturedDomains[SITEMAP_TIMELINE_COHORT_CAP - 1]).toBe(
      `domain-${SITEMAP_TIMELINE_COHORT_CAP - 1}.example`,
    );
    expect(capturedDomains).not.toContain(
      `domain-${SITEMAP_TIMELINE_COHORT_CAP}.example`,
    );
  });
});

// Issue #3357: the nightly rail's own `timeline-<domain>-<day>` ledger rows
// are the resume cursor. The rail must (a) recover (domain, day) from the
// ids it wrote, (b) order the cohort stalest-first so a truncated night's
// tail becomes the next night's head, (c) read that ledger in ONE bounded
// D1 read that degrades to cohort order, never throws, and (d) honor the
// #1549 internal-dedeadline + `truncated: true` budget contract so the
// 15-minute scheduled wall never silently swallows the cut tail.
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

    const days = await loadRecentSitemapTimelineCaptureDays(env, "2026-09-06T01:00:00.000Z");

    expect(days.get("b.com")).toBe("2026-09-12");
    expect(days.get("a.com")).toBe("2026-09-08");
    expect(days.get("boat-lifestyle.com")).toBe("2026-09-13");
    expect(days.size).toBe(3);
    expect(queryAll).toHaveBeenCalledTimes(1);
    expect(queryAll).toHaveBeenCalledWith(
      env,
      expect.stringContaining("LIKE 'timeline-%'"),
      "2026-09-06T01:00:00.000Z",
    );
  });

  it("degrades to an empty map when the D1 read fails — a ledger hiccup never throws", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryAll.mockRejectedValue(new Error("ledger hiccup"));

    await expect(
      loadRecentSitemapTimelineCaptureDays(env, "2026-09-06T01:00:00.000Z"),
    ).resolves.toEqual(new Map());
  });

  it("returns an empty map without touching D1 when there is no DB", async () => {
    await expect(
      loadRecentSitemapTimelineCaptureDays({} as unknown as AppEnv, "2026-09-06T01:00:00.000Z"),
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
      now: new Date("2026-09-05T01:00:00.000Z"),
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
      now: new Date("2026-09-05T01:00:00.000Z"),
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
      now: new Date("2026-09-13T01:00:00.000Z"),
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
      now: new Date("2026-09-13T01:00:00.000Z"),
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