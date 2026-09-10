import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

/**
 * Migrations 0079 and 0081 are pure data seeds (5 demo brands + 25 sitemap
 * brands) that prod already applied. They stay in the chain byte-for-byte,
 * but integration-test DBs must be schema-only (issue #2344), so we skip
 * them by name here. The seed rows live in `scripts/seed-demo-brands.mjs`;
 * tests that need them import and apply the seed SQL directly.
 */
const SKIP_MIGRATIONS = new Set([
  "0079_backfill_demo_brand_offer_timelines.sql",
  "0081_backfill_sitemap_brand_offer_timelines.sql",
]);

/**
 * Applies the repo's real `migrations/*.sql` to the per-project local D1 that
 * backs the `workers` vitest project.
 *
 * The migration list is read in Node at config time by `readD1Migrations()`
 * (vite.config.ts) and handed in through the test-only `TEST_MIGRATIONS`
 * binding, because reading the filesystem is not possible inside workerd.
 *
 * Setup files run OUTSIDE the per-test-file storage isolation and may run more
 * than once; `applyD1Migrations()` only applies migrations that are not already
 * recorded in `d1_migrations`, so calling it here is idempotent.
 */
const schemaOnlyMigrations = env.TEST_MIGRATIONS.filter(
  (m: { name: string }) => !SKIP_MIGRATIONS.has(m.name),
);
await applyD1Migrations(env.DB, schemaOnlyMigrations);
