import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-05-15T00:00:00.000Z",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-05-16T00:00:00.000Z",
  },
};

const discoveryStatus = {
  status: "cache_only",
  provider: "meta_library_browser",
  mode: "cache",
  summary: "Cached live results are available, but fresh discovery is degraded.",
  lastCheckedAt: "2026-05-15T00:00:00.000Z",
  lastErrorCode: "login_wall",
  lastErrorMessage: "Meta returned a login wall.",
} as const;

const betaReadiness = {
  ok: false,
  label: "Beta: needs proof",
  windowDays: 7,
  sampleTarget: 20,
  samples: 6,
  successes: 0,
  failures: 6,
  recentFailures: 6,
  successRate: 0,
  latestSuccessAt: null,
  latestFailureAt: "2026-05-15T00:00:00.000Z",
  blockers: ["not_enough_live_samples", "no_recent_live_success"],
  providerBreakdown: [],
};

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("sources route loader", () => {
  it("returns only safe customer Meta connection fields", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue(discoveryStatus),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getCustomerMetaConnection: vi.fn().mockResolvedValue({
        userId: "user-1",
        encryptedAccessToken: "v1:secret",
        tokenLastFour: "1234",
        tokenFingerprint: "fingerprint",
        status: "healthy",
        summary: "Connected.",
        lastCheckedAt: "2026-05-15T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
      }),
      listCustomerApiKeys: vi.fn().mockResolvedValue([
        {
          id: "api-key-1",
          userId: "user-1",
          name: "Claude workflow",
          keyPrefix: ["f9", "live", "abcd1234"].join("_"),
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
      ]),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue(betaReadiness),
    }));

    const { loader } = await import("~/routes/app.sources");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/sources"),
    } as never);

    expect(JSON.stringify(result)).not.toContain("v1:secret");
    expect(result).toMatchObject({
      connection: {
        status: "healthy",
        tokenLastFour: "1234",
      },
      discoveryStatus,
      betaReadiness,
      apiKeys: [
        {
          id: "api-key-1",
          name: "Claude workflow",
          keyPrefix: ["f9", "live", "abcd1234"].join("_"),
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("sources route action", () => {
  it("tests and saves a customer Meta token", async () => {
    const saveCustomerMetaToken = vi.fn().mockResolvedValue({
      ok: true,
      testResult: {
        summary: "Connected.",
      },
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ BETTER_AUTH_SECRET: "secret" })),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken,
    }));

    const { action } = await import("~/routes/app.sources");
    const formData = new FormData();
    formData.set("intent", "connect-meta-token");
    formData.set("metaToken", "EAABabcdefghijklmnopqrstuvwxyz");

    const result = await action({
      context: createContext({ BETTER_AUTH_SECRET: "secret" }),
      request: new Request("http://localhost/app/sources", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(saveCustomerMetaToken).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "EAABabcdefghijklmnopqrstuvwxyz",
    );
    expect(result).toEqual({
      ok: true,
      message: "Connected.",
    });
  });

  it("creates a customer API key and returns the one-time secret", async () => {
    const createCustomerApiKey = vi.fn().mockResolvedValue({
      secret: ["f9", "live", "full_secret"].join("_"),
      apiKey: {
        keyPrefix: ["f9", "live", "full"].join("_"),
      },
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken: vi.fn(),
    }));
    vi.doMock("~/lib/api-keys.server", () => ({
      createCustomerApiKey,
    }));

    const { action } = await import("~/routes/app.sources");
    const formData = new FormData();
    formData.set("intent", "create-api-key");
    formData.set("apiKeyName", "Claude workflow");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/sources", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(createCustomerApiKey).toHaveBeenCalledWith(expect.anything(), "user-1", "Claude workflow");
    expect(result).toMatchObject({
      ok: true,
      apiKeySecret: ["f9", "live", "full_secret"].join("_"),
      apiKeyPrefix: ["f9", "live", "full"].join("_"),
    });
  });

  it("revokes a customer API key", async () => {
    const revokeCustomerApiKey = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      revokeCustomerApiKey,
    }));

    const { action } = await import("~/routes/app.sources");
    const formData = new FormData();
    formData.set("intent", "revoke-api-key");
    formData.set("apiKeyId", "api-key-1");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/sources", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(revokeCustomerApiKey).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      apiKeyId: "api-key-1",
    });
    expect(result).toEqual({
      ok: true,
      message: "API key revoked.",
    });
  });
});

describe("sources route component", () => {
  it("renders tracking reliability setup with customer-facing copy", async () => {
    await mockRouter({
      connection: null,
      discoveryStatus,
      betaReadiness,
      apiKeys: [],
    });

    const { default: AppSourcesRoute } = await import("~/routes/app.sources");
    const markup = renderToStaticMarkup(createElement(AppSourcesRoute));

    expect(markup).toContain("Keep competitor tracking reliable");
    expect(markup).toContain("Tracking reliability");
    expect(markup).not.toContain("Meta coverage is beta");
    expect(markup).not.toContain("f9-beta-pill");
    expect(markup).toContain("Test and save access");
    expect(markup).toContain("Ad Library API page");
    expect(markup).toContain("Recent tracking health");
    expect(markup).toContain("Customer API");
    expect(markup).toContain("Create API key");
    expect(markup).toContain("/api/v1/watchlists/");
    expect(markup).toContain("MCP yet");
    expect(markup).toContain("needs proof");
    expect(markup).toContain("recent results are available");
    expect(markup).not.toContain("Cached live results");
  });
});
