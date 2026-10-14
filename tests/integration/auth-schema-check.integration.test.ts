import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";
const INTROSPECTION = /pragma_table_info|sqlite_master/i;

const AUTH_ENV = {
  DB: env.DB,
  EMAIL: {
    send: async () => ({ messageId: "test" }),
  },
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
  BETTER_AUTH_URL: ORIGIN,
} satisfies Parameters<typeof createAuth>[0];

function getSession() {
  return new Request(`${ORIGIN}/api/auth/get-session`, { headers: { origin: ORIGIN } });
}

describe("auth schema validation", () => {
  it("the per-request auth instance adds no schema introspection queries", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");
    const introspected = () => prepare.mock.calls.map(([query]) => query).filter((query) => INTROSPECTION.test(query));

    const settle = async () => {
      let previous = -1;
      await vi.waitFor(
        () => {
          const now = introspected().length;
          if (now !== previous) {
            previous = now;
            throw new Error("schema introspection still in flight");
          }
        },
        { timeout: 5_000, interval: 50 },
      );
    };
    try {
      const checking = createAuth(AUTH_ENV, { captcha: false, validateSchema: true });
      const checked = await checking.handler(getSession());
      expect(checked.status).toBe(200);
      await settle();
      const baseline = introspected().length;
      expect(baseline).toBeGreaterThan(0);

      for (const auth of [createAuth(AUTH_ENV), createAuth(AUTH_ENV, { captcha: false })]) {
        const response = await auth.handler(getSession());
        expect(response.status).toBe(200);
      }
      await settle();
      expect(introspected().length - baseline).toBe(0);
    } finally {
      prepare.mockRestore();
    }
  });
});
