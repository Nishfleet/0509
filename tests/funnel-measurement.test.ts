import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FUNNEL_EVENT_NAMES,
  FUNNEL_ERROR_KINDS,
  FUNNEL_RESULT_COUNT_BUCKETS,
  FUNNEL_ROUTES,
  emitFunnelHomeView,
  emitFunnelSearchPreviewError,
  emitFunnelSearchPreviewResult,
  emitFunnelSearchPreviewSubmit,
  emitFunnelSignupStart,
  funnelResultCountBucket,
  hasGpcOptOut,
} from "~/lib/funnel-measurement.server";

const FORBIDDEN_DETAIL_KEYS = [
  "visitor_id",
  "session_id",
  "requestId",
  "request_id",
  "userId",
  "user_id",
  "email",
  "query",
  "queryText",
  "url",
  "referrer",
  "ip",
  "country",
  "cookie",
  "ua",
  "userAgent",
  "authorization",
  "token",
  "password",
  "name",
];

type TestFunnelEnv = { FUNNEL_MEASUREMENT_ENABLED?: string };

function enabledEnv(): TestFunnelEnv {
  return { FUNNEL_MEASUREMENT_ENABLED: "1" };
}

function emptyEnv(): TestFunnelEnv {
  return {};
}

function collectLogLines() {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line) => {
    lines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return lines;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("funnel measurement gate", () => {
  it("is disabled by default and cannot be enabled by an absent variable", () => {
    for (const env of [{}, { FUNNEL_MEASUREMENT_ENABLED: undefined }, { FUNNEL_MEASUREMENT_ENABLED: "" }]) {
      const lines = collectLogLines();
      expect(emitFunnelHomeView(env, new Request("http://localhost/"))).toBe(false);
      expect(lines).toHaveLength(0);
    }
  });

  it("treats explicit truthy values as enabled and anything else as disabled", () => {
    for (const value of ["0", "false", "no", "off", "2", "enabled"]) {
      const lines = collectLogLines();
      expect(emitFunnelHomeView({ FUNNEL_MEASUREMENT_ENABLED: value }, new Request("http://localhost/"))).toBe(false);
      expect(lines).toHaveLength(0);
      vi.restoreAllMocks();
    }
    for (const value of ["1", "true", "yes", "on"]) {
      const lines = collectLogLines();
      expect(emitFunnelHomeView({ FUNNEL_MEASUREMENT_ENABLED: value }, new Request("http://localhost/"))).toBe(true);
      expect(lines).toHaveLength(1);
      vi.restoreAllMocks();
    }
  });
});

describe("GPC and DNT handling", () => {
  it("suppresses all events when the request carries a GPC signal", () => {
    for (const header of ["sec-gpc", "gpc"]) {
      const lines = collectLogLines();
      const request = new Request("http://localhost/", { headers: { [header]: "1" } });
      expect(hasGpcOptOut(request)).toBe(true);
      expect(emitFunnelHomeView(enabledEnv(), request)).toBe(false);
      expect(emitFunnelSearchPreviewSubmit(enabledEnv(), request)).toBe(false);
      expect(emitFunnelSignupStart(enabledEnv(), request)).toBe(false);
      expect(lines).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it("does not treat a GPC value other than 1 as an opt-out", () => {
    const lines = collectLogLines();
    const request = new Request("http://localhost/", { headers: { "sec-gpc": "0" } });
    expect(hasGpcOptOut(request)).toBe(false);
    expect(emitFunnelHomeView(enabledEnv(), request)).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it("never treats DNT as an opt-out (spec §5: not authoritative)", () => {
    const lines = collectLogLines();
    const request = new Request("http://localhost/", { headers: { dnt: "1" } });
    expect(emitFunnelHomeView(enabledEnv(), request)).toBe(true);
    expect(lines).toHaveLength(1);
  });
});

describe("result count buckets", () => {
  it("buckets counts into the fixed coarse ranges", () => {
    expect(funnelResultCountBucket(0)).toBe("0");
    expect(funnelResultCountBucket(1)).toBe("1-10");
    expect(funnelResultCountBucket(10)).toBe("1-10");
    expect(funnelResultCountBucket(11)).toBe("11-50");
    expect(funnelResultCountBucket(50)).toBe("11-50");
    expect(funnelResultCountBucket(51)).toBe("51+");
    expect(funnelResultCountBucket(5_000)).toBe("51+");
  });

  it("refuses malformed counts and never emits", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, "5", null, undefined]) {
      expect(funnelResultCountBucket(bad)).toBeNull();
      const lines = collectLogLines();
      expect(emitFunnelSearchPreviewResult(enabledEnv(), new Request("http://localhost/"), bad)).toBe(false);
      expect(lines).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });
});

describe("field allowlist", () => {
  it("rejects event inputs outside the fixed allowlists without emitting", () => {
    const lines = collectLogLines();
    expect(emitFunnelSearchPreviewError(enabledEnv(), new Request("http://localhost/"), "server_on_fire")).toBe(false);
    expect(emitFunnelSearchPreviewError(enabledEnv(), new Request("http://localhost/"), { nested: true })).toBe(false);
    expect(lines).toHaveLength(0);
  });

  it("accepts only allowlisted error kinds and routes", () => {
    for (const kind of FUNNEL_ERROR_KINDS) {
      const lines = collectLogLines();
      expect(emitFunnelSearchPreviewError(enabledEnv(), new Request("http://localhost/"), kind)).toBe(true);
      expect(lines).toHaveLength(1);
      vi.restoreAllMocks();
    }
    expect(FUNNEL_ROUTES).toEqual(["home", "search_preview", "signup", "activation"]);
    expect(FUNNEL_RESULT_COUNT_BUCKETS).toEqual(["0", "1-10", "11-50", "51+"]);
    expect(FUNNEL_EVENT_NAMES).toEqual([
      "funnel_home_view",
      "funnel_search_preview_submit",
      "funnel_search_preview_result",
      "funnel_search_preview_error",
      "funnel_signup_start",
    ]);
  });

  it("emits records carrying only allowlisted fields and server-side values", () => {
    const lines = collectLogLines();
    const request = new Request("http://localhost/search?query=secret-competitor&website=https%3A%2F%2Fsecret.example.com", {
      headers: { "cf-ray": "ray-123", "x-request-id": "req-123", "cf-connecting-ip": "203.0.113.7" },
    });
    expect(emitFunnelHomeView(enabledEnv(), request)).toBe(true);
    expect(emitFunnelSearchPreviewSubmit(enabledEnv(), request)).toBe(true);
    expect(emitFunnelSearchPreviewResult(enabledEnv(), request, 7)).toBe(true);
    expect(emitFunnelSearchPreviewError(enabledEnv(), request, "timeout")).toBe(true);
    expect(emitFunnelSignupStart(enabledEnv(), request)).toBe(true);

    expect(lines).toHaveLength(5);
    for (const [index, line] of lines.entries()) {
      const record = JSON.parse(line) as {
        operation: string;
        message: string;
        timestamp: string;
        requestId?: string | null;
        details: Record<string, unknown>;
      };
      expect(FUNNEL_EVENT_NAMES).toContain(record.operation);
      expect(record.operation.startsWith("funnel_")).toBe(true);
      expect(typeof record.timestamp).toBe("string");
      expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(record.requestId ?? null).toBeNull();
      expect(Object.keys(record.details).sort()).toEqual(
        index === 2
          ? ["account_scope", "event_id", "result_count_bucket", "route"]
          : index === 3
            ? ["account_scope", "error_kind", "event_id", "route"]
            : ["account_scope", "event_id", "route"],
      );
      expect(record.details.route).toBe(
        record.operation === "funnel_home_view" || record.operation === "funnel_signup_start"
          ? record.operation === "funnel_home_view"
            ? "home"
            : "signup"
          : "search_preview",
      );
      expect(String(record.details.event_id)).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.details.account_scope).toBe("anonymous");
      if (record.operation === "funnel_search_preview_result") {
        expect(FUNNEL_RESULT_COUNT_BUCKETS).toContain(record.details.result_count_bucket);
      }
      if (record.operation === "funnel_search_preview_error") {
        expect(FUNNEL_ERROR_KINDS).toContain(record.details.error_kind);
      }
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("secret-competitor");
      expect(serialized).not.toContain("secret.example.com");
      expect(serialized).not.toContain("ray-123");
      expect(serialized).not.toContain("req-123");
      expect(serialized).not.toContain("203.0.113.7");
      for (const key of FORBIDDEN_DETAIL_KEYS) {
        expect(Object.keys(record.details)).not.toContain(key);
      }
    }
  });
});

describe("homepage route boundary", () => {
  function createContext(env = {}) {
    return { cloudflare: { env } };
  }

  it(
    "emits funnel_home_view only when collection is enabled, without changing the loader response",
    async () => {
      for (const env of [emptyEnv(), enabledEnv()]) {
        vi.resetModules();
        vi.doMock("~/lib/context.server", () => ({
          getEnv: vi.fn(() => env),
        }));
        const lines = collectLogLines();
        const { loader } = await import("~/routes/marketing");
        const result = await loader({
          context: createContext(env),
          request: new Request("http://localhost/"),
        } as never);

        expect(result).toMatchObject({ pricingPreview: { available: false } });
        expect(typeof (result as { commercialLaunch: unknown }).commercialLaunch).toBe("object");
        expect(lines.filter((line) => line.includes("funnel_home_view")).length).toBe(
          env.FUNNEL_MEASUREMENT_ENABLED ? 1 : 0,
        );
        vi.restoreAllMocks();
      }
    },
    // The marketing route module carries a large static import graph; its
    // first import in a worker can exceed the default 10s under load.
    30_000,
  );
});

describe("signup route boundary", () => {
  function createContext(env = {}) {
    return { cloudflare: { env } };
  }

  function signupRequest() {
    const formData = new FormData();
    formData.set("email", "visitor@example.com");
    formData.set("name", "Jane Probe");
    return new Request("http://localhost/auth/signup", { method: "POST", body: formData });
  }

  function mockBetterAuth(env: Record<string, unknown>) {
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn(() => true),
      isSameOriginAuthFormPost: vi.fn(() => true),
      sendBetterAuthMagicLink: vi.fn().mockResolvedValue(undefined),
      isBetterAuthOAuthProvider: vi.fn(() => true),
      isBetterAuthOAuthProviderConfigured: vi.fn(() => true),
      startBetterAuthSocialSignIn: vi.fn().mockResolvedValue({
        url: "https://provider.example/start",
        headers: new Headers(),
      }),
      appendBetterAuthSetCookieHeaders: vi.fn(),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
  }

  it("emits funnel_signup_start after a successful magic-link signup attempt only when enabled", async () => {
    for (const env of [emptyEnv(), enabledEnv()]) {
      vi.resetModules();
      mockBetterAuth(env);
      const lines = collectLogLines();
      const { action } = await import("~/routes/auth.signup");
      await expect(
        action({ context: createContext(env), request: signupRequest() } as never),
      ).rejects.toMatchObject({ status: 302 });
      expect(lines.filter((line) => line.includes("funnel_signup_start")).length).toBe(
        env.FUNNEL_MEASUREMENT_ENABLED ? 1 : 0,
      );
      expect(lines.join("\n")).not.toContain("visitor@example.com");
      expect(lines.join("\n")).not.toContain("Jane Probe");
      vi.restoreAllMocks();
    }
  });

  it("emits funnel_signup_start for OAuth signup mode only, and never for login mode", async () => {
    for (const mode of ["signup", "login"]) {
      vi.resetModules();
      mockBetterAuth(enabledEnv());
      const lines = collectLogLines();
      const formData = new FormData();
      formData.set("mode", mode);
      formData.set("provider", "google");
      const { action } = await import("~/routes/auth.better.oauth");
      await expect(
        action({
          context: createContext(enabledEnv()),
          request: new Request("http://localhost/auth/better/oauth", {
            method: "POST",
            body: formData,
          }),
        } as never),
      ).rejects.toMatchObject({ status: 302 });
      expect(lines.filter((line) => line.includes("funnel_signup_start")).length).toBe(
        mode === "signup" ? 1 : 0,
      );
      vi.restoreAllMocks();
    }
  });

  it("does not emit signup start when the signup request fails validation", async () => {
    vi.resetModules();
    mockBetterAuth(enabledEnv());
    const lines = collectLogLines();
    const formData = new FormData();
    formData.set("email", "not-an-email");
    formData.set("name", "Visitor");
    const { action } = await import("~/routes/auth.signup");
    const result = await action({
      context: createContext(enabledEnv()),
      request: new Request("http://localhost/auth/signup", { method: "POST", body: formData }),
    } as never);
    expect(result).toMatchObject({ ok: false, error: "Enter a valid email address." });
    expect(lines).toHaveLength(0);
  });
});

describe("search route boundary", () => {
  function createContext(env = {}) {
    return { cloudflare: { env } };
  }

  function baseSourceResult(overrides: Record<string, unknown> = {}) {
    return {
      ads: [
        {
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
        },
      ],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
      ...overrides,
    };
  }

  function mockAnonymousSearch(env: Record<string, unknown>, sourceResult: Record<string, unknown>) {
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
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: null,
        selectionEnrichmentPending: false,
      }),
    }));
  }

  it("emits submit and result for an anonymous executed search only when enabled", async () => {
    for (const env of [emptyEnv(), enabledEnv()]) {
      vi.resetModules();
      mockAnonymousSearch(env, baseSourceResult());
      const lines = collectLogLines();
      const { loader } = await import("~/routes/search");
      const result = await loader({
        context: createContext(env),
        request: new Request("http://localhost/search?query=nykaa"),
      } as never);

      expect(result).toMatchObject({ session: null });
      const submitted = lines.filter((line) => line.includes("funnel_search_preview_submit"));
      const resulted = lines.filter((line) => line.includes("funnel_search_preview_result"));
      expect(submitted.length).toBe(env.FUNNEL_MEASUREMENT_ENABLED ? 1 : 0);
      expect(resulted.length).toBe(env.FUNNEL_MEASUREMENT_ENABLED ? 1 : 0);
      if (env.FUNNEL_MEASUREMENT_ENABLED) {
        const record = JSON.parse(resulted[0]!) as { details: Record<string, unknown> };
        expect(record.details.result_count_bucket).toBe("1-10");
      }
      vi.restoreAllMocks();
    }
  });

  it("emits a coarse error instead of a result when the anonymous search fails", async () => {
    vi.resetModules();
    mockAnonymousSearch(
      enabledEnv(),
      baseSourceResult({
        ads: [],
        discoveryStatus: "degraded",
        discoveryFailureClass: "provider_unavailable",
      }),
    );
    const lines = collectLogLines();
    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(enabledEnv()),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never);

    const errors = lines.filter((line) => line.includes("funnel_search_preview_error"));
    const results = lines.filter((line) => line.includes("funnel_search_preview_result"));
    expect(errors).toHaveLength(1);
    expect(results).toHaveLength(0);
    const record = JSON.parse(errors[0]!) as { details: Record<string, unknown> };
    expect(record.details.error_kind).toBe("provider_unavailable");
    expect(JSON.stringify(record)).not.toContain("stack");
  });

  it("does not emit any funnel event when the visitor is signed in", async () => {
    const env = enabledEnv();
    const sourceResult = baseSourceResult({ cacheStatus: "hit" });
    const appSession = {
      user: { id: "user-1", email: "owner@example.com", name: "Owner" },
      session: { id: "session-1", userId: "user-1", expiresAt: "2026-04-03T00:00:00.000Z" },
    };
    vi.resetModules();
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/presence-internal-access.server", () => ({
      presenceNavVisible: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: null,
        selectionEnrichmentPending: false,
      }),
    }));

    const lines = collectLogLines();
    const { loader } = await import("~/routes/search");
    const result = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never);

    expect(result).toMatchObject({ session: appSession });
    expect(lines.filter((line) => line.includes("funnel_"))).toHaveLength(0);
  });

  it("skips submit on selection reruns of an already committed search", async () => {
    vi.resetModules();
    mockAnonymousSearch(enabledEnv(), baseSourceResult({ cacheStatus: "hit" }));
    const lines = collectLogLines();
    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(enabledEnv()),
      request: new Request("http://localhost/search?query=nykaa&selected=meta-boat-1"),
    } as never);

    expect(lines.filter((line) => line.includes("funnel_"))).toHaveLength(0);
  });
});
