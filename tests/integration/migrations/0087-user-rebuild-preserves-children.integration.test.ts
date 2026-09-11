import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Real-D1 regression gate for issue #2774 / fleet-ops#4999.
 *
 * Reproduces the 2026-09-09 production wipe on a scratch D1 binding:
 * `applyD1Migrations` sends each migration file through `db.batch()`, which
 * wraps the file in one transaction — the same wrap that made
 * `PRAGMA foreign_keys = OFF` a no-op in production. Applying the repo's real
 * pre-0087 chain to DB_MIGRATION_SCRATCH, seeding account-scoped rows, then
 * applying the real 0087 asserts the rewritten file preserves every
 * `ON DELETE CASCADE` descendant of `user`.
 *
 * The scratch binding is declared in tests/integration/wrangler.test.jsonc
 * because the shared `env.DB` already has the whole chain applied by
 * tests/integration/apply-migrations.ts; only a second database can observe a
 * mid-chain apply with seeded data.
 *
 * This file fails against the pre-rewrite 0087 (seeded children come back 0)
 * and passes on the rewrite.
 */

const TARGET = "0087_signup_source_open_allowlist.sql";
const ISO = "2026-01-01T00:00:00.000Z";

const WATCHED_TABLES = [
  "user",
  "user_plan",
  "watchlist",
  "proof_target",
  "proof_capture",
  "session",
  "delivery_target",
  "delivery_attempt",
  "signup_source_pending",
] as const;

function scratch() {
  return env.DB_MIGRATION_SCRATCH;
}

async function count(table: string) {
  const row = await scratch()
    .prepare(`SELECT COUNT(*) AS c FROM ${table}`)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

async function seedAccountScopedRows() {
  const statements = [
    `INSERT INTO user (id, name, email, createdAt, updatedAt)
     VALUES ('i2774-u1', 'Cascade Guard', 'i2774-u1@example.test', '${ISO}', '${ISO}')`,
    `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
     VALUES ('i2774-s1', '2030-01-01', 'token-i2774-s1', '${ISO}', '${ISO}', 'i2774-u1')`,
    `INSERT INTO user_plan (user_id) VALUES ('i2774-u1')`,
    `INSERT INTO watchlist (
       id, user_id, name, target_type, target_id, target_fingerprint,
       target_label, created_at, updated_at
     ) VALUES ('i2774-w1', 'i2774-u1', 'Guard watchlist', 'advertiser',
               'target-i2774-w1', 'fp-i2774-w1', 'guard.example', '${ISO}', '${ISO}')`,
    `INSERT INTO delivery_target (
       id, user_id, watchlist_id, channel, target_value, created_at, updated_at
     ) VALUES ('i2774-dt1', 'i2774-u1', 'i2774-w1', 'email',
               'i2774-u1@example.test', '${ISO}', '${ISO}')`,
    `INSERT INTO delivery_attempt (
       id, user_id, watchlist_id, delivery_target_id, lane, channel, provider,
       status, target_value, created_at, updated_at
     ) VALUES ('i2774-da1', 'i2774-u1', 'i2774-w1', 'i2774-dt1', 'customer',
               'email', 'cf-email', 'sent', 'i2774-u1@example.test', '${ISO}', '${ISO}')`,
    `INSERT INTO proof_target (
       id, watchlist_id, canonical_page_identity, proof_target_identity,
       created_at, updated_at
     ) VALUES ('i2774-pt1', 'i2774-w1', 'guard.example/page',
               'guard.example/page#ad1', '${ISO}', '${ISO}')`,
    `INSERT INTO proof_capture (
       id, proof_target_id, status, extractor_version, attempted_at,
       created_at, updated_at
     ) VALUES ('i2774-pc1', 'i2774-pt1', 'succeeded', 'v1', '${ISO}',
               '${ISO}', '${ISO}')`,
    `INSERT INTO signup_source_pending (email, signup_source, created_at, expires_at)
     VALUES ('i2774-pending@example.test', 'magicbrief-migration', '${ISO}', '2030-01-01')`,
  ];
  await scratch().batch(statements.map((sql) => scratch().prepare(sql)));
}

describe("migration 0087 on real D1 — user rebuild preserves children (issue #2774)", () => {
  let before: Record<string, number>;

  beforeAll(async () => {
    const migrations = env.TEST_MIGRATIONS;
    const preTarget = migrations.filter((m) => m.name < TARGET);
    const target = migrations.find((m) => m.name === TARGET);
    if (!target) throw new Error(`${TARGET} missing from TEST_MIGRATIONS`);
    await applyD1Migrations(scratch(), preTarget);
    await seedAccountScopedRows();
    before = Object.fromEntries(
      await Promise.all(WATCHED_TABLES.map(async (t) => [t, await count(t)])),
    );
    await applyD1Migrations(scratch(), [target]);
  });

  it("seeded one row in each watched table before the migration", () => {
    for (const table of WATCHED_TABLES) {
      expect(before[table], `seed failed for ${table}`).toBe(1);
    }
  });

  it("leaves every account-scoped row intact after the apply", async () => {
    for (const table of WATCHED_TABLES) {
      expect(await count(table), `${table} was emptied by the 0087 apply`).toBe(before[table]);
    }
  });

  it("leaves no foreign key violations and no staging tables", async () => {
    const violations = await scratch().prepare("PRAGMA foreign_key_check").all();
    expect(violations.results).toEqual([]);
    const leftovers = await scratch()
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'mig0087_%'")
      .all();
    expect(leftovers.results).toEqual([]);
  });

  it("keeps the rebuilt user table writable under the open allowlist", async () => {
    await scratch()
      .prepare(
        `INSERT INTO user (id, name, email, createdAt, updatedAt, signup_source)
         VALUES ('i2774-u2', 'T', 'i2774-u2@example.test', '${ISO}', '${ISO}', 'summer-2026-launch')`,
      )
      .run();
    const row = await scratch()
      .prepare("SELECT signup_source FROM user WHERE id = 'i2774-u2'")
      .first<{ signup_source: string }>();
    expect(row?.signup_source).toBe("summer-2026-launch");

    // The pre-0087 CHECK must be gone: a slug that only the open shape
    // accepts is written; malformed values still fail.
    await expect(
      scratch()
        .prepare(
          `INSERT INTO user (id, name, email, createdAt, updatedAt, signup_source)
           VALUES ('i2774-u3', 'T', 'i2774-u3@example.test', '${ISO}', '${ISO}', 'Bad Source!')`,
        )
        .run(),
    ).rejects.toThrow();
  });
});
