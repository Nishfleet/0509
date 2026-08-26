import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { CommercialDiscoveryError } from "~/lib/meta-library-browser.server";
import { writeAppLog } from "~/lib/log.server";

const FUNNEL_OPERATIONS = [
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_migration_view",
  "funnel_signup_start",
  "funnel_signup_start_magicbrief",
  "funnel_first_brief_viewed",
];

function emittedFunnelRecords(logSpy: MockInstance): Record<string, unknown>[] {
  return logSpy.mock.calls
    .map((call) => call[0])
    .filter((line): line is string => typeof line === "string")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(
      (record): record is Record<string, unknown> =>
        Boolean(record && typeof record === "object") &&
        FUNNEL_OPERATIONS.includes(String((record as { operation?: unknown }).operation)),
    );
}

function createContext(env: Record<string, unknown> = {}) {
  return { cloudflare: { env } };
}

function makeFunnelRequest(url = "http://localhost/") {
  return new Request(url);
}

function makeFunnelPost(url: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("funnel measurement gate", () => {
  it("is disabled by default and for any absent or non-explicit value", async () => {
    const { funnelMeasurementEnabled } = await import("~/lib/funnel-measurement.server");
    expect(funnelMeasurementEnabled({})).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "0" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "false" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "no" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "enabled" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "  " })).toBe(false);
  });

  it("enables only for the explicit allowlisted values", async () => {
    const { funnelMeasurementEnabled } = await import("~/lib/funnel-measurement.server");
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "1" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "true" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "yes" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "on" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "TRUE" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: " 1 " })).toBe(true);
  });

  it("is enabled in the committed production wrangler.jsonc vars", async () => {
    // Guards against the var being accidentally removed from the deployed
    // config: without it, production records ZERO funnel events and every
    // traction/activation/conversion decision stays unmeasurable. Same
    // committed-config guard pattern as tests/search-rollout-config.test.ts.
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync("wrangler.jsonc", "utf8");
    const withoutComments = raw
      .split("\n")
      .map((line) => {
        const commentIndex = line.indexOf("//");
        if (commentIndex === -1) return line;
        const before = line.slice(0, commentIndex);
        const quoteCount = (before.match(/"/g) ?? []).length;
        return quoteCount % 2 === 0 ? before : line;
      })
      .join("\n");
    const parsed = JSON.parse(withoutComments) as { vars?: Record<string, unknown> };
    const vars = parsed.vars ?? {};
    expect(vars.FUNNEL_MEASUREMENT_ENABLED).toBe("1");
  });
});

describe("funnel first-brief viewed", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a request-scoped activation event", async () => {
    const { emitFunnelFirstBriefViewed } = await import("~/lib/funnel-measurement.server");
    emitFunnelFirstBriefViewed({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; details: Record<string, string> },
    ];
    expect(record.operation).toBe("funnel_first_brief_viewed");
    expect(record.details.route).toBe("activation");
    expect(record.details.account_scope).toBe("workspace");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    expect(JSON.stringify(record)).not.toMatch(/watchlist|proof|email|workspace_id/i);
  });

  it("stays silent when the gate is off or GPC is set", async () => {
    const { emitFunnelFirstBriefViewed } = await import("~/lib/funnel-measurement.server");
    emitFunnelFirstBriefViewed({}, makeFunnelRequest());
    const gpc = new Request("http://localhost/", { headers: { "sec-gpc": "1" } });
    emitFunnelFirstBriefViewed({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpc);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });
});

describe("funnel measurement GPC opt-out", () => {
  it("treats only the Sec-GPC: 1 signal as an opt-out", async () => {
    const { isGpcOptOut } = await import("~/lib/funnel-measurement.server");
    expect(isGpcOptOut(new Request("http://localhost/"))).toBe(false);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "0" } }))).toBe(false);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "true" } }))).toBe(false);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "1" } }))).toBe(true);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "0,1" } }))).toBe(true);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "1,1" } }))).toBe(true);
  });
});

