import { describe, expect, it, vi } from "vitest";

import {
  E2E_TEST_MODE_HEADER,
  E2E_TEST_SESSION_COOKIE,
  getE2ETestSession,
  isE2ETestAuthEnabled,
  readE2ETestFixtureUserId,
} from "~/lib/e2e-auth.server";

function env() {
  return {
    E2E_TEST_MODE: "1",
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({
            id: "e2e-starter",
            email: "e2e-starter@example.invalid",
            image: null,
            name: "E2E Starter",
            onboardedAt: "2026-06-01T00:00:00.000Z",
          })),
        })),
      })),
    },
  };
}

describe("E2E test auth resolver", () => {
  it("enables only in explicit test mode on localhost", () => {
    expect(isE2ETestAuthEnabled(env() as never, new Request("http://127.0.0.1:4179/app"))).toBe(true);
    expect(isE2ETestAuthEnabled(env() as never, new Request("http://localhost:4179/app"))).toBe(true);
    expect(isE2ETestAuthEnabled(env() as never, new Request("http://[::1]:4179/app"))).toBe(true);
    expect(isE2ETestAuthEnabled(env() as never, new Request("https://0509.io/app"))).toBe(false);
    expect(isE2ETestAuthEnabled({ ...env(), E2E_TEST_MODE: "0" } as never, new Request("http://127.0.0.1:4179/app"))).toBe(false);
    expect(
      isE2ETestAuthEnabled(
        { ...env(), E2E_TEST_MODE: "0" } as never,
        new Request("http://127.0.0.1:4179/app", {
          headers: { [E2E_TEST_MODE_HEADER]: "1" },
        }),
      ),
    ).toBe(true);
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
        headers: { cookie: `${E2E_TEST_SESSION_COOKIE}=e2e-starter` },
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
