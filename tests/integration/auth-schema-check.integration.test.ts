import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";
const INTROSPECTION = /pragma_table_info|sqlite_master/i;

// 0509#5721: better-auth re-reads sqlite_master and pragma_table_info once per
// auth instance unless advanced.database.validateSchema is false. createAuth
// builds an instance per request, so the check was costing ~6.5M D1 rows a
// day (issue evidence). The schema itself is pinned by migrations/ and
// schema.integration.test.ts; the runtime check stays off in production.
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
    const introspected = () =>
      prepare.mock.calls.map(([query]) => String(query)).filter((query) => INTROSPECTION.test(query));
    // checkSchema also fires detached at init, so settle after each arm: two
    // consecutive polls with no growth.
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
      // Control arm: the same createAuth with the check explicitly on. Its
      // burst proves the spy intercepts the introspection path, so a zero
      // delta below is a real zero rather than a detection failure. The arm
      // also keeps the removed runtime check's job alive in CI at zero
      // production cost: better-auth's router awaits the check in onRequest
      // before any endpoint logic (better-auth/dist/api/index.mjs:168), so a
      // drift between migrations/ and the plugins' expected schema throws
      // SchemaMismatchError out of auth.handler here.
      const checking = createAuth(AUTH_ENV, { captcha: false, validateSchema: true });
      const checked = await checking.handler(getSession());
      expect(checked.status).toBe(200);
      await settle();
      const baseline = introspected().length;
      expect(baseline).toBeGreaterThan(0);

      // Both production shapes: the options-less call used by the session
      // read paths, and the captcha toggle used after Access preclearance.
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
