import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

/**
 * Per-file D1 setup (P10-A job 1).
 *
 * The `@cloudflare/vitest-plugin` isolates storage per test file, so each
 * test file starts against an empty D1. `applyD1Migrations` is idempotent:
 * it records applied migrations in `d1_migrations` and skips them on a
 * repeat call within the same file. The migration array is injected from
 * `vitest.workers.config.ts` via the `TEST_MIGRATIONS` binding, so the suite
 * always exercises the real `migrations/*.sql` chain — the same files
 * `wrangler d1 migrations apply` ships to production.
 *
 * `TEST_MIGRATIONS` is typed as `D1Migration[]` from `@cloudflare/vitest-plugin`.
 * The `as` cast keeps this file free of an ambient module declaration while
 * the binding is still test-only; the runtime shape is exactly what
 * `readD1Migrations()` produced in the config.
 */
export async function setupMigrations(): Promise<void> {
  const migrations = (env as unknown as { TEST_MIGRATIONS: unknown[] }).TEST_MIGRATIONS;
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error(
      "TEST_MIGRATIONS binding is missing or empty; vitest.workers.config.ts did not inject the migration array.",
    );
  }
  await applyD1Migrations(env.DB, migrations as Parameters<typeof applyD1Migrations>[1]);
}
