import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
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
const replaceAnalysisFields = vi.hoisted(() => vi.fn());
const loadIndexableTimelineEntries = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryOne,
  execute,
  queryAll: vi.fn(),
  queryIn: vi.fn(),
  ensureDb: vi.fn(),
}));

vi.mock("~/lib/data/ads.server", () => ({
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