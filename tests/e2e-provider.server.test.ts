import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  createE2EProviderDenyFetcher,
  E2EProviderNetworkDeniedError,
  resolveE2EProviderDeny,
  resolveE2EFixtureProvider,
  resolveE2EFixtureProviderFromEnv,
  sanitizeE2EProviderEnv,
} from "~/lib/e2e-provider.server";

function databaseWith(row: { enabled: number | string | null } | null) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(row) })),
    })),
  } as unknown as D1Database;
}

function failingDatabase() {
  return {
    prepare: vi.fn(() => {
      throw new Error("database unavailable");
    }),
  } as unknown as D1Database;
}

function localRequest(url = "http://127.0.0.1:4179/search", header = true) {
  return new Request(url, {
    headers: header ? { "x-0509-e2e-test-mode": "1" } : undefined,
  });
}

function enabledEnv(db: D1Database): AppEnv {
  return { DB: db, E2E_PROVIDER_NETWORK_DENY: "1" } as AppEnv;
}

describe("E2E provider network deny decision", () => {
  it("never trusts the internal fixture marker without the deny flag", () => {
    expect(resolveE2EFixtureProviderFromEnv({ E2E_FIXTURE_PROVIDER: "meta_library_browser" } as never)).toBeNull();
    expect(resolveE2EFixtureProviderFromEnv({
      E2E_FIXTURE_PROVIDER: "meta_library_browser",
      E2E_PROVIDER_NETWORK_DENY: "1",
    } as never)).toBe("meta_library_browser");
  });

  it("exposes only the seeded Meta-library label after the deny decision is verified", () => {
    expect(resolveE2EFixtureProvider({ enabled: true, failClosed: true, reason: "enabled" })).toBe(
      "meta_library_browser",
    );
    expect(resolveE2EFixtureProvider({ enabled: false, failClosed: true, reason: "missing_sentinel" })).toBeNull();
    expect(resolveE2EFixtureProvider({ enabled: true, failClosed: false, reason: "enabled" })).toBeNull();
  });

  it("enables only for exact HTTP localhost, the E2E header, the deny flag, and the DB sentinel", async () => {
    const db = databaseWith({ enabled: 1 });

    await expect(resolveE2EProviderDeny(enabledEnv(db), localRequest())).resolves.toEqual({
      enabled: true,
      failClosed: true,
      reason: "enabled",
    });
  });

  it.each([
    ["production host", "https://0509.io/search", true, enabledEnv(databaseWith({ enabled: 1 })), "non_local_http_request"],
    ["HTTPS localhost", "https://127.0.0.1:4179/search", true, enabledEnv(databaseWith({ enabled: 1 })), "non_local_http_request"],
    ["localhost suffix", "http://127.0.0.1.example/search", true, enabledEnv(databaseWith({ enabled: 1 })), "non_local_http_request"],
    ["missing header", "http://127.0.0.1:4179/search", false, enabledEnv(databaseWith({ enabled: 1 })), "missing_request_header"],
    ["missing deny flag", "http://127.0.0.1:4179/search", true, { DB: databaseWith({ enabled: 1 }) } as AppEnv, "missing_deny_flag"],
  ] as const)("rejects %s before provider use", async (_label, url, header, env, reason) => {
    await expect(resolveE2EProviderDeny(env, localRequest(url, header))).resolves.toMatchObject({
      enabled: false,
      failClosed: false,
      reason,
    });
  });

  it.each([
    ["missing database", { E2E_PROVIDER_NETWORK_DENY: "1" } as AppEnv, "missing_database"],
    ["missing sentinel", enabledEnv(databaseWith(null)), "missing_sentinel"],
    ["disabled sentinel", enabledEnv(databaseWith({ enabled: 0 })), "disabled_sentinel"],
    ["database error", enabledEnv(failingDatabase()), "database_error"],
  ] as const)("fails closed on %s", async (_label, env, reason) => {
    await expect(resolveE2EProviderDeny(env, localRequest())).resolves.toEqual({
      enabled: false,
      failClosed: true,
      reason,
    });
  });
});

