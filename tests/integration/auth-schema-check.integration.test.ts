import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";
const INTROSPECTION = /pragma_table_info|sqlite_master/i;

// 0509#5721: better-auth re-reads sqlite_master and pragma_table_info once per
// auth instance unless advanced.database.validateSchema is false (38 queries
// measured on the migrated local D1). createAuth builds an instance per
// request, so the check was costing ~6.5M D1 rows a day. The schema itself is
// pinned by migrations/ and schema.integration.test.ts; the runtime check
// stays off in production.
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
  it("issues no schema introspection queries when building the auth instance", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");
    const introspected = () =>
      prepare.mock.calls.map(([query]) => String(query)).filter((query) => INTROSPECTION.test(query));
    try {
      // Control arm: the same createAuth with the check explicitly on. Its
      // burst proves the spy intercepts the introspection path, so a zero
      // below is a real zero rather than a detection failure. Its 200 also
      // keeps the removed runtime check's job alive in CI at zero production
      // cost: runWithTransaction awaits the schema check on every adapter
      // call, so a drift between migrations/ and the plugins' expected schema
      // fails this request instead of passing silently.
      const checking = createAuth(AUTH_ENV, { captcha: false, validateSchema: true });
      const checked = await checking.handler(getSession());
      expect(checked.status).toBe(200);
      await vi.waitFor(() => expect(introspected().length).toBeGreaterThan(0), {
        timeout: 5_000,
        interval: 50,
      });
      const baseline = introspected().length;

      const auth = createAuth(AUTH_ENV, { captcha: false });
      const response = await auth.handler(getSession());
      expect(response.status).toBe(200);

      // checkSchema runs detached, so give any stray emission room to land:
      // settle only after two consecutive polls see no growth.
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
      expect(introspected().length).toBe(baseline);
    } finally {
      prepare.mockRestore();
    }
  });
});
