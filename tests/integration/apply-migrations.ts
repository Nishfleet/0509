import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

// Applies migrations/0001_rebuild.sql to the real local D1 before the suite,
// so assertions run against the schema the deploy actually ships.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  const { keys } = await env.IDENTITY_CACHE.list({ prefix: "shared-read:" });
  await Promise.all(keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));
});
