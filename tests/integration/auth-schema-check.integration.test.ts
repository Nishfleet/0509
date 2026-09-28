import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";

// 0509#5721: better-auth re-reads sqlite_master and pragma_table_info once per
// auth instance unless advanced.database.validateSchema is false. createAuth
// builds an instance per request, so the schema was costing ~6.5M D1 rows a
// day. Migrations and this suite already prove the schema; the runtime check
// stays off.
describe("auth schema validation", () => {
  it("issues no schema introspection queries when building the auth instance", async () => {
    const introspected: string[] = [];
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (query: string) => {
            if (/pragma_table_info|sqlite_master/i.test(query)) introspected.push(query);
            return target.prepare(query);
          };
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const auth = createAuth(
      {
        DB: db,
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

    // The check rides on better-auth's async context init: one real request
    // forces it to resolve, then a macrotask lets the introspection finish.
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/get-session`, { headers: { origin: ORIGIN } }),
    );
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(introspected).toEqual([]);
  });
});
