import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env: Record<string, unknown> = {}) {
  return { cloudflare: { env } };
}

function parseEvents(): Record<string, unknown>[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => String(call[0]))
    .filter((line) => line.includes('"operation"'))
    .map((line) => JSON.parse(line));
}

function clearEvents() {
  vi.mocked(console.log).mockClear();
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/better-auth.server");
  vi.doUnmock("~/lib/commercial-launch-gate.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/customer-meta.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/safe-redirect");
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/search-selection.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

const enabledEnv = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "1" };

const baseAd = {
  metaAdId: "meta-boat-1",
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
  adSnapshotUrl: "https://cdn.example.com/meta-boat-1.png",
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta",
  analysisFields: [],
};

describe("homepage boundary (marketing loader)", () => {
  async function loadHome(env: Record<string, unknown>, headers: Record<string, string> = {}) {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({
      publicCommercialLaunchSummary: vi.fn(() => ({ gate: "pass" })),
    }));
    const { loader } = await import("~/routes/marketing");
    return loader({
      context: createContext(env),
      request: new Request("http://localhost/", { headers }),
    } as never);
  }

  it("renders the homepage with measurement disabled and emits nothing", async () => {
    const result = await loadHome({ DB: {} });
    expect(result).toMatchObject({ pricingPreview: { available: false } });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("emits funnel_home_view when enabled and no GPC signal", async () => {
    await loadHome(enabledEnv);
    const events = parseEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: "funnel_home_view",
      details: { route: "home", account_scope: "anonymous" },
    });
  });

  it("emits nothing for GPC requests even when enabled", async () => {
    await loadHome(enabledEnv, { "Sec-GPC": "1" });
    expect(parseEvents()).toHaveLength(0);
  });
});

describe("signup boundary (auth.signup loader)", () => {
  async function loadSignup(
    env: Record<string, unknown>,
    options: { session?: unknown; url?: string; headers?: Record<string, string> } = {},
  ) {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(options.session ?? null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/safe-redirect", () => ({
      safeRedirectPath: vi.fn((_path: string, fallback: string) => fallback),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      enabledBetterAuthOAuthProviders: vi.fn(() => []),
    }));
    const { loader } = await import("~/routes/auth.signup");
    return loader({
      context: createContext(env),
      request: new Request(options.url ?? "http://localhost/auth/signup", {
        headers: options.headers ?? {},
      }),
    } as never);
  }

  it("renders the signup page with measurement disabled and emits nothing", async () => {
    const result = await loadSignup({ DB: {} });
    expect(result).toMatchObject({ linkSent: false });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("emits funnel_signup_start for an anonymous visitor when enabled", async () => {
    await loadSignup(enabledEnv);
    const events = parseEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: "funnel_signup_start",
      details: { route: "signup", account_scope: "anonymous" },
    });
  });

  it("does not emit a new start on the post-submit confirmation render", async () => {
    await loadSignup(enabledEnv, { url: "http://localhost/auth/signup?sent=1" });
    expect(parseEvents()).toHaveLength(0);
  });

  it("emits nothing for a signed-in visitor and redirects as before", async () => {
    await expect(
      loadSignup(enabledEnv, {
        session: { user: { id: "u-1" }, session: { id: "s-1" } },
      }),
    ).rejects.toMatchObject({ status: 302 });
    expect(parseEvents()).toHaveLength(0);
  });

  it("emits nothing for GPC requests even when enabled", async () => {
    await loadSignup(enabledEnv, { headers: { GPC: "1" } });
    expect(parseEvents()).toHaveLength(0);
  });
});

describe("search preview boundary (search loader)", () => {
  async function loadSearch(
    env: Record<string, unknown>,
    options: {
      url?: string;
      headers?: Record<string, string>;
      session?: unknown;
      sourceResult?: Record<string, unknown>;
    } = {},
  ) {
    const session = options.session ?? null;
    const healthyResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const sourceResult = options.sourceResult ?? healthyResult;
    const hydratedResult = { ...sourceResult, cacheStatus: "miss" };

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: hydratedResult,
        selectedAd: (sourceResult.ads as unknown[]).length > 0 ? baseAd : null,
      }),
    }));

    const { loader } = await import("~/routes/search");
    return loader({
      context: createContext(env),
      request: new Request(options.url ?? "http://localhost/search?query=nykaa", {
        headers: options.headers ?? {},
      }),
    } as never);
  }

  it("keeps the idle page behavior unchanged when measurement is disabled", async () => {
    const result = await loadSearch({ DB: {} }, { url: "http://localhost/search" });
    expect(result).toMatchObject({
      session: null,
      result: { ads: [], discoveryStatus: "disabled" },
    });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("emits nothing when disabled for a submitted anonymous search", async () => {
    const result = await loadSearch({ DB: {} });
    expect(result).toMatchObject({ session: null });
    expect(parseEvents()).toHaveLength(0);
  });

  it("emits submit + result with a coarse bucket for an anonymous search", async () => {
    const result = await loadSearch(enabledEnv);
    expect(result).toMatchObject({ session: null });
    const events = parseEvents();
    expect(events.map((event) => event.operation)).toEqual([
      "funnel_search_preview_submit",
      "funnel_search_preview_result",
    ]);
    expect(events[1]).toMatchObject({
      details: {
        route: "search_preview",
        account_scope: "anonymous",
        result_count_bucket: "1-10",
      },
    });
  });

  it("emits submit + error with a coarse kind when the preview fails", async () => {
    const failed = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "failed",
      discoverySummary: null,
      discoveryFailureClass: "timeout",
    };
    await loadSearch(enabledEnv, { sourceResult: failed });
    const events = parseEvents();
    expect(events.map((event) => event.operation)).toEqual([
      "funnel_search_preview_submit",
      "funnel_search_preview_error",
    ]);
    expect(events[1]).toMatchObject({
      details: {
        route: "search_preview",
        account_scope: "anonymous",
        error_kind: "timeout",
      },
    });
  });

  it("emits nothing for GPC requests even when enabled", async () => {
    await loadSearch(enabledEnv, { headers: { "Sec-GPC": "1" } });
    expect(parseEvents()).toHaveLength(0);
  });

  it("emits nothing for signed-in searches (anonymous v1 scope only)", async () => {
    await loadSearch(enabledEnv, {
      session: {
        user: { id: "user-1", email: "owner@example.com", name: "Owner" },
        session: { id: "session-1", userId: "user-1", expiresAt: "2026-04-03T00:00:00.000Z" },
      },
    });
    expect(parseEvents()).toHaveLength(0);
  });

  it("does not emit submit when no query was submitted", async () => {
    await loadSearch(enabledEnv, { url: "http://localhost/search" });
    expect(parseEvents()).toHaveLength(0);
  });

  it("emits an error event only when the failure class is allowlisted", async () => {
    clearEvents();
    const oddFailure = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "failed",
      discoverySummary: null,
      discoveryFailureClass: "custom_brand_new_failure",
    };
    await loadSearch(enabledEnv, { sourceResult: oddFailure });
    const events = parseEvents();
    expect(events.map((event) => event.operation)).toEqual([
      "funnel_search_preview_submit",
    ]);
  });
});
