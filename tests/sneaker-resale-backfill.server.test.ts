import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  runSneakerResaleBackfill,
  sneakerResaleBackfillRowId,
  summarizeSneakerResaleBackfill,
  type SneakerResaleBackfillDomainResult,
  type SneakerResaleTierLookup,
} from "~/lib/sneaker-resale-backfill.server";
import type {
  SneakerResaleCohortEntry,
  SneakerResaleTier,
} from "~/lib/sneaker-resale-cohort";

/**
 * Phase-2 unit suite for the sneaker-resale cohort nightly backfill
 * (issue #1946). Pure helpers (`sneakerResaleBackfillRowId`,
 * `summarizeSneakerResaleBackfill`) plus the no-D1 / no-cohort /
 * per-brand-failure branches of `runSneakerResaleBackfill` are exercised on
 * the `node` project. The real D1 path (idempotency, ledger accumulation,
 * cohort inclusion predicate against a fresh local D1) lives in
 * `tests/integration/sneaker-resale-backfill.integration.test.ts`.
 */

const queryOne = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
const replaceAnalysisFields = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryOne,
  execute,
  queryAll: vi.fn(),
  queryIn: vi.fn(),
  ensureDb: vi.fn(),
}));

vi.mock("~/lib/data/ads.server", () => ({
  replaceAnalysisFields,
  // Issue #2442: the backfill write paths now dedupe on the schema's
  // `content_key` generated column, so the backfill calls this helper to build
  // the read-back probe. Mirror the real implementation.
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
}));

vi.mock("~/lib/landing-pages.server", () => ({
  captureLandingPageSnapshot: vi.fn(),
}));

const loadOfferTimeline = vi.hoisted(() => vi.fn());

vi.mock("~/lib/offer-timeline.server", () => ({
  loadOfferTimeline,
}));

afterEach(() => {
  queryOne.mockReset();
  execute.mockReset();
  replaceAnalysisFields.mockReset();
  loadOfferTimeline.mockReset();
});
beforeEach(() => {
  loadOfferTimeline.mockResolvedValue({ entries: [], asOfState: null });
  replaceAnalysisFields.mockResolvedValue(undefined);
});

function tier(overrides: Partial<SneakerResaleTier>): SneakerResaleTier {
  return {
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: 0,
    hasCoverage: false,
    cacheStatus: "stale",
    ...overrides,
  };
}

function cohort(
  ...entries: Array<{ domain: string; brand?: string; overrides?: Partial<SneakerResaleTier> }>
): SneakerResaleCohortEntry[] {
  return entries.map((entry) => ({
    domain: entry.domain,
    brand: entry.brand,
    tier: tier({ verifiedCount: 1, likelyCount: 0, hasCoverage: true, cacheStatus: "fresh", ...(entry.overrides ?? {}) }),
  }));
}

function emptyTierLookup(): SneakerResaleTierLookup {
  return async () => new Map();
}

function tierLookupFor(cohortEntries: SneakerResaleCohortEntry[]): SneakerResaleTierLookup {
  return async () => {
    const map = new Map<string, SneakerResaleTier>();
    for (const entry of cohortEntries) {
      map.set(entry.domain, entry.tier);
    }
    return map;
  };
}

describe("sneakerResaleBackfillRowId", () => {
  it("builds the deterministic row id per (domain, UTC day)", () => {
    expect(sneakerResaleBackfillRowId("stockx.com", "2026-09-05")).toBe(
      "sneaker-stockx.com-2026-09-05",
    );
    expect(sneakerResaleBackfillRowId("nike.com", "2026-10-01")).toBe(
      "sneaker-nike.com-2026-10-01",
    );
  });
});

