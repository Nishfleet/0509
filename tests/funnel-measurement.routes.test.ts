import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return { APP_ORIGIN: "https://0509.io", ...overrides };
}

function createContext(testEnv: AppEnv) {
  return { cloudflare: { env: testEnv } };
}

function funnelLogLines(lines: string[]) {
  return lines.filter((line) => line.includes("funnel_"));
}

function captureLogs() {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  return lines;
}

function baseSearchResult(ads = 5) {
  return {
    result: {
      ads: Array.from({ length: ads }, (_, index) => ({
        metaAdId: `meta-ad-${index}`,
        advertiser: "Nykaa",
        body: "Glow",
        source: "demo",
      })),
      nextCursor: null,
      source: "demo",
    },
    query: { mode: "advertiser" as const, filters: { query: "nykaa" } },
    searchScope: "exact" as const,
    displayDomain: "nykaa.com",
    relevanceApplied: false,
  };
}

function installSearchMocks(testEnv: AppEnv, overrides: Record<string, unknown> = {}) {
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => testEnv),
  }));
  vi.doMock("~/lib/e2e-provider.server", () => ({
    resolveE2EProviderDeny: vi.fn().mockResolvedValue({
      enabled: false,
      failClosed: false,
      reason: "missing_deny_flag",
    }),
    sanitizeE2EProviderEnv: vi.fn((requestEnv) => requestEnv),
  }));
  vi.doMock("~/lib/e2e-search.server", () => ({
    resolveE2ELocalSearchContext: vi.fn().mockResolvedValue({
      env: testEnv,
      enabled: false,
      fixtureProvider: null,
    }),
  }));
  vi.doMock("~/lib/auth.server", () => ({
    getOptionalSession: vi.fn().mockResolvedValue(overrides.session ?? null),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/search-execution.server", () => ({
    executeSearchWithRelevance: vi
      .fn()
      .mockImplementation(() =>
        overrides.searchError
          ? Promise.reject(overrides.searchError)
          : Promise.resolve(overrides.searchResult ?? baseSearchResult()),
      ),
    hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(false),
  }));
  vi.doMock("~/lib/search-rollout.server", () => ({
    shouldApplySearchV2: vi.fn(() => true),
    shouldRunSearchV2Shadow: vi.fn(() => false),
  }));
  vi.doMock("~/lib/search-selection.server", () => ({
    prepareSearchResultSelection: vi.fn().mockImplementation((_env, result) =>
      Promise.resolve({
        result,
        selectedAd: null,
        selectionEnrichmentPending: false,
      }),
    ),
  }));
  vi.doMock("~/lib/search-steal-summary.server", () => ({
    shouldGenerateStealSummary: vi.fn(() => false),
    buildSearchStealSummary: vi.fn(),
  }));
}

async function runSearchLoader(
  testEnv: AppEnv,
  url: string,
  overrides: Record<string, unknown> = {},
) {
  installSearchMocks(testEnv, overrides);
  const { loader } = await import("~/routes/search");
  const headers = overrides.gpc ? { "sec-gpc": "1" } : undefined;
  return loader({
    context: createContext(testEnv),
    request: new Request(url, {
      method: overrides.head ? "HEAD" : "GET",
      headers,
    }),
  } as never);
}

