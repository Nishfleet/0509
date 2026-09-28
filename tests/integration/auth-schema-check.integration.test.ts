import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";
const INTROSPECTION = /pragma_table_info|sqlite_master|pragma_index_(list|info)/i;

// 0509#5721: better-auth re-reads sqlite_master and pragma_table_info once per
// auth instance unless advanced.database.validateSchema is false. createAuth
// builds an instance per request, so the schema was costing ~6.5M D1 rows a
// day. The schema itself is pinned by migrations/ and
// schema.integration.test.ts; the runtime check stays off.
describe("auth schema validation", () => {
  it("issues no schema introspection queries when building the auth instance", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");

    const auth = createAuth(
      {
        DB: env.DB,
        EMAIL: {
          send: async () => ({ messageId: "test" }),
        },
        SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
        SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
        BETTER_AUTH_URL: ORIGIN,
      },
      { captcha: false },
    );

    // base.mjs runs ctx.checkSchema() detached — scheduled on a microtask
    // ahead of the handler continuation, never awaited — so the introspection
    // burst lands around and after the response. Poll until the count stops
    // growing: on the fix it stays zero, on the old code it converges to ~38.
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/get-session`, { headers: { origin: ORIGIN } }),
    );
    expect(response.status).toBe(200);

    const introspected = () =>
      prepare.mock.calls.map(([query]) => String(query)).filter((query) => INTROSPECTION.test(query));
    let previous = -1;
    await vi.waitFor(
      () => {
        if (introspected().length === previous) return;
        previous = introspected().length;
        throw new Error("schema introspection still in flight");
      },
      { timeout: 5_000, interval: 50 },
    );
    const found = introspected();
    prepare.mockRestore();

    expect(found).toEqual([]);
  });
});