describe("summarizeSneakerResaleBackfill", () => {
  it("matches summarizeDemoBrandBackfill's shape: day, captured, failed, brand-by-brand tags", () => {
    const summary = summarizeSneakerResaleBackfill({
      day: "2026-09-05",
      startedAt: "2026-09-05T01:00:00.000Z",
      capturedCount: 2,
      failedCount: 1,
      domains: [
        {
          domain: "stockx.com",
          status: "captured",
          snapshotId: "sneaker-stockx.com-2026-09-05",
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: null,
        },
        {
          domain: "nike.com",
          status: "skipped_already_captured",
          snapshotId: "sneaker-nike.com-2026-09-05",
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: null,
        },
        {
          domain: "goat.com",
          status: "capture_failed",
          snapshotId: null,
          reasonCode: "screenshot_required",
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: null,
        },
      ],
    });

    expect(summary).toContain("sneaker-resale-backfill day=2026-09-05");
    expect(summary).toContain("captured=2 failed=1");
    expect(summary).toContain("stockx.com:captured");
    expect(summary).toContain("nike.com:already");
    expect(summary).toContain("goat.com:failed:screenshot_required");
  });

  it("renders an :error:<name> tag for unexpected per-brand exceptions", () => {
    const summary = summarizeSneakerResaleBackfill({
      day: "2026-09-06",
      startedAt: "2026-09-06T01:00:00.000Z",
      capturedCount: 0,
      failedCount: 1,
      domains: [
        {
          domain: "stockx.com",
          status: "error",
          snapshotId: null,
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: "BoomError",
          tier: null,
        },
      ],
    });

    expect(summary).toContain("stockx.com:error:BoomError");
  });

  it("returns the bare log line with empty brackets when no brands are processed", () => {
    const summary = summarizeSneakerResaleBackfill({
      day: "2026-09-07",
      startedAt: "2026-09-07T01:00:00.000Z",
      capturedCount: 0,
      failedCount: 0,
      domains: [],
    });

    expect(summary).toBe("sneaker-resale-backfill day=2026-09-07 cohort=0 captured=0 failed=0 []");
  });
});

describe("runSneakerResaleBackfill (no-D1 path)", () => {
  it("returns an empty degraded result without throwing when env.DB is missing", async () => {
    const result = await runSneakerResaleBackfill(
      {} as unknown as AppEnv,
      {
        now: new Date("2026-09-05T01:00:00.000Z"),
        cohort: cohort({ domain: "stockx.com" }),
        capture: vi.fn(),
      },
    );

    expect(result.day).toBe("2026-09-05");
    expect(result.startedAt).toBe("2026-09-05T01:00:00.000Z");
    expect(result.domains).toEqual([]);
    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });
});

describe("runSneakerResaleBackfill (no-cohort path)", () => {
  it("returns an empty degraded result when the cohort is empty", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    const result = await runSneakerResaleBackfill(env, {
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

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: [],
      tierLookup,
      capture: vi.fn(),
    });

    expect(result.domains).toEqual([]);
    expect(tierLookup).not.toHaveBeenCalled();
  });
});

describe("runSneakerResaleBackfill (per-brand failure isolation)", () => {
  it("records a capture_failed brand without losing the other brands", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    // Fresh DB (no existing row), then the content_key read-back returns the
    // row the INSERT wrote under its deterministic id.
    mockSnapshotWrites();
    execute.mockResolvedValue({});
    replaceAnalysisFields.mockResolvedValue(undefined);

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      if (domain === "nike.com") {
        return null;
      }
      capturedDomains.push(domain);
      return {
        rawUrl: url,
        canonicalUrl: url,
        rawHeadline: `headline for ${domain}`,
        normalizedHeadline: `headline for ${domain}`,
        normalizedHeadlineHash: `hash-${domain}`,
        ctaText: "Shop now",
        priceText: null,
        formPresent: false,
        captureMethod: "browser_render",
        capturedAt: "2026-09-05T01:30:00.000Z",
        artifactKey: `artifacts/${domain}.html`,
        metadata: { captureMethod: "browser_render" },
      };
    });

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort(
        { domain: "stockx.com" },
        { domain: "nike.com" },
        { domain: "goat.com" },
      ),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.domains.find((r) => r.domain === "nike.com")?.status).toBe("capture_failed");
    expect(result.domains.find((r) => r.domain === "nike.com")?.reasonCode).toBeNull();
    expect(result.domains.find((r) => r.domain === "stockx.com")?.status).toBe("captured");
    expect(capturedDomains.sort()).toEqual(["goat.com", "stockx.com"]);
  });

  it("records an unexpected per-brand error without aborting the other brands", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    // Fresh DB (no existing row), then the content_key read-back returns the
    // row the INSERT wrote under its deterministic id.
    mockSnapshotWrites();

    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      if (domain === "stockx.com") {
        throw new Error("upstream provider unreachable");
      }
      return {
        rawUrl: url,
        canonicalUrl: url,
        rawHeadline: `headline for ${domain}`,
        normalizedHeadline: `headline for ${domain}`,
        normalizedHeadlineHash: `hash-${domain}`,
        ctaText: null,
        priceText: null,
        formPresent: null,
        captureMethod: "browser_render",
        capturedAt: "2026-09-05T01:30:00.000Z",
        artifactKey: null,
        metadata: null,
      };
    });

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "stockx.com" }, { domain: "goat.com" }),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.domains.find((r) => r.domain === "stockx.com")?.status).toBe("error");
    expect(result.domains.find((r) => r.domain === "goat.com")?.status).toBe("captured");
  });

  it("surfaces the capture pipeline's reasonCode for capture_failed brands", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    // Fresh DB (no existing row), then the content_key read-back returns the
    // row the INSERT wrote under its deterministic id.
    mockSnapshotWrites();

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

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "stockx.com" }),
      capture: captureStub as never,
    });

    expect(result.domains[0]?.status).toBe("capture_failed");
    expect(result.domains[0]?.reasonCode).toBe("screenshot_required");
  });
});