describe("funnel measurement emission", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits nothing when the gate is off", async () => {
    const { emitFunnelHomeView } = await import("~/lib/funnel-measurement.server");
    emitFunnelHomeView({}, makeFunnelRequest());
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits nothing when the request carries the GPC signal", async () => {
    const { emitFunnelHomeView } = await import("~/lib/funnel-measurement.server");
    const gpcRequest = new Request("http://localhost/", { headers: { "sec-gpc": "1" } });
    emitFunnelHomeView({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpcRequest);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits an allowlisted record when enabled and not opted out", async () => {
    const { emitFunnelHomeView } = await import("~/lib/funnel-measurement.server");
    emitFunnelHomeView({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(1);
    const record = records[0] as {
      operation: string;
      level: string;
      message: string;
      timestamp: string;
      details: Record<string, string>;
    };
    expect(record.operation).toBe("funnel_home_view");
    expect(record.level).toBe("info");
    expect(record.message).toBe("Anonymous homepage view");
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    expect(record.details.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.details.route).toBe("home");
    expect(record.details.account_scope).toBe("anonymous");
  });

  it("never lets a caller-controlled value into a record field", async () => {
    const { emitFunnelSearchResult, emitFunnelSearchError } =
      await import("~/lib/funnel-measurement.server");
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };

    emitFunnelSearchResult(env, makeFunnelRequest(), 999999);
    emitFunnelSearchError(env, makeFunnelRequest(), "rate_limited");

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(2);

    const resultRecord = records[0] as { details: Record<string, string> };
    expect(Object.keys(resultRecord.details).sort()).toEqual(
      ["account_scope", "event_id", "result_count_bucket", "route"].sort(),
    );
    expect(resultRecord.details.result_count_bucket).toBe("51+");
    expect(JSON.stringify(records)).not.toContain("999999");

    const errorRecord = records[1] as { details: Record<string, string> };
    expect(Object.keys(errorRecord.details).sort()).toEqual(
      ["account_scope", "error_kind", "event_id", "route"].sort(),
    );
    expect(errorRecord.details.error_kind).toBe("rate_limited");
    expect(errorRecord.details.route).toBe("search_preview");
  });

  it("bounds result counts into the spec buckets", async () => {
    const { bucketForResultCount } = await import("~/lib/funnel-measurement.server");
    expect(bucketForResultCount(0)).toBe("0");
    expect(bucketForResultCount(-5)).toBe("0");
    expect(bucketForResultCount(1)).toBe("1-10");
    expect(bucketForResultCount(10)).toBe("1-10");
    expect(bucketForResultCount(11)).toBe("11-50");
    expect(bucketForResultCount(50)).toBe("11-50");
    expect(bucketForResultCount(51)).toBe("51+");
    expect(bucketForResultCount(1000)).toBe("51+");
    expect(bucketForResultCount(Number.NaN)).toBe("0");
    expect(bucketForResultCount(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("classifies search failures into the coarse error-kind allowlist only", async () => {
    const { funnelErrorKindFromUnknown } = await import("~/lib/funnel-measurement.server");
    expect(funnelErrorKindFromUnknown(new Response("", { status: 429 }))).toBe("rate_limited");
    expect(funnelErrorKindFromUnknown(new Response("", { status: 500 }))).toBe("internal");
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "timeout"))).toBe(
      "provider",
    );
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "rate_limited"))).toBe(
      "rate_limited",
    );
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "empty_result"))).toBe(
      "empty_result",
    );
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "login_wall"))).toBe(
      "provider",
    );
    expect(funnelErrorKindFromUnknown(new Error("generic"))).toBe("internal");
    expect(funnelErrorKindFromUnknown(null)).toBe("internal");
    expect(funnelErrorKindFromUnknown("string")).toBe("internal");
  });

  it("emits only server-side timestamps and ids, never client values", async () => {
    const { emitFunnelSignupStart } = await import("~/lib/funnel-measurement.server");
    emitFunnelSignupStart({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    const [record] = emittedFunnelRecords(logSpy) as [Record<string, unknown>];
    expect(record.operation).toBe("funnel_signup_start");
    expect((record.details as Record<string, string>).route).toBe("signup");
    expect(JSON.stringify(record)).not.toMatch(/client|email|name|token|user/i);
  });

  it("emits a migration-page view with the coarse route label only", async () => {
    const { emitFunnelMigrationView } = await import("~/lib/funnel-measurement.server");
    emitFunnelMigrationView(
      { FUNNEL_MEASUREMENT_ENABLED: "1" },
      makeFunnelRequest("http://localhost/compare/magicbrief?utm=anything"),
    );
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; details: Record<string, string>; message: string },
    ];
    expect(record.operation).toBe("funnel_migration_view");
    expect(record.details.route).toBe("magicbrief_migration");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    // The full URL (query string included) never reaches the record.
    expect(JSON.stringify(record)).not.toContain("utm");
  });

  it("suppresses migration events for the gate and for GPC like every other event", async () => {
    const { emitFunnelMigrationView, emitFunnelSignupStartFromMigrationReferrer } =
      await import("~/lib/funnel-measurement.server");

    emitFunnelMigrationView({}, makeFunnelRequest("http://localhost/compare/magicbrief"));
    emitFunnelSignupStartFromMigrationReferrer({}, makeFunnelRequest(), true);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);

    const gpc = new Request("http://localhost/compare/magicbrief", {
      headers: { "sec-gpc": "1" },
    });
    emitFunnelMigrationView({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpc);
    emitFunnelSignupStartFromMigrationReferrer({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpc, true);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });

  it("selects the magicbrief signup kind from the typed boolean and never records the marker value", async () => {
    const { emitFunnelSignupStartFromMigrationReferrer, MAGICBRIEF_MIGRATION_SOURCE } =
      await import("~/lib/funnel-measurement.server");
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };

    // A hostile URL whose query is caller-controlled end to end.
    const hostileUrl = `http://localhost/auth/signup?source=${MAGICBRIEF_MIGRATION_SOURCE}&x=%3Cscript%3Ealert(1)%3C/script%3E`;
    emitFunnelSignupStartFromMigrationReferrer(env, makeFunnelRequest(hostileUrl), true);
    emitFunnelSignupStartFromMigrationReferrer(env, makeFunnelRequest(hostileUrl), false);

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(2);
    const operations = records.map((record) => (record as { operation: string }).operation);
    expect(operations).toEqual(["funnel_signup_start_magicbrief", "funnel_signup_start"]);

    for (const record of records) {
      const details = (record as { details: Record<string, string> }).details;
      expect(Object.keys(details).sort()).toEqual(["account_scope", "event_id", "route"].sort());
      expect(details.route).toBe("signup");
    }
    // Neither the marker value nor any other raw query content appears anywhere.
    expect(JSON.stringify(records)).not.toContain(MAGICBRIEF_MIGRATION_SOURCE);
    expect(JSON.stringify(records)).not.toContain("script");
  });
});