describe("funnel measurement route boundaries", () => {
  // The route modules carry a large static import graph; the first import in a
  // worker can exceed the global 10s timeout under parallel load. Warm the
  // transform cache up front so no test pays that cost, and keep generous
  // per-test timeouts as a backstop.
  const ROUTE_TEST_TIMEOUT = 30_000;

  beforeAll(async () => {
    await import("~/routes/marketing");
    await import("~/routes/search");
    await import("~/routes/auth.signup");
    await import("~/routes/auth.better.oauth");
  }, 60_000);

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("homepage (marketing)", () => {
    async function runMarketingLoader(
      testEnv: AppEnv,
      url = "https://0509.io/",
      headers: Record<string, string> = {},
    ) {
      vi.doMock("~/lib/context.server", () => ({
        getEnv: vi.fn(() => testEnv),
      }));
      vi.doMock("~/lib/commercial-launch-gate.server", () => ({
        publicCommercialLaunchSummary: vi.fn(() => ({
          launchLive: false,
        })),
      }));
      const { loader } = await import("~/routes/marketing");
      return loader({
        context: createContext(testEnv),
        request: new Request(url, { headers }),
      } as never);
    }

    it(
      "serves the homepage unchanged with no measurement when disabled",
      async () => {
      const lines = captureLogs();
      const data = await runMarketingLoader(env());
      expect(data).toEqual({
        pricingPreview: { available: false },
        commercialLaunch: { launchLive: false },
      });
      expect(funnelLogLines(lines)).toEqual([]);
    }, ROUTE_TEST_TIMEOUT);

    it(
      "emits funnel_home_view only when enabled and not GPC-opted-out",
      async () => {
      const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
      const lines = captureLogs();
      await runMarketingLoader(enabled);
      expect(funnelLogLines(lines)).toHaveLength(1);
      const record = JSON.parse(funnelLogLines(lines)[0]) as {
        operation: string;
        details: { route: string; account_scope: string };
      };
      expect(record.operation).toBe("funnel_home_view");
      expect(record.details.route).toBe("home");
      expect(record.details.account_scope).toBe("anonymous");
    }, ROUTE_TEST_TIMEOUT);

    it(
      "emits nothing for a GPC homepage request",
      async () => {
      const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
      const gpcLines = captureLogs();
      const data = await runMarketingLoader(enabled, "https://0509.io/", {
        "sec-gpc": "1",
      });
      expect(data).toEqual({
        pricingPreview: { available: false },
        commercialLaunch: { launchLive: false },
      });
      expect(funnelLogLines(gpcLines)).toEqual([]);
    }, ROUTE_TEST_TIMEOUT);
  });

  describe("public search preview", () => {
    const searchUrl =
      "https://0509.io/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com";

    it(
      "returns results unchanged with no measurement when disabled",
      async () => {
        const lines = captureLogs();
        const data = (await runSearchLoader(env(), searchUrl)) as {
          result: { ads: unknown[] };
          inputError: unknown;
          session: unknown;
        };
        expect(data.result.ads).toHaveLength(5);
        expect(data.inputError).toBeNull();
        expect(data.session).toBeNull();
        expect(funnelLogLines(lines)).toEqual([]);
      },
      ROUTE_TEST_TIMEOUT,
    );

    it(
      "emits submit and result events with a coarse bucket when enabled",
      async () => {
        const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
        const lines = captureLogs();
        const data = (await runSearchLoader(enabled, searchUrl)) as {
          result: { ads: unknown[] };
        };
        expect(data.result.ads).toHaveLength(5);
        const funnelLines = funnelLogLines(lines);
        expect(funnelLines).toHaveLength(2);
        const submit = JSON.parse(funnelLines[0]) as {
          operation: string;
          details: Record<string, unknown>;
        };
        const result = JSON.parse(funnelLines[1]) as {
          operation: string;
          details: Record<string, unknown>;
        };
        expect(submit.operation).toBe("funnel_search_preview_submit");
        expect(submit.details.route).toBe("search_preview");
        expect(result.operation).toBe("funnel_search_preview_result");
        expect(result.details.result_count_bucket).toBe("1-10");
      },
      ROUTE_TEST_TIMEOUT,
    );

    it(
      "buckets a zero-ad result as 0",
      async () => {
        const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
        const lines = captureLogs();
        await runSearchLoader(enabled, searchUrl, { searchResult: baseSearchResult(0) });
        const funnelLines = funnelLogLines(lines);
        const result = JSON.parse(funnelLines[1]) as {
          details: { result_count_bucket: string };
        };
        expect(result.details.result_count_bucket).toBe("0");
      },
      ROUTE_TEST_TIMEOUT,
    );

    it(
      "emits an error event when the search result carries a failure class",
      async () => {
        const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
        const lines = captureLogs();
        await runSearchLoader(enabled, searchUrl, {
          searchResult: {
            ...baseSearchResult(),
            result: {
              ...baseSearchResult().result,
              discoveryFailureClass: "rate_limited",
            },
          },
        });
        const funnelLines = funnelLogLines(lines);
        expect(funnelLines).toHaveLength(2);
        const error = JSON.parse(funnelLines[1]) as {
          operation: string;
          details: { error_kind: string };
        };
        expect(error.operation).toBe("funnel_search_preview_error");
        expect(error.details.error_kind).toBe("rate_limited");
      },
      ROUTE_TEST_TIMEOUT,
    );

    it(
      "emits an error event and rethrows when execution fails",
      async () => {
        const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
        const lines = captureLogs();
        await expect(
          runSearchLoader(enabled, searchUrl, {
            searchError: new Error("provider timeout after 30s"),
          }),
        ).rejects.toThrow("provider timeout after 30s");
        const funnelLines = funnelLogLines(lines);
        expect(funnelLines).toHaveLength(2);
        const error = JSON.parse(funnelLines[1]) as {
          operation: string;
          details: { error_kind: string };
        };
        expect(error.operation).toBe("funnel_search_preview_error");
        expect(error.details.error_kind).toBe("timeout");
      },
      ROUTE_TEST_TIMEOUT,
    );

    it(
      "emits nothing for a GPC search request",
      async () => {
        const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
        const lines = captureLogs();
        const data = (await runSearchLoader(enabled, searchUrl, {
          gpc: true,
        })) as { result: { ads: unknown[] } };
        expect(data.result.ads).toHaveLength(5);
        expect(funnelLogLines(lines)).toEqual([]);
      },
      ROUTE_TEST_TIMEOUT,
    );

    it(
      "emits nothing for a HEAD crawl probe with a query",
      async () => {
        const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
        const lines = captureLogs();
        const data = (await runSearchLoader(enabled, searchUrl, {
          head: true,
        })) as { result: { ads: unknown[] } };
        expect(data.result.ads).toHaveLength(0);
        expect(funnelLogLines(lines)).toEqual([]);
      },
      ROUTE_TEST_TIMEOUT,
    );

    it(
      "emits no submit for ad-selection reruns but still records the result",
      async () => {
        const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
        const lines = captureLogs();
        await runSearchLoader(enabled, `${searchUrl}&selected=meta-ad-0`);
        const funnelLines = funnelLogLines(lines);
        expect(funnelLines).toHaveLength(1);
        const record = JSON.parse(funnelLines[0]) as { operation: string };
        expect(record.operation).toBe("funnel_search_preview_result");
      },
      ROUTE_TEST_TIMEOUT,
    );
  });

  describe("signup start (magic link)", () => {
    async function runSignupAction(testEnv: AppEnv, gpc = false) {
      vi.doMock("~/lib/context.server", () => ({
        getEnv: vi.fn(() => testEnv),
      }));
      vi.doMock("~/lib/better-auth.server", () => ({
        isBetterAuthConfigured: vi.fn(() => true),
        isSameOriginAuthFormPost: vi.fn(() => true),
        sendBetterAuthMagicLink: vi.fn().mockResolvedValue(undefined),
      }));
      const { action } = await import("~/routes/auth.signup");
      const formData = new FormData();
      formData.set("email", "new@example.com");
      formData.set("name", "New Person");
      const headers = gpc ? { "sec-gpc": "1" } : {};
      return action({
        context: createContext(testEnv),
        request: new Request("https://0509.io/auth/signup", {
          method: "POST",
          body: formData,
          headers,
        }),
      } as never);
    }

    it("redirects unchanged with no measurement when disabled", async () => {
      const lines = captureLogs();
      try {
        await runSignupAction(env());
        throw new Error("Expected signup redirect");
      } catch (error) {
        const response = error as Response;
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toContain("/auth/signup?sent=1");
      }
      expect(funnelLogLines(lines)).toEqual([]);
    });

    it("emits funnel_signup_start on a successful signup link send when enabled", async () => {
      const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
      const lines = captureLogs();
      try {
        await runSignupAction(enabled);
        throw new Error("Expected signup redirect");
      } catch (error) {
        expect((error as Response).status).toBe(302);
      }
      const funnelLines = funnelLogLines(lines);
      expect(funnelLines).toHaveLength(1);
      const record = JSON.parse(funnelLines[0]) as {
        operation: string;
        details: { route: string };
      };
      expect(record.operation).toBe("funnel_signup_start");
      expect(record.details.route).toBe("signup");
    });

    it("emits nothing for a GPC signup request", async () => {
      const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
      const lines = captureLogs();
      try {
        await runSignupAction(enabled, true);
        throw new Error("Expected signup redirect");
      } catch (error) {
        expect((error as Response).status).toBe(302);
      }
      expect(funnelLogLines(lines)).toEqual([]);
    });
  });

  describe("signup start (OAuth)", () => {
    async function runOAuthAction(testEnv: AppEnv, mode: string) {
      vi.doMock("~/lib/context.server", () => ({
        getEnv: vi.fn(() => testEnv),
      }));
      vi.doMock("~/lib/better-auth.server", () => ({
        appendBetterAuthSetCookieHeaders: vi.fn(),
        isBetterAuthConfigured: vi.fn(() => true),
        isBetterAuthOAuthProvider: vi.fn(() => true),
        isBetterAuthOAuthProviderConfigured: vi.fn(() => true),
        isSameOriginAuthFormPost: vi.fn(() => true),
        startBetterAuthSocialSignIn: vi.fn().mockResolvedValue({
          url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
          headers: new Headers(),
        }),
      }));
      const { action } = await import("~/routes/auth.better.oauth");
      const formData = new FormData();
      formData.set("mode", mode);
      formData.set("provider", "google");
      return action({
        context: createContext(testEnv),
        request: new Request("https://0509.io/auth/oauth", {
          method: "POST",
          body: formData,
        }),
      } as never);
    }

    it("emits funnel_signup_start only for signup-mode OAuth when enabled", async () => {
      const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
      const lines = captureLogs();
      try {
        await runOAuthAction(enabled, "signup");
        throw new Error("Expected OAuth redirect");
      } catch (error) {
        expect((error as Response).status).toBe(302);
      }
      const funnelLines = funnelLogLines(lines);
      expect(funnelLines).toHaveLength(1);
      const record = JSON.parse(funnelLines[0]) as { operation: string };
      expect(record.operation).toBe("funnel_signup_start");

      const loginLines = captureLogs();
      try {
        await runOAuthAction(enabled, "login");
        throw new Error("Expected OAuth redirect");
      } catch (error) {
        expect((error as Response).status).toBe(302);
      }
      expect(funnelLogLines(loginLines)).toEqual([]);
    });

    it("emits nothing for OAuth signup when disabled", async () => {
      const lines = captureLogs();
      try {
        await runOAuthAction(env(), "signup");
        throw new Error("Expected OAuth redirect");
      } catch (error) {
        expect((error as Response).status).toBe(302);
      }
      expect(funnelLogLines(lines)).toEqual([]);
    });
  });
});
