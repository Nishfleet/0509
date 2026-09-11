import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";

const db = {} as D1Database;

// Mirrors real data: exactly one account (owner@example.com) has a registered
// passkey; every other address has none. `bind()` receives the normalized
// email, so the mock can answer the passkey-presence query per address.
function discriminatingDb() {
  const prepare = vi.fn(() => ({
    bind: vi.fn((email: string) => ({
      first: vi.fn(async () =>
        email === "owner@example.com" ? { id: "passkey-1" } : null,
      ),
    })),
  }));
  return { prepare } as unknown as D1Database;
}

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    APP_ORIGIN: "https://0509.io",
    AUTH_PROVIDER: "better-auth",
    BETTER_AUTH_SECRET: "secret-test",
    BETTER_AUTH_URL: "https://0509.io",
    DB: db,
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) },
    EMAIL_FROM_EMAIL: "alerts@0509.io",
    ...overrides,
  };
}

function context(testEnv: AppEnv) {
  return {
    cloudflare: {
      country: null,
      ctx: {} as ExecutionContext,
      env: testEnv,
    },
  };
}

function loaderArgs(testEnv: AppEnv, url: string) {
  return {
    context: context(testEnv),
    params: {},
    pattern: "/auth/login",
    request: new Request(url),
    url,
  } as never;
}

describe("login loader passkey-presence oracle (issue 0509#2438)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
  });

  afterEach(() => {
    vi.doUnmock("~/lib/auth.server");
  });

  it("returns identical loader data for a passkey-account email and a never-registered email", async () => {
    // The D1 mock answers the passkey-presence query affirmatively ONLY for
    // the known account, mirroring real data. The two loaders may therefore
    // differ ONLY via the unauthenticated passkey-presence lookup on the
    // email from the URL — which is the leak this test pins (0509#2438).
    const testEnv = env({ DB: discriminatingDb() });
    const { loader } = await import("~/routes/auth.login");

    const passkeyAccount = await loader(
      loaderArgs(testEnv, "https://0509.io/auth/login?email=owner%40example.com"),
    );
    const neverRegistered = await loader(
      loaderArgs(testEnv, "https://0509.io/auth/login?email=nobody%40nowhere.example"),
    );

    // prefillEmail is echoed back to the form by design; assert it IS that
    // echo, then strip it — it must be the ONLY difference between the two
    // responses.
    expect(passkeyAccount.prefillEmail).toBe("owner@example.com");
    expect(neverRegistered.prefillEmail).toBe("nobody@nowhere.example");
    const toComparable = (data: Record<string, unknown>) => {
      const { prefillEmail: _echo, ...rest } = data;
      return rest;
    };
    expect(toComparable(passkeyAccount)).toEqual(toComparable(neverRegistered));
  });

  it("offers passkey sign-in to every visitor regardless of the ?email= value", async () => {
    const testEnv = env({ DB: discriminatingDb() });
    const { loader } = await import("~/routes/auth.login");

    for (const url of [
      "https://0509.io/auth/login",
      "https://0509.io/auth/login?email=owner%40example.com",
      "https://0509.io/auth/login?email=nobody%40nowhere.example",
    ]) {
      await expect(loader(loaderArgs(testEnv, url))).resolves.toMatchObject({
        passkeysEnabled: true,
      });
    }
  });
});
