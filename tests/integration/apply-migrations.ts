import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

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

/**
 * Migrations that are pure data seeds rather than schema changes. 0079 and
 * 0081 backfill demo offer-timeline rows (5 + 25 brands) that the schema-only
 * contract keeps OUT of fresh databases — they are delivered by the
 * `scripts/seed-demo-brands.mjs` runbook when demo data is actually wanted.
 * Skipping them here makes every integration-test database schema-only (issue
 * #2344); the migration files themselves stay in the chain byte-for-byte
 * because production already applied them.
 */
const SEED_ONLY_MIGRATIONS = new Set([
  "0079_backfill_demo_brand_offer_timelines.sql",
  "0081_backfill_sitemap_brand_offer_timelines.sql",
]);

const SCHEMA_ONLY_MIGRATIONS = env.TEST_MIGRATIONS.filter(
  (migration) => !SEED_ONLY_MIGRATIONS.has(migration.name),
);

await applyD1Migrations(env.DB, SCHEMA_ONLY_MIGRATIONS);