/**
 * Issue #2442: the write path now issues TWO `queryOne` calls per brand — the
 * pre-insert "already captured by deterministic id?" guard, then the
 * "which row survived the content_key conflict?" read-back. Mocking them by
 * call order keeps each test's intent (no existing row -> capture -> persist).
 * `onReadBack` receives the content key so a test can return the deterministic
 * row id, exactly as the real INSERT does on the non-conflicting path.
 */
function mockSnapshotWrites() {
  // On the non-conflicting path the read-back returns the row the INSERT wrote
  // under its deterministic id; derive it from the canonical_url binding the
  // same way the writer does.
  const onReadBack = (contentKey: string): { id: string } | null => {
    const canonicalUrl = contentKey.split("|")[0] ?? "";
    const domain = canonicalUrl
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/.*$/, "");
    return { id: `sneaker-${domain}-2026-09-05` };
  };

  let call = 0;
  queryOne.mockImplementation(async (_env: unknown, sql: string, ...bindings: unknown[]) => {
    call += 1;
    if (sql.includes("WHERE id = ? OR content_key = ?")) {
      return onReadBack(String(bindings[1] ?? ""));
    }
    if (sql.includes("content_key = ?")) {
      return onReadBack(String(bindings[0] ?? ""));
    }
    // The pre-insert existence guard: fresh DB, nothing captured yet.
    void call;
    return null;
  });
}

describe("runSneakerResaleBackfill (idempotency + subset paths)", () => {
  it("marks an existing row as skipped_already_captured without re-capturing", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    queryOne.mockResolvedValue({ id: "sneaker-stockx.com-2026-09-05" });

    const captureStub = vi.fn();

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "stockx.com" }),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.domains[0]?.status).toBe("skipped_already_captured");
    expect(result.domains[0]?.snapshotId).toBe("sneaker-stockx.com-2026-09-05");
    expect(captureStub).not.toHaveBeenCalled();
  });

  it("restricts the run to a caller-supplied domains subset", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    // Fresh DB (no existing row), then the content_key read-back returns the
    // row the INSERT wrote under its deterministic id.
    mockSnapshotWrites();
    execute.mockResolvedValue({});
    replaceAnalysisFields.mockResolvedValue(undefined);

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return {
        rawUrl: url,
        canonicalUrl: url,
        rawHeadline: `headline for ${domain}`,
        normalizedHeadline: `headline for ${domain}`,
        normalizedHeadlineHash: `hash-${domain}`,
        ctaText: null,
        priceText: null,
        formPresent: null,
        captureMethod: "browser_render",
        capturedAt: "2026-09-05T01:30:00.000Z",
        artifactKey: null,
        metadata: null,
      };
    });

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort(
        { domain: "stockx.com" },
        { domain: "nike.com" },
        { domain: "goat.com" },
      ),
      domains: ["stockx.com"],
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(1);
    expect(capturedDomains).toEqual(["stockx.com"]);
  });

  it("canonicalizes the caller-supplied domains subset (WWW.StockX.com === stockx.com)", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    // Fresh DB (no existing row), then the content_key read-back returns the
    // row the INSERT wrote under its deterministic id.
    mockSnapshotWrites();
    execute.mockResolvedValue({});
    replaceAnalysisFields.mockResolvedValue(undefined);

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return {
        rawUrl: url,
        canonicalUrl: url,
        rawHeadline: `headline for ${domain}`,
        normalizedHeadline: `headline for ${domain}`,
        normalizedHeadlineHash: `hash-${domain}`,
        ctaText: null,
        priceText: null,
        formPresent: null,
        captureMethod: "browser_render",
        capturedAt: "2026-09-05T01:30:00.000Z",
        artifactKey: null,
        metadata: null,
      };
    });

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort(
        { domain: "stockx.com" },
        { domain: "nike.com" },
      ),
      // WWW. prefix and trailing dot are stripped before the cohort lookup
      // so a caller with sloppy domain input still gets the right cohort
      // entry — parity with `canonicalizeSneakerResaleDomain`.
      domains: ["WWW.StockX.com."],
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(1);
    expect(capturedDomains).toEqual(["stockx.com"]);
    // The other cohort entry (nike.com) was filtered out by the subset.
    expect(capturedDomains).not.toContain("nike.com");
  });
});

