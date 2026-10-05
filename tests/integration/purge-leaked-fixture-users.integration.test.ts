import { env, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const NOW = "2026-10-04T16:00:00.000Z";

const LEAKED = [
  "e2e+expiry-0123456789ab@0509.io",
  "e2e+onboarded-desktop-0123456789ab@0509.io",
  "e2e+clef0123456789@0509.io",
  "e2e+2a88967caee7@0509.io",
  "e2e+cef6f13a41f8fadf@0509.io",
];
const OTHER_TEST_DOMAINS = ["canary-4411@example.com", "probe@fixture.0509.in"];
const JOURNEY_AND_REAL = [
  "someone@gymshark.com",
  "e2e+j7@0509.io",
  "e2e+j8-hard@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j8-hard-v2@0509.io",
  "e2e+j8-soft-v2@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
  "e2e+soak@0509.io",
];

const PURGE_MIGRATIONS: D1Migration[] = env.TEST_MIGRATIONS.filter((migration) =>
  migration.name.endsWith("_purge_leaked_fixture_users.sql"),
);

const CASES = PURGE_MIGRATIONS.map((migration) =>
  migration.name.startsWith("0044")
    ? ([migration.name, migration, [...LEAKED, ...OTHER_TEST_DOMAINS], JOURNEY_AND_REAL] as const)
    : ([migration.name, migration, LEAKED, [...OTHER_TEST_DOMAINS, ...JOURNEY_AND_REAL]] as const),
);

async function seed(email: string, index: number): Promise<void> {
  const userId = `user-leak-${String(index)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, email, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Acme', ?2, 'UTC', 1, 8, ?3)",
    ).bind(`ws-leak-${String(index)}`, userId, NOW),
    env.DB.prepare(
      "INSERT INTO apikey (id, configId, referenceId, \"key\", createdAt, updatedAt) VALUES (?1, 'default', ?2, ?1, ?3, ?3)",
    ).bind(`key-leak-${String(index)}`, userId, NOW),
  ]);
}

async function remaining(sql: string): Promise<string[]> {
  const { results } = await env.DB.prepare(sql).all<{ v: string }>();
  return results.map((row) => row.v).sort();
}

describe("the leaked fixture-account purge migrations", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM apikey WHERE id LIKE 'key-leak-%'"),
      env.DB.prepare("DELETE FROM \"user\" WHERE id LIKE 'user-leak-%'"),
    ]);
  });

  it("are 0044 and 0045", () => {
    expect(PURGE_MIGRATIONS.map((migration) => migration.name.slice(0, 4))).toEqual(["0044", "0045"]);
  });

  it.each(CASES)(
    "%s deletes leaked test accounts with their workspaces and keys, and keeps every account outside its filter",
    async (_name, migration, purged, kept) => {
      const emails = [...purged, ...kept];
      await Promise.all(emails.map((email, index) => seed(email, index)));

      await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));

      const keptIds = kept.map((email) => `user-leak-${String(emails.indexOf(email))}`).sort();
      expect(await remaining("SELECT email AS v FROM \"user\" WHERE id LIKE 'user-leak-%'")).toEqual([...kept].sort());
      expect(await remaining("SELECT owner_user_id AS v FROM workspace WHERE id LIKE 'ws-leak-%'")).toEqual(keptIds);
      expect(await remaining("SELECT referenceId AS v FROM apikey WHERE id LIKE 'key-leak-%'")).toEqual(keptIds);
    },
  );
});
