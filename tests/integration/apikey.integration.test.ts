import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

/**
 * P8.1's named risk: better-auth validates its schema at runtime, so a drift
 * between migrations/ and what the apiKey plugin writes is a 500 on first
 * request in production. This drives the plugin through createAuth against
 * real D1 with the real migrations applied — a drift fails here, in CI.
 */
const auth = createAuth({
  DB: env.DB,
  EMAIL: { send: async () => ({ ok: true }) },
  BETTER_AUTH_SECRET: "integration-test-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
});

async function seedUser(id: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, "Key Owner", `${id}@test.dev`, now, now)
    .run();
}

describe("apikey plugin against the shipped schema", () => {
  it("creates a key server-side and the row lands in apikey", async () => {
    await seedUser("u_apikey_create");
    const created = await auth.api.createApiKey({
      body: { userId: "u_apikey_create", name: "integration" },
    });
    expect(created.key).toBeTruthy();
    expect(created.referenceId).toBe("u_apikey_create");

    const row = await env.DB.prepare(
      'SELECT id, start, prefix, referenceId, enabled, requestCount, remaining, "createdAt" FROM apikey WHERE id = ?',
    )
      .bind(created.id)
      .first<{
        id: string;
        start: string | null;
        prefix: string | null;
        referenceId: string;
        enabled: number;
        requestCount: number | null;
        remaining: number | null;
        createdAt: string;
      }>();
    expect(row, "the apikey row must exist").not.toBeNull();
    expect(row?.referenceId).toBe("u_apikey_create");
    expect(row?.enabled).toBe(1);
    expect(row?.key).toBeUndefined();
    expect(created.key.startsWith(row?.start ?? "")).toBe(true);
  });

  it("verify resolves a real key, counts the request, and never echoes the key", async () => {
    await seedUser("u_apikey_verify");
    const created = await auth.api.createApiKey({
      body: { userId: "u_apikey_verify", name: "verify-me" },
    });

    const res = await auth.api.verifyApiKey({ body: { key: created.key } });
    expect(res.error).toBeNull();
    expect(res.valid).toBe(true);
    expect(res.key?.id).toBe(created.id);
    expect(res.key && "key" in res.key).toBe(false);

    const row = await env.DB.prepare("SELECT requestCount FROM apikey WHERE id = ?")
      .bind(created.id)
      .first<{ requestCount: number }>();
    expect(row?.requestCount).toBe(1);
  });

  it("enforces the per-key window limit the plan entitlement will set", async () => {
    await seedUser("u_apikey_window");
    const created = await auth.api.createApiKey({
      body: {
        userId: "u_apikey_window",
        name: "window",
        rateLimitEnabled: true,
        rateLimitMax: 2,
        rateLimitTimeWindow: 60_000,
      },
    });

    expect((await auth.api.verifyApiKey({ body: { key: created.key } })).valid).toBe(true);
    expect((await auth.api.verifyApiKey({ body: { key: created.key } })).valid).toBe(true);

    const third = await auth.api.verifyApiKey({ body: { key: created.key } });
    expect(third.valid).toBe(false);

    const row = await env.DB.prepare("SELECT requestCount FROM apikey WHERE id = ?")
      .bind(created.id)
      .first<{ requestCount: number }>();
    expect(row, "a rate-limited key is rejected, not deleted").not.toBeNull();
    expect(row?.requestCount).toBe(2);
  });

  it("deletes a key whose lifetime `remaining` hits zero with no refill", async () => {
    await seedUser("u_apikey_budget");
    const created = await auth.api.createApiKey({
      body: { userId: "u_apikey_budget", name: "budget", remaining: 1 },
    });

    expect((await auth.api.verifyApiKey({ body: { key: created.key } })).valid).toBe(true);
    expect((await auth.api.verifyApiKey({ body: { key: created.key } })).valid).toBe(false);

    const row = await env.DB.prepare("SELECT id FROM apikey WHERE id = ?")
      .bind(created.id)
      .first();
    expect(row, "the plugin deletes an exhausted key — it will vanish from key lists").toBeNull();
  });

  it("rejects an unknown key", async () => {
    const res = await auth.api.verifyApiKey({ body: { key: "not-a-real-key" } });
    expect(res.valid).toBe(false);
    expect(res.key).toBeNull();
  });
});
