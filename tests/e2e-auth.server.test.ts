import { describe, expect, it, vi } from "vitest";

import {
  E2E_TEST_MODE_HEADER,
  E2E_TEST_SESSION_COOKIE,
  getE2ETestSession,
  isE2ETestAuthEnabled,
  readE2ETestFixtureUserId,
  shouldClearE2ETestSessionCookie,
} from "~/lib/e2e-auth.server";

function env({ databaseSentinel = false, testMode = "1" } = {}) {
  return {
    E2E_TEST_MODE: testMode,
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (sql.includes("e2e_test_mode")) {
              return databaseSentinel ? { enabled: 1 } : null;
            }

            return {
              id: "e2e-starter",
              email: "e2e-starter@example.invalid",
              image: null,
              name: "E2E Starter",
              onboardedAt: "2026-06-01T00:00:00.000Z",
            };
          }),
        })),
      })),
    },
  };
}

describe("E2E test auth resolver", () => {
  it("enables only in explicit test mode on localhost", () => {
    const localHeaders = { [E2E_TEST_MODE_HEADER]: "1" };
    expect(isE2ETestAuthEnabled(env() as never, new Request("http://127.0.0.1:4179/app", { headers: localHeaders }))).toBe(true);
    expect(isE2ETestAuthEnabled(env() as never, new Request("http://localhost:4179/app", { headers: localHeaders }))).toBe(true);
    expect(isE2ETestAuthEnabled(env() as never, new Request("http://[::1]:4179/app", { headers: localHeaders }))).toBe(true);
    expect(isE2ETestAuthEnabled(env() as never, new Request("https://0509.io/app", { headers: localHeaders }))).toBe(false);
    expect(isE2ETestAuthEnabled(env() as never, new Request("http://127.0.0.1:4179/app"))).toBe(false);
    expect(
      isE2ETestAuthEnabled(
        { ...env(), E2E_TEST_MODE: "0" } as never,
        new Request("http://127.0.0.1:4179/app", {
          headers: { [E2E_TEST_MODE_HEADER]: "1" },
        }),
      ),
    ).toBe(false);
  });

  it("requires a server-side flag or local fixture database sentinel before resolving a fixture session", async () => {
    const request = new Request("http://127.0.0.1:4179/app", {
      headers: {
        cookie: `${E2E_TEST_SESSION_COOKIE}=e2e-starter`,
        [E2E_TEST_MODE_HEADER]: "1",
      },
    });

    await expect(getE2ETestSession(env({ testMode: "0" }) as never, request)).resolves.toBeNull();
    await expect(
      getE2ETestSession(env({ databaseSentinel: true, testMode: "0" }) as never, request),
    ).resolves.toMatchObject({
      user: { id: "e2e-starter" },
      session: { id: "e2e-session-e2e-starter" },
    });
  });

  it("clears fixture cookies for local logout in env-flag or database-sentinel mode only", async () => {
    const request = new Request("http://127.0.0.1:4179/auth/logout", {
      headers: { cookie: `${E2E_TEST_SESSION_COOKIE}=e2e-starter` },
      method: "POST",
    });

    await expect(shouldClearE2ETestSessionCookie(env({ testMode: "1" }) as never, request)).resolves.toBe(true);
    await expect(
      shouldClearE2ETestSessionCookie(env({ databaseSentinel: true, testMode: "0" }) as never, request),
    ).resolves.toBe(true);
    await expect(shouldClearE2ETestSessionCookie(env({ testMode: "0" }) as never, request)).resolves.toBe(false);
    await expect(
      shouldClearE2ETestSessionCookie(
        env() as never,
        new Request("http://127.0.0.1:4179/auth/logout", { method: "POST" }),
      ),
    ).resolves.toBe(false);
    await expect(
      shouldClearE2ETestSessionCookie(
        env() as never,
        new Request("https://0509.io/auth/logout", {
          headers: { cookie: `${E2E_TEST_SESSION_COOKIE}=e2e-starter` },
          method: "POST",
        }),
      ),
    ).resolves.toBe(false);
  });

  it("accepts only deterministic e2e fixture user ids", () => {
    expect(
      readE2ETestFixtureUserId(
        new Request("http://127.0.0.1:4179/app", {
          headers: { cookie: `${E2E_TEST_SESSION_COOKIE}=e2e-starter` },
        }),
      ),
    ).toBe("e2e-starter");
    expect(
      readE2ETestFixtureUserId(
        new Request("http://127.0.0.1:4179/app", {
          headers: { cookie: `${E2E_TEST_SESSION_COOKIE}=customer-123` },
        }),
      ),
    ).toBeNull();
    expect(
      readE2ETestFixtureUserId(
        new Request("http://127.0.0.1:4179/app", {
          headers: { cookie: `${E2E_TEST_SESSION_COOKIE}=%` },
        }),
      ),
    ).toBeNull();
  });

  it("maps a local fixture user to the app session shape without exposing Better Auth cookies", async () => {
    const session = await getE2ETestSession(
      env() as never,
      new Request("http://127.0.0.1:4179/app", {
        headers: {
          cookie: `${E2E_TEST_SESSION_COOKIE}=e2e-starter`,
          [E2E_TEST_MODE_HEADER]: "1",
        },
      }),
    );

    expect(session?.user.id).toBe("e2e-starter");
    expect(session?.session.id).toBe("e2e-session-e2e-starter");
  });

  it("fails closed on production hosts even when the cookie and flag are present", async () => {
    await expect(
      getE2ETestSession(
        env() as never,
        new Request("https://0509.io/app", {
          headers: {
            cookie: `${E2E_TEST_SESSION_COOKIE}=e2e-starter`,
            [E2E_TEST_MODE_HEADER]: "1",
          },
        }),
      ),
    ).resolves.toBeNull();
  });
});
