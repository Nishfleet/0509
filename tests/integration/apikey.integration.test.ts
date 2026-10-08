import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

/**
 * P8.1's named risk: a drift between migrations/ and what the apiKey plugin
 * writes surfaces in production as the first query touching the drifted
 * table. better-auth's runtime schema check is off (0509#5721: it cost ~6.5M
 * D1 rows a day), so this drives the plugin through createAuth against real
 * D1 with the real migrations applied — a drift fails here, in CI, and the
 * control arm in auth-schema-check.integration.test.ts still runs the check
 * itself once per CI run.
 */
const auth = createAuth({
  DB: env.DB,
  EMAIL: { send: async () => ({ messageId: "m-1" }) },
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
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
    // This row SELECT never reads the key column, so the shape itself must lack it.
    expect(row).not.toHaveProperty("key");
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

    const row = await env.DB.prepare("SELECT id FROM apikey WHERE id = ?").bind(created.id).first();
    expect(row, "the plugin deletes an exhausted key — it will vanish from key lists").toBeNull();
  });

  it("rejects an unknown key", async () => {
    const res = await auth.api.verifyApiKey({ body: { key: "not-a-real-key" } });
    expect(res.valid).toBe(false);
    expect(res.key).toBeNull();
  });

  it("mints a key that expires and carries the advertised read scope", async () => {
    await seedUser("u_apikey_scope");
    const created = await auth.api.createApiKey({
      body: { userId: "u_apikey_scope", name: "scoped" },
    });
    const row = await env.DB.prepare('SELECT permissions, "expiresAt" FROM apikey WHERE id = ?')
      .bind(created.id)
      .first<{ permissions: string | null; expiresAt: string | null }>();
    expect(row?.permissions).toBe('{"read":["*"]}');
    expect(row?.expiresAt, "a new key must expire").not.toBeNull();
    const expiresAt = new Date(row?.expiresAt ?? "").getTime();
    const inNinetyDays = Date.now() + 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - inNinetyDays)).toBeLessThan(24 * 60 * 60 * 1000);

    const { propsForApiKey } = await import("../../app/lib/agent/keys.server");
    expect(await propsForApiKey(created.key)).toMatchObject({ userId: "u_apikey_scope" });
    await env.DB.prepare("UPDATE apikey SET permissions = NULL WHERE id = ?").bind(created.id).run();
    expect(await propsForApiKey(created.key)).toBeNull();
    await env.DB.prepare("UPDATE apikey SET permissions = ? WHERE id = ?").bind('{"write":["*"]}', created.id).run();
    expect(await propsForApiKey(created.key)).toBeNull();
  });

  it("leaves existing keys with no expiry and still verifies them", async () => {
    await seedUser("u_apikey_noexpiry");
    const legacy = await auth.api.createApiKey({
      body: { userId: "u_apikey_noexpiry", name: "legacy" },
    });
    await env.DB.prepare('UPDATE apikey SET "expiresAt" = NULL WHERE id = ?').bind(legacy.id).run();
    await env.DB.prepare(apikeyBackfill()).run();

    const row = await env.DB.prepare('SELECT "expiresAt" FROM apikey WHERE id = ?')
      .bind(legacy.id)
      .first<{ expiresAt: string | null }>();
    expect(row?.expiresAt, "the backfill must not stamp an expiry").toBeNull();
    expect((await auth.api.verifyApiKey({ body: { key: legacy.key } })).valid).toBe(true);

    await env.DB.prepare('UPDATE apikey SET "expiresAt" = ? WHERE id = ?')
      .bind("2000-01-01T00:00:00.000Z", legacy.id)
      .run();
    expect((await auth.api.verifyApiKey({ body: { key: legacy.key } })).valid).toBe(false);
  });

  it("stamps the read scope on every key that lacks it and leaves read keys alone", async () => {
    await seedUser("u_apikey_perm_backfill");
    const unscoped = await auth.api.createApiKey({
      body: { userId: "u_apikey_perm_backfill", name: "unscoped" },
    });
    const writer = await auth.api.createApiKey({
      body: { userId: "u_apikey_perm_backfill", name: "writer" },
    });
    const reader = await auth.api.createApiKey({
      body: { userId: "u_apikey_perm_backfill", name: "reader" },
    });
    await env.DB.prepare("UPDATE apikey SET permissions = NULL WHERE id = ?").bind(unscoped.id).run();
    await env.DB.prepare("UPDATE apikey SET permissions = ? WHERE id = ?").bind('{"write":["*"]}', writer.id).run();

    const { propsForApiKey } = await import("../../app/lib/agent/keys.server");
    expect(await propsForApiKey(unscoped.key)).toBeNull();

    await env.DB.prepare(apikeyBackfill()).run();

    const rows = await env.DB.prepare("SELECT id, permissions FROM apikey WHERE id IN (?, ?, ?)")
      .bind(unscoped.id, writer.id, reader.id)
      .all<{ id: string; permissions: string | null }>();
    const byId = new Map((rows.results ?? []).map((row) => [row.id, row.permissions]));
    expect(byId.get(unscoped.id)).toBe('{"read":["*"]}');
    expect(byId.get(writer.id)).toBe('{"read":["*"]}');
    expect(byId.get(reader.id)).toBe('{"read":["*"]}');
    expect(await propsForApiKey(unscoped.key)).toMatchObject({ userId: "u_apikey_perm_backfill" });
    expect(await propsForApiKey(writer.key)).toMatchObject({ userId: "u_apikey_perm_backfill" });
  });
});

function apikeyBackfill(): string {
  const found: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
    migration.name.endsWith("_apikey_read_expiry.sql"),
  );
  if (found === undefined) throw new Error("0049_apikey_read_expiry.sql is missing from TEST_MIGRATIONS");
  const updates = found.queries.filter((query) => /update\s+"apikey"\s+set\s+"permissions"/i.test(query));
  if (updates.length !== 1) {
    throw new Error(`0049_apikey_read_expiry.sql holds ${updates.length} UPDATEs over apikey.permissions`);
  }
  return updates[0] as string;
}
