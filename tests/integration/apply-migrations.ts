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
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
