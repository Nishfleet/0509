import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { FIXTURE_ACCOUNTS, isPerRunFixtureEmail } from "../../app/lib/fixture-accounts";

const NOW = "2026-09-22T12:00:00.000Z";
const FIXTURE_EMAILS = Object.values(FIXTURE_ACCOUNTS).map((account) => account.email);

const SHIPPED_WITH_0040 = [
  "e2e+j7@0509.io",
  "e2e+j8-hard-v2@0509.io",
  "e2e+j8-soft-v2@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
  "e2e+soak@0509.io",
];

interface Owner {
  owner: string;
  email: string;
  marked: 0 | 1;
}
const OWNERS: Owner[] = [
  { owner: "per-run", email: "e2e+abc123@0509.io", marked: 1 },

  ...SHIPPED_WITH_0040.map((email, index) => ({ owner: `fixed-${index}`, email, marked: 0 as const })),

  { owner: "customer", email: "ada@example.com", marked: 0 },
  { owner: "off-domain", email: "e2e+abc123@example.com", marked: 0 },
];

function backfillUpdate(): string {
  const found: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
    migration.name.endsWith("_workspace_fixture.sql"),
  );
  if (found === undefined) throw new Error("0040_workspace_fixture.sql is missing from TEST_MIGRATIONS");

  const updates = found.queries.filter((query) => /update\s+workspace\s+set\s+fixture/i.test(query));
  if (updates.length !== 1) {
    throw new Error(`0040_workspace_fixture.sql holds ${updates.length} UPDATEs over workspace.fixture`);
  }
  return updates[0] as string;
}

async function seed(): Promise<void> {
  const statements = OWNERS.flatMap(({ owner, email }) => [
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(`u-${owner}`, email, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture) VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4, 0)",
    ).bind(`w-${owner}`, owner, `u-${owner}`, NOW),
  ]);
  await env.DB.batch(statements);
}

async function fixtureMarks(): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare("SELECT id, fixture FROM workspace WHERE id LIKE 'w-%' ORDER BY id").all<{
    id: string;
    fixture: number;
  }>();
  return new Map(results.map((row) => [row.id, row.fixture]));
}

describe("the 0040 backfill UPDATE", () => {
  it("marks only the per-run e2e+ owner, and leaves the six fixed accounts and the real customers at 0", async () => {
    await seed();
    expect((await fixtureMarks()).size).toBe(OWNERS.length);
    expect([...new Set((await fixtureMarks()).values())]).toEqual([0]);

    const update = backfillUpdate();
    await env.DB.prepare(update).run();

    await env.DB.prepare(update).run();

    const after = await fixtureMarks();
    expect(after.size).toBe(OWNERS.length);
    for (const { owner, marked } of OWNERS) expect(after.get(`w-${owner}`)).toBe(marked);
    expect([...after.values()].filter((value) => value === 1)).toHaveLength(
      OWNERS.filter((row) => row.marked === 1).length,
    );
  });

  it("excludes the same six addresses app/lib/fixture-accounts.ts names", () => {
    expect(SHIPPED_WITH_0040).toHaveLength(6);
    for (const email of SHIPPED_WITH_0040) expect(FIXTURE_EMAILS).toContain(email);
    expect(isPerRunFixtureEmail("e2e+abc123@0509.io")).toBe(true);
    for (const email of FIXTURE_EMAILS) expect(isPerRunFixtureEmail(email)).toBe(false);

    const update = backfillUpdate();
    const notIn = /email\s+not\s+in\s*\(([^)]*)\)/i.exec(update)?.[1] ?? "";
    expect(notIn).not.toBe("");
    expect((notIn.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []).sort()).toEqual([...SHIPPED_WITH_0040].sort());
  });
});