describe("sanitizeE2EProviderEnv", () => {
  it("returns a new environment without provider bindings, secrets, or side-effect controls", () => {
    const db = databaseWith({ enabled: 1 });
    const original = {
      APP_ORIGIN: "http://127.0.0.1:4179",
      DB: db,
      E2E_TEST_MODE: "1",
      SEARCH_ROLLOUT_MODE: "v2",
      BETTER_AUTH_GOOGLE_CLIENT_SECRET: "oauth-secret",
      AI: {} as Ai,
      BROWSER: {} as never,
      BROWSERLESS_TOKEN: "browserless-secret",
      BROWSER_RUN_API_TOKEN: "browser-run-secret",
      DODO_0509_API_KEY: "dodo-secret",
      EMAIL: {} as never,
      EMAIL_FROM_EMAIL: "ops@example.com",
      LANDING_PAGE_ARTIFACTS: {} as never,
      META_AD_LIBRARY_TOKEN: "meta-secret",
      MONITORING_WORKFLOW: {} as never,
      PRESENCE_OAUTH_STATE_SECRET: "presence-secret",
      WHATSAPP_ACCESS_TOKEN: "whatsapp-secret",
    } as AppEnv;

    const sanitized = sanitizeE2EProviderEnv(original);

    expect(sanitized).not.toBe(original);
    expect(sanitized).toMatchObject({
      APP_ORIGIN: original.APP_ORIGIN,
      DB: original.DB,
      E2E_PROVIDER_NETWORK_DENY: "1",
      E2E_TEST_MODE: original.E2E_TEST_MODE,
      SEARCH_ROLLOUT_MODE: original.SEARCH_ROLLOUT_MODE,
    });
    for (const key of [
      "AI",
      "BETTER_AUTH_GOOGLE_CLIENT_SECRET",
      "BROWSER",
      "BROWSERLESS_TOKEN",
      "BROWSER_RUN_API_TOKEN",
      "DODO_0509_API_KEY",
      "EMAIL",
      "EMAIL_FROM_EMAIL",
      "LANDING_PAGE_ARTIFACTS",
      "META_AD_LIBRARY_TOKEN",
      "PRESENCE_OAUTH_STATE_SECRET",
      "WHATSAPP_ACCESS_TOKEN",
    ]) {
      expect(sanitized[key as keyof AppEnv]).toBeUndefined();
    }
    expect(sanitized.MONITORING_WORKFLOW).toBe(original.MONITORING_WORKFLOW);
    expect(original.BROWSERLESS_TOKEN).toBe("browserless-secret");
  });
});

describe("createE2EProviderDenyFetcher", () => {
  it("rejects external HTTP(S) before invoking the delegate", async () => {
    const delegate = vi.fn<typeof fetch>();
    const fetcher = createE2EProviderDenyFetcher(localRequest(), delegate);

    await expect(fetcher("https://graph.facebook.com/v23.0/me")).rejects.toBeInstanceOf(
      E2EProviderNetworkDeniedError,
    );
    expect(delegate).not.toHaveBeenCalled();
  });

  it("allows local HTTP(S) and relative requests through the supplied delegate", async () => {
    const delegate = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    const fetcher = createE2EProviderDenyFetcher(localRequest(), delegate);

    await expect(fetcher("http://localhost:4179/health")).resolves.toBeInstanceOf(Response);
    await expect(fetcher("/api/local")).resolves.toBeInstanceOf(Response);
    expect(delegate).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed targets without invoking the delegate", async () => {
    const delegate = vi.fn<typeof fetch>();
    const fetcher = createE2EProviderDenyFetcher(localRequest(), delegate);

    await expect(fetcher("http://[invalid")).rejects.toBeInstanceOf(E2EProviderNetworkDeniedError);
    expect(delegate).not.toHaveBeenCalled();
  });
});
