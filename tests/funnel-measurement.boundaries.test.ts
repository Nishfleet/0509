import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

const baseAd: AdRecord = {
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

const commercialLaunch = {
  scoutSaleOpen: true,
  starterSaleOpen: true,
  agencySaleOpen: false,
};

function createContext(env: Record<string, unknown> = {}) {
  return { cloudflare: { env } };
}

function capturedLogRecords(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .map((call) => call[0])
    .filter((value): value is string => typeof value === "string")
    .map((value) => JSON.parse(value) as Record<string, unknown>);
}

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/better-auth.server");
  vi.doUnmock("~/lib/commercial-launch-gate.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/safe-redirect");
  vi.doUnmock("~/lib/search-execution.server");
  vi.doUnmock("~/lib/search-selection.server");
  vi.doUnmock("~/lib/workspace.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("homepage boundary (funnel_home_view)", () => {
  function setup(env: Record<string, unknown>) {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({
      publicCommercialLaunchSummary: vi.fn(() => commercialLaunch),
    }));
  }

  it("keeps the homepage response unchanged and emits nothing when disabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    setup({ DB: {} });
    const { loader } = await import("~/routes/marketing");

    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/"),
    } as never);

    expect(result).toEqual({
      pricingPreview: { available: false },
      commercialLaunch,
    });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits funnel_home_view with only allowlisted fields when enabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setup(env);
    const { loader } = await import("~/routes/marketing");

    await loader({
      context: createContext(env),
      request: new Request("https://0509.io/"),
    } as never);

    const [record] = capturedLogRecords(consoleSpy);
    expect(record.operation).toBe("funnel_home_view");
    expect(record.details).toEqual({ route: "home" });
  });

  it("emits nothing for a GPC request even when enabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setup(env);
    const { loader } = await import("~/routes/marketing");

    await loader({
      context: createContext(env),
      request: new Request("https://0509.io/", { headers: { "sec-gpc": "1" } }),
    } as never);

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("search preview boundaries (submit/result/error)", () => {
  function setupSearchMocks(env: Record<string, unknown>, sourceResult: unknown) {
    const searchAdsViaSourceResolver = vi
      .fn()
      .mockResolvedValue(sourceResult);
    const hydratedResult = {
      ...(sourceResult as object),
      cacheStatus: "miss",
    };
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: hydratedResult,
      selectedAd: null,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

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
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));
    return { searchAdsViaSourceResolver, prepareSearchResultSelection };
  }

  function searchUrl(extra = "", headers: Record<string, string> = {}) {
    return new Request(`https://0509.io/search?query=nykaa${extra}`, { headers });
  }

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

  it("returns the same result and emits nothing when disabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {} };
    setupSearchMocks(env, sourceResult);
    const { loader } = await import("~/routes/search");

    const result = await loader({
      context: createContext(env),
      request: searchUrl(),
    } as never);

    expect((result as { result: { ads: unknown[] } }).result.ads).toEqual([baseAd]);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits submit and result with a bounded bucket when enabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setupSearchMocks(env, sourceResult);
    const { loader } = await import("~/routes/search");

    await loader({
      context: createContext(env),
      request: searchUrl(),
    } as never);

    const records = capturedLogRecords(consoleSpy);
    expect(records.map((record) => record.operation)).toEqual([
      "funnel_search_preview_submit",
      "funnel_search_preview_result",
    ]);
    expect(records[0].details).toEqual({ route: "search_preview" });
    expect(records[1].details).toEqual({
      route: "search_preview",
      result_count_bucket: "1-10",
    });
  });

  it("emits nothing for a GPC search even when enabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setupSearchMocks(env, sourceResult);
    const { loader } = await import("~/routes/search");

    const result = await loader({
      context: createContext(env),
      request: searchUrl("", { "sec-gpc": "1" }),
    } as never);

    expect((result as { result: { ads: unknown[] } }).result.ads).toEqual([baseAd]);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits a coarse error kind and still rethrows on preview failure", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    vi.resetModules();
    setupSearchMocks(env, sourceResult);
    const failingError = Object.assign(
      new Error("the Meta Ad Library is rate-limiting this token: tok_123"),
      { failureClass: "rate_limited" },
    );
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockRejectedValue(failingError),
    }));
    const { loader } = await import("~/routes/search");

    await expect(
      loader({ context: createContext(env), request: searchUrl() } as never),
    ).rejects.toThrow("rate-limiting");

    const records = capturedLogRecords(consoleSpy);
    expect(records.map((record) => record.operation)).toEqual([
      "funnel_search_preview_submit",
      "funnel_search_preview_error",
    ]);
    const errorRecord = records.find(
      (record) => record.operation === "funnel_search_preview_error",
    );
    expect(errorRecord?.details).toEqual({
      route: "search_preview",
      error_kind: "rate_limited",
    });
    expect(JSON.stringify(errorRecord)).not.toContain("tok_123");
  });

  it("does not emit an error event when a rate limit refuses the request", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    vi.resetModules();
    setupSearchMocks(env, sourceResult);
    const rateLimitResponse = new Response("rate limited", { status: 429 });
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(rateLimitResponse),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    const { loader } = await import("~/routes/search");

    let thrown: unknown = null;
    try {
      await loader({ context: createContext(env), request: searchUrl() } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(429);

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("signup boundaries (funnel_signup_start)", () => {
  function setupSignupMocks(env: Record<string, unknown>) {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/safe-redirect", () => ({
      safeRedirectPath: vi.fn((value: string) => value || "/app#setup-checklist"),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn(() => true),
      isSameOriginAuthFormPost: vi.fn(() => true),
      sendBetterAuthMagicLink: vi.fn().mockResolvedValue({}),
    }));
  }

  function signupForm() {
    const formData = new FormData();
    formData.set("email", "owner@example.com");
    formData.set("name", "Owner");
    formData.set("redirectTo", "/app#setup-checklist");
    return formData;
  }

  async function expectSignupRedirect(invoke: () => Promise<unknown>) {
    try {
      await invoke();
      throw new Error("expected signup action to redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toContain("/auth/signup?sent=1");
    }
  }

  function signupActionRequest(env: Record<string, unknown>, headers: Record<string, string> = {}) {
    return {
      context: createContext(env),
      request: new Request("https://0509.io/auth/signup", {
        method: "POST",
        body: signupForm(),
        headers,
      }),
    } as never;
  }

  it("still sends the magic link and redirects, emitting nothing when disabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {} };
    setupSignupMocks(env);
    const { action } = await import("~/routes/auth.signup");

    await expectSignupRedirect(() => action(signupActionRequest(env)));

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits funnel_signup_start after a successful magic-link send when enabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setupSignupMocks(env);
    const { action } = await import("~/routes/auth.signup");

    await expectSignupRedirect(() => action(signupActionRequest(env)));

    const [record] = capturedLogRecords(consoleSpy);
    expect(record.operation).toBe("funnel_signup_start");
    expect(record.details).toEqual({ route: "signup" });
    expect(JSON.stringify(record)).not.toContain("owner@example.com");
  });

  it("emits nothing for a GPC signup even when enabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setupSignupMocks(env);
    const { action } = await import("~/routes/auth.signup");

    await expectSignupRedirect(() =>
      action(signupActionRequest(env, { "sec-gpc": "1" })),
    );

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("OAuth signup boundary (funnel_signup_start)", () => {
  function setupOAuthMocks(env: Record<string, unknown>) {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/safe-redirect", () => ({
      safeRedirectPath: vi.fn((value: string) => value || "/app"),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      appendBetterAuthSetCookieHeaders: vi.fn(),
      isBetterAuthConfigured: vi.fn(() => true),
      isBetterAuthOAuthProvider: vi.fn((provider: string) => provider === "google"),
      isBetterAuthOAuthProviderConfigured: vi.fn(() => true),
      isSameOriginAuthFormPost: vi.fn(() => true),
      startBetterAuthSocialSignIn: vi.fn().mockResolvedValue({
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        headers: new Headers(),
      }),
    }));
  }

  function oauthForm(mode: string) {
    const formData = new FormData();
    formData.set("mode", mode);
    formData.set("provider", "google");
    formData.set("redirectTo", "/app");
    return formData;
  }

  async function expectOAuthRedirect(invoke: () => Promise<unknown>) {
    try {
      await invoke();
      throw new Error("expected OAuth action to redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    }
  }

  function oauthActionRequest(env: Record<string, unknown>, mode: string) {
    return {
      context: createContext(env),
      request: new Request("https://0509.io/auth/better/oauth", {
        method: "POST",
        body: oauthForm(mode),
      }),
    } as never;
  }

  it("emits funnel_signup_start when a signup-mode OAuth flow starts", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setupOAuthMocks(env);
    const { action } = await import("~/routes/auth.better.oauth");

    await expectOAuthRedirect(() => action(oauthActionRequest(env, "signup")));

    const [record] = capturedLogRecords(consoleSpy);
    expect(record.operation).toBe("funnel_signup_start");
    expect(record.details).toEqual({ route: "signup" });
  });

  it("emits nothing for a login-mode OAuth flow", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {}, FUNNEL_MEASUREMENT_ENABLED: "true" };
    setupOAuthMocks(env);
    const { action } = await import("~/routes/auth.better.oauth");

    await expectOAuthRedirect(() => action(oauthActionRequest(env, "login")));

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits nothing when collection is disabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { DB: {} };
    setupOAuthMocks(env);
    const { action } = await import("~/routes/auth.better.oauth");

    await expectOAuthRedirect(() => action(oauthActionRequest(env, "signup")));

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
