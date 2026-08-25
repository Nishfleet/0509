// Workerd-D1 integration setup. Runs inside the Workers runtime (the
// `cloudflare` environment) once per test file. Reads the migration blobs that
// `vite.config.ts` threaded in as the `TEST_MIGRATIONS` binding and applies
// every un-applied migration to the real local D1 (`env.DB`) via the official
// `applyD1Migrations()` helper from `cloudflare:test`.
//
// Storage is isolated per test file by @cloudflare/vitest-plugin, so each file
// starts from a clean D1 and re-applies the full migration set — the same
// shape the D1 recipe ships. This is what makes a schema migration a
// verifiable change: if a migration file does not apply cleanly against real
// workerd D1, this setup (and therefore every integration test) fails.
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeEach } from "vitest";

// `TEST_MIGRATIONS` is a plain JSON binding (array of { name, queries }),
// typed loosely here on purpose — the binding is test-only and never reaches
// production. Cast through unknown so the workerd type checker does not need
// a project-wide ambient declaration for a single test helper.
type D1Migration = { name: string; queries: string[] };
const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;

beforeEach(async () => {
  await applyD1Migrations(env.DB, migrations);
});