describe("runSneakerResaleBackfill (write path shape)", () => {
  it("INSERTs the snapshot row with the deterministic id and calls replaceAnalysisFields", async () => {
    const env = { DB: {} } as unknown as AppEnv;
    // Fresh DB (no existing row), then the content_key read-back returns the
    // row the INSERT wrote under its deterministic id.
    mockSnapshotWrites();
    execute.mockResolvedValue({});
    replaceAnalysisFields.mockResolvedValue(undefined);

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      cohort: cohort({ domain: "stockx.com" }),
      capture: (async (_env: AppEnv, url: string) => ({
        rawUrl: url,
        canonicalUrl: url,
        rawHeadline: "headline",
        normalizedHeadline: "headline",
        normalizedHeadlineHash: "hash",
        ctaText: "Shop now",
        priceText: "$100",
        formPresent: true,
        captureMethod: "browser_render",
        capturedAt: "2026-09-05T01:30:00.000Z",
        artifactKey: "artifacts/stockx.com.html",
        metadata: { captureMethod: "browser_render" },
      })) as never,
    });

    expect(result.domains[0]?.snapshotId).toBe("sneaker-stockx.com-2026-09-05");
    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0];
    // execute(env, sql, rowId, ...) — the SQL is the first arg after the env.
    // Issue #2442: the conflict target is named explicitly, because a bare
    // `INSERT OR IGNORE` would also swallow the content_key unique-index
    // violation and silently drop an identical capture.
    expect(call?.[1]).toMatch(/INSERT INTO landing_page_snapshot/);
    expect(call?.[1]).toMatch(/ON CONFLICT\(content_key\) DO NOTHING/);
    expect(call?.[1]).not.toMatch(/INSERT OR IGNORE/);
    expect(call?.[2]).toBe("sneaker-stockx.com-2026-09-05");
    expect(replaceAnalysisFields).toHaveBeenCalledWith(
      env,
      "landing_page",
      "sneaker-stockx.com-2026-09-05",
      expect.any(Array),
    );
  });
});

describe("default tierLookup path (seed list → tier map → cohort)", () => {
  it("derives a non-empty cohort when the tier map marks brands as covered", async () => {
    // The default tierLookup is `getSneakerResaleTierByDomain`, which is the
    // real D1 adapter. The mock below makes the adapter return a fixture
    // map without touching D1. This pins the default-path contract: when no
    // `cohort` override is supplied, the backfill reads the seed list and
    // asks the adapter for the tier map.
    const env = { DB: {} } as unknown as AppEnv;
    // Fresh DB (no existing row), then the content_key read-back returns the
    // row the INSERT wrote under its deterministic id.
    mockSnapshotWrites();
    execute.mockResolvedValue({});
    replaceAnalysisFields.mockResolvedValue(undefined);

    const capturedDomains: string[] = [];
    const captureStub = vi.fn(async (_env: AppEnv, url: string) => {
      const domain = url.replace(/^https:\/\/www\./, "").replace(/\/$/, "");
      capturedDomains.push(domain);
      return {
        rawUrl: url,
        canonicalUrl: url,
        rawHeadline: `headline for ${domain}`,
        normalizedHeadline: `headline for ${domain}`,
        normalizedHeadlineHash: `hash-${domain}`,
        ctaText: null,
        priceText: null,
        formPresent: null,
        captureMethod: "browser_render",
        capturedAt: "2026-09-05T01:30:00.000Z",
        artifactKey: null,
        metadata: null,
      };
    });

    const tierLookup = tierLookupFor(
      cohort({ domain: "stockx.com" }, { domain: "goat.com" }),
    );

    const result = await runSneakerResaleBackfill(env, {
      now: new Date("2026-09-05T01:00:00.000Z"),
      tierLookup,
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(2);
    expect(capturedDomains.sort()).toEqual(["goat.com", "stockx.com"]);
    expect(
      result.domains.every((entry: SneakerResaleBackfillDomainResult) => entry.tier?.hasCoverage === true),
    ).toBe(true);
  });
});
