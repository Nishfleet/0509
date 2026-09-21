import type { D1Migration } from "@cloudflare/vitest-plugin";

/**
 * `TEST_MIGRATIONS` is a test-only binding injected by the `workers` vitest
 * project (vite.config.ts) so the setup file can apply the repo's real
 * migrations inside workerd. It exists only under test and is therefore not
 * part of the generated `worker-configuration.d.ts`.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      // Second D1 binding declared in tests/integration/wrangler.test.jsonc
      // (issue #2774): a scratch database for migration-apply tests that seed
      // rows between migration steps — the shared DB binding already has the
      // full chain applied by the setup file.
      DB_MIGRATION_SCRATCH: D1Database;
    }
  }
}

export {};
