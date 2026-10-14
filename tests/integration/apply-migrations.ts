import { applyD1Migrations, env } from "cloudflare:test";

// Applies migrations/0001_rebuild.sql to the real local D1 before the suite,
// so assertions run against the schema the deploy actually ships.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
