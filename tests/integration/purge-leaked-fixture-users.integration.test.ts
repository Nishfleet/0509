import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const NOW = "2026-10-04T16:00:00.000Z";

const PURGED = [
  "e2e+expiry-0123456789ab@0509.io",
  "e2e+onboarded-desktop-0123456789ab@0509.io",
  "e2e+clef0123456789@0509.io",
  "canary-4411@example.com",
  "probe@fixture.0509.in",
];
const KEPT = [
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

function purgeMigration(): D1Migration {
  const found = env.TEST_MIGRATIONS.find((migration) => migration.name.endsWith("_purge_leaked_fixture_users.sql"));
  if (found === undefined) throw new Error("the leaked-fixture purge migration is missing");
  return found;
}

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

describe("the leaked fixture-account purge migration", () => {
  it("deletes leaked test accounts with their workspaces and keys, and keeps real accounts and the eight journey accounts", async () => {
    const emails = [...PURGED, ...KEPT];
    await Promise.all(emails.map((email, index) => seed(email, index)));

    await env.DB.batch(purgeMigration().queries.map((query) => env.DB.prepare(query)));

    const keptIds = KEPT.map((email) => `user-leak-${String(emails.indexOf(email))}`).sort();
    expect(await remaining("SELECT email AS v FROM \"user\" WHERE id LIKE 'user-leak-%'")).toEqual([...KEPT].sort());
    expect(await remaining("SELECT owner_user_id AS v FROM workspace WHERE id LIKE 'ws-leak-%'")).toEqual(keptIds);
    expect(await remaining("SELECT referenceId AS v FROM apikey WHERE id LIKE 'key-leak-%'")).toEqual(keptIds);
  });
});
