import { env } from "cloudflare:test";
import { betterAuth } from "better-auth";
import { describe, expect, it, vi } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

// 0509#5780: REBUILD-STACK.md §2.3 point 2 names advanced.database.joins: true
// mandatory — the session read is the per-request hot path — and createAuth
// had never set it, so every related-row read paid a second query. This pins
// the SQL shape on real D1 through the same adapter layer better-auth's
// /get-session uses: with joins on, the session+user read is one query with a
// LEFT JOIN; with joins off, the factory strips the join clause and the
// adapter falls back to separate queries.
const AUTH_ENV = {
  DB: env.DB,
  EMAIL: {
    send: async () => ({ messageId: "test" }),
  },
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
} satisfies Parameters<typeof createAuth>[0];

const USER_JOIN = { user: { on: { from: "userId", to: "id" }, relation: "one-to-one" } };

async function sessionReadSql(adapter: { findOne: (args: never) => Promise<unknown> }) {
  const prepare = vi.spyOn(env.DB, "prepare");
  await adapter.findOne({
    model: "session",
    where: [{ field: "token", value: "no-such-token-0509-5780" }],
    join: USER_JOIN,
  } as never);
  const sql = prepare.mock.calls.map(([query]) => String(query));
  prepare.mockRestore();
  return sql;
}

describe("advanced.database.joins (0509#5780)", () => {
  it("createAuth ships joins on: the session read is one query with a LEFT JOIN", async () => {
    const auth = createAuth(AUTH_ENV);
    const ctx = await auth.$context;
    const sql = await sessionReadSql(ctx.adapter);
    expect(sql.filter((query) => /left join "user"/i.test(query)).length, JSON.stringify(sql)).toBeGreaterThan(0);
  });

  it("joins off would keep the join out of the SQL — the regression this pins", async () => {
    const auth = betterAuth({
      database: env.DB,
      secret: AUTH_ENV.BETTER_AUTH_SECRET,
      baseURL: AUTH_ENV.BETTER_AUTH_URL,
      advanced: { database: { joins: false } },
    });
    const ctx = await auth.$context;
    const sql = await sessionReadSql(ctx.adapter);
    expect(sql.filter((query) => /left join/i.test(query)).length, JSON.stringify(sql)).toBe(0);
  });
});