describe("funnel measurement redaction", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts credential-named keys at the storage layer", () => {
    writeAppLog({
      level: "info",
      operation: "funnel_home_view",
      message: "Anonymous homepage view",
      timestamp: "2026-08-07T00:00:00.000Z",
      details: {
        event_id: "abc",
        route: "home",
        account_scope: "anonymous",
        api_key: "super-secret-value",
        token: "super-secret-token",
      },
    });
    const line = String(logSpy.mock.calls[0]?.[0]);
    expect(line).toContain('"api_key":"[redacted]"');
    expect(line).toContain('"token":"[redacted]"');
    expect(line).not.toContain("super-secret-value");
    expect(line).not.toContain("super-secret-token");
  });
});

describe("funnel measurement route boundaries", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    vi.resetModules();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/workspace.server");
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/rate-limit.server");
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/search-selection.server");
    vi.doUnmock("~/lib/search-steal-summary.server");
    vi.doUnmock("~/lib/commercial-launch-gate.server");
    vi.doUnmock("~/lib/dodo-pricing.server");
    vi.doUnmock("~/lib/public-proof.server");
    vi.doUnmock("~/lib/better-auth.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("emits funnel_migration_view from the migration-page loader and returns identical data when disabled", async () => {
    let env: Record<string, string> = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));

    const { loader } = await import("~/routes/compare.magicbrief");

    const enabledData = await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/compare/magicbrief"),
    } as never);
    const enabledRecords = emittedFunnelRecords(logSpy);
    expect(enabledRecords).toHaveLength(1);
    expect((enabledRecords[0] as { operation: string }).operation).toBe("funnel_migration_view");
    expect((enabledRecords[0] as { details: Record<string, string> }).details.route).toBe(
      "magicbrief_migration",
    );

    logSpy.mockClear();
    env = {};
    const disabledData = await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/compare/magicbrief"),
    } as never);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
    expect(disabledData).toEqual(enabledData);
  }, 30_000);

  it("emits funnel_home_view from the homepage loader and returns identical data when disabled", async () => {
    let env: Record<string, string> = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({
      publicCommercialLaunchSummary: vi.fn(() => ({
        scoutSaleOpen: false,
        starterSaleOpen: false,
        agencySaleOpen: false,
      })),
    }));
    vi.doMock("~/lib/dodo-pricing.server", () => ({
      previewDodo0509PlanPrices: vi.fn().mockResolvedValue({ available: false }),
    }));
    vi.doMock("~/lib/public-proof.server", () => ({
      loadPublicProofBrief: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/marketing");

    const enabledData = await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/"),
    } as never);
    const enabledRecords = emittedFunnelRecords(logSpy);
    expect(enabledRecords).toHaveLength(1);
    expect((enabledRecords[0] as { operation: string }).operation).toBe("funnel_home_view");

    logSpy.mockClear();
    env = {};
    const disabledData = await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/"),
    } as never);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
    expect(disabledData).toEqual(enabledData);
    expect(disabledData).toMatchObject({
      pricingPreview: { available: false },
      commercialLaunch: expect.objectContaining({ scoutSaleOpen: false, agencySaleOpen: false }),
    });
  }, 30_000);

  it("emits submit + result from the search loader and identical data when disabled", async () => {
    const baseAd = {
      metaAdId: "meta-ad-1",
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      hook: "Bass bhi. Battery bhi.",
      offer: "Launch pricing",
      cta: "Buy now",
      format: "image",
      languageLabel: "Hinglish",
      destinationType: "website",
      landingPageUrl: null,
      adSnapshotUrl: "https://cdn.example.com/ad-1.png",
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "meta",
      analysisFields: [],
    };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const hydratedResult = { ...sourceResult, cacheStatus: "miss" };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: hydratedResult,
      selectedAd: null,
      selectionEnrichmentPending: false,
    });

    let env: Record<string, string> = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));
    vi.doMock("~/lib/search-steal-summary.server", () => ({
      shouldGenerateStealSummary: vi.fn().mockReturnValue(false),
      buildSearchStealSummary: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    const request = makeFunnelRequest(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
    );

    const enabledData = await loader({ context: createContext(env), request } as never);
    const enabledRecords = emittedFunnelRecords(logSpy);
    const operations = enabledRecords.map((record) => (record as { operation: string }).operation);
    expect(operations).toContain("funnel_search_preview_submit");
    expect(operations).toContain("funnel_search_preview_result");
    const resultRecord = enabledRecords.find(
      (record) => (record as { operation: string }).operation === "funnel_search_preview_result",
    ) as { details: Record<string, string> };
    expect(resultRecord.details.result_count_bucket).toBe("1-10");

    logSpy.mockClear();
    env = {};
    const disabledData = await loader({ context: createContext(env), request } as never);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
    expect(disabledData).toEqual(enabledData);
  }, 30_000);

  it("emits nothing from the search loader for an idle page (no query)", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/search"),
    } as never);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);

  it("emits a coarse error event and rethrows the same failure from the search loader", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const searchAdsViaSourceResolver = vi
      .fn()
      .mockRejectedValue(new CommercialDiscoveryError("provider down", "timeout"));
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const request = makeFunnelRequest(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
    );

    let thrown: unknown;
    try {
      await loader({ context: createContext(env), request } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommercialDiscoveryError);
    expect((thrown as Error).message).toBe("provider down");

    const records = emittedFunnelRecords(logSpy);
    const errorRecord = records.find(
      (record) => (record as { operation: string }).operation === "funnel_search_preview_error",
    ) as { details: Record<string, string> };
    expect(errorRecord.details.error_kind).toBe("provider");
    expect(JSON.stringify(records)).not.toContain("provider down");
    expect(JSON.stringify(records)).not.toContain("stack");
  }, 30_000);

  it("emits a rate_limited error event when the public search rate limit blocks", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi
        .fn()
        .mockResolvedValue(new Response("Too many", { status: 429 })),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const request = makeFunnelRequest(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
    );

    let thrown: unknown;
    try {
      await loader({ context: createContext(env), request } as never);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Response).status).toBe(429);
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();

    const records = emittedFunnelRecords(logSpy);
    const errorRecord = records.find(
      (record) => (record as { operation: string }).operation === "funnel_search_preview_error",
    ) as { details: Record<string, string> };
    expect(errorRecord.details.error_kind).toBe("rate_limited");
  }, 30_000);

  it("suppresses every search-boundary event for a GPC request", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "demo",
      provider: null,
      cacheStatus: "none",
      discoveryStatus: "disabled",
      discoverySummary: null,
      discoveryFailureClass: null,
    });
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: { ads: [], nextCursor: null, source: "demo" },
      selectedAd: null,
      selectionEnrichmentPending: false,
    });

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));
    vi.doMock("~/lib/search-steal-summary.server", () => ({
      shouldGenerateStealSummary: vi.fn().mockReturnValue(false),
      buildSearchStealSummary: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    const request = new Request(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
      { headers: { "sec-gpc": "1" } },
    );
    const result = await loader({ context: createContext(env), request } as never);
    expect(result).toMatchObject({ inputError: null, session: null });
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);

  it("does not emit submit for an ad-selection reload of an existing search", async () => {
    const baseAd = {
      metaAdId: "meta-ad-1",
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      hook: "Bass bhi. Battery bhi.",
      offer: "Launch pricing",
      cta: "Buy now",
      format: "image",
      languageLabel: "Hinglish",
      destinationType: "website",
      landingPageUrl: null,
      adSnapshotUrl: "https://cdn.example.com/ad-1.png",
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "meta",
      analysisFields: [],
    };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const hydratedResult = { ...sourceResult, cacheStatus: "miss" };
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
      hasFreshDiscoveryCacheEntry: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: hydratedResult,
        selectedAd: baseAd,
        selectionEnrichmentPending: false,
      }),
    }));
    vi.doMock("~/lib/search-steal-summary.server", () => ({
      shouldGenerateStealSummary: vi.fn().mockReturnValue(false),
      buildSearchStealSummary: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: makeFunnelRequest(
        "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com&selected=meta-ad-1",
      ),
    } as never);

    const operations = emittedFunnelRecords(logSpy).map(
      (record) => (record as { operation: string }).operation,
    );
    expect(operations).not.toContain("funnel_search_preview_submit");
    expect(operations).toContain("funnel_search_preview_result");
  }, 30_000);

  it("emits funnel_signup_start only after a successful magic-link send", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const sendBetterAuthMagicLink = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      sendBetterAuthMagicLink,
    }));

    const { action } = await import("~/routes/auth.signup");
    const request = makeFunnelPost("http://localhost/auth/signup", {
      email: "owner@example.com",
      name: "Owner",
      redirectTo: "/app#setup-checklist",
    });

    let thrown: unknown;
    try {
      await action({
        context: createContext(env),
        request,
      } as never);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Response).status).toBe(302);
    expect(sendBetterAuthMagicLink).toHaveBeenCalledTimes(1);

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(1);
    expect((records[0] as { operation: string }).operation).toBe("funnel_signup_start");
    expect((records[0] as { details: Record<string, string> }).details.route).toBe("signup");
  }, 30_000);

  it("emits the magicbrief signup kind when the migration marker rides the action URL", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const sendBetterAuthMagicLink = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      sendBetterAuthMagicLink,
    }));

    const { action } = await import("~/routes/auth.signup");
    // The migration page's form posts back to the same URL it linked from.
    let thrown: unknown;
    try {
      await action({
        context: createContext(env),
        request: makeFunnelPost(
          "http://localhost/auth/signup?source=magicbrief-migration",
          {
            email: "owner@example.com",
            name: "Owner",
            redirectTo: "/app#setup-checklist",
          },
        ),
      } as never);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Response).status).toBe(302);
    expect(sendBetterAuthMagicLink).toHaveBeenCalledTimes(1);

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(1);
    expect((records[0] as { operation: string }).operation).toBe("funnel_signup_start_magicbrief");
    expect((records[0] as { details: Record<string, string> }).details.route).toBe("signup");
  }, 30_000);

  it("emits no funnel_signup_start for invalid signup input", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      sendBetterAuthMagicLink: vi.fn(),
    }));

    const { action } = await import("~/routes/auth.signup");
    const result = await action({
      context: createContext(env),
      request: makeFunnelPost("http://localhost/auth/signup", {
        email: "not-an-email",
        name: "Someone",
      }),
    } as never);
    expect(result).toMatchObject({ ok: false, error: "Enter a valid email address." });
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);

  it("emits funnel_signup_start for OAuth signup starts but not login starts", async () => {
    let env: Record<string, string> = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isBetterAuthOAuthProvider: vi.fn().mockReturnValue(true),
      isBetterAuthOAuthProviderConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      startBetterAuthSocialSignIn: vi.fn().mockResolvedValue({
        url: "https://accounts.example.com/start?provider=google",
        headers: new Headers(),
      }),
      appendBetterAuthSetCookieHeaders: vi.fn(),
    }));

    const { action } = await import("~/routes/auth.better.oauth");

    let signupThrown: unknown;
    try {
      await action({
        context: createContext(env),
        request: makeFunnelPost("http://localhost/auth/better/oauth", {
          mode: "signup",
          provider: "google",
        }),
      } as never);
    } catch (error) {
      signupThrown = error;
    }
    expect((signupThrown as Response).status).toBe(302);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(1);
    expect((emittedFunnelRecords(logSpy)[0] as { operation: string }).operation).toBe(
      "funnel_signup_start",
    );

    logSpy.mockClear();
    let loginThrown: unknown;
    try {
      await action({
        context: createContext(env),
        request: makeFunnelPost("http://localhost/auth/better/oauth", {
          mode: "login",
          provider: "google",
        }),
      } as never);
    } catch (error) {
      loginThrown = error;
    }
    expect((loginThrown as Response).status).toBe(302);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);
});