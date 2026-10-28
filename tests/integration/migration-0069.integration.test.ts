import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { FIXTURE_ACCOUNTS, isE2eFixtureEmail } from "../../app/lib/fixture-accounts";

const NOW = "2026-10-28T12:00:00.000Z";
const KEPT_EMAILS = Object.values(FIXTURE_ACCOUNTS).map((account) => account.email);

interface Owner {
  owner: string;
  email: string;
  marked: 0 | 1;
}
const OWNERS: Owner[] = [
  ...KEPT_EMAILS.map((email, index) => ({ owner: `kept-${index}`, email, marked: 1 as const })),
  { owner: "per-run", email: "e2e+abc123@0509.io", marked: 0 },
  { owner: "customer", email: "ada@example.com", marked: 0 },
  { owner: "off-domain", email: "e2e+abc123@example.com", marked: 0 },
];

function keptBackfill(): string {
  const found: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
    migration.name.endsWith("_mark_kept_fixture_workspaces.sql"),
  );
  if (found === undefined) throw new Error("0069_mark_kept_fixture_workspaces.sql is missing from TEST_MIGRATIONS");

  const updates = found.queries.filter((query) => /update\s+workspace\s+set\s+fixture/i.test(query));
  if (updates.length !== 1) {
    throw new Error(`0069_mark_kept_fixture_workspaces.sql holds ${updates.length} UPDATEs over workspace.fixture`);
  }
  return updates[0] as string;
}

async function seed(): Promise<void> {
  const statements = OWNERS.flatMap(({ owner, email }) => [
    env.DB.prepare(
      'INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(`u-${owner}`, email, NOW),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture)
       SELECT ?1, ?2, COALESCE((SELECT id FROM "user" WHERE email = ?2), ?3), 'UTC', 1, 8, ?4, 0
       WHERE NOT EXISTS (
         SELECT 1 FROM workspace w WHERE w.owner_user_id = COALESCE((SELECT id FROM "user" WHERE email = ?2), ?3)
       )`,
    ).bind(`w-${owner}`, email, `u-${owner}`, NOW),
  ]);
  await env.DB.batch(statements);
  await env.DB.prepare(
    `UPDATE workspace SET fixture = 0 WHERE owner_user_id IN (
       SELECT id FROM "user" WHERE email IN (${OWNERS.map((_, index) => `?${index + 1}`).join(", ")})
     )`,
  )
    .bind(...OWNERS.map((row) => row.email))
    .run();
}

async function marksByEmail(): Promise<Map<string, number[]>> {
  const { results } = await env.DB.prepare(
    `SELECT u.email AS email, w.fixture AS fixture
     FROM workspace w JOIN "user" u ON u.id = w.owner_user_id
     WHERE u.email IN (${OWNERS.map((_, index) => `?${index + 1}`).join(", ")})
     ORDER BY u.email`,
  )
    .bind(...OWNERS.map((row) => row.email))
    .all<{ email: string; fixture: number }>();
  const marks = new Map<string, number[]>();
  for (const row of results) marks.set(row.email, [...(marks.get(row.email) ?? []), row.fixture]);
  return marks;
}

describe("the 0069 backfill UPDATE", () => {
  it("marks every kept e2e account and leaves per-run addresses, real customers and off-domain e2e at 0", async () => {
    await seed();
    expect([...new Set([...(await marksByEmail()).values()].flat())]).toEqual([0]);

    const update = keptBackfill();
    await env.DB.prepare(update).run();
    await env.DB.prepare(update).run();

    const after = await marksByEmail();
    for (const { email, marked } of OWNERS) {
      expect(after.get(email), email).toEqual(expect.arrayContaining([marked]));
      expect(new Set(after.get(email)), email).toEqual(new Set([marked]));
    }
  });

  it("names exactly the eleven FIXTURE_ACCOUNTS addresses and nothing else", () => {
    expect(KEPT_EMAILS).toHaveLength(11);
    for (const email of KEPT_EMAILS) expect(isE2eFixtureEmail(email)).toBe(true);

    const update = keptBackfill();
    const inList = /email\s+in\s*\(([\s\S]*?)\)/i.exec(update)?.[1] ?? "";
    expect((inList.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []).sort()).toEqual([...KEPT_EMAILS].sort());
  });
});
