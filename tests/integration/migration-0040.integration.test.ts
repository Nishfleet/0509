import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { FIXTURE_ACCOUNTS, isPerRunFixtureEmail } from "../../app/lib/fixture-accounts";

/**
 * migrations/0040_workspace_fixture.sql (#5774), the half the write-path test
 * in workspace-fixture.integration.test.ts does not reach.
 *
 * That file proves ensureWorkspace marks a NEW owner as it onboards. The rows
 * already in D1 when 0040 shipped never pass through it, so the migration's own
 * UPDATE is the only thing that marks them, and the nightly standing cron
 * skips everything with fixture = 1. A backfill that marks too little leaves a
 * per-run workspace rolling over forever, and one that marks too much silently
 * stops a real customer or one of the six fixed journey accounts that must keep
 * rolling over (app/lib/fixture-accounts.ts).
 *
 * Its own file, not a case added to that one, so this runs in an isolated D1:
 * the UPDATE rewrites every matching workspace in the database it is given, and
 * here the only rows present are the seeds below.
 *
 * Issue #6613.
 */

const NOW = "2026-09-22T12:00:00.000Z";
const FIXTURE_EMAILS = Object.values(FIXTURE_ACCOUNTS).map((account) => account.email);

// One user and one workspace per case, all seeded at fixture = 0 so the
// assertion below is about what the backfill changes, not about a column
// default that happens to be 0.
interface Owner {
  owner: string;
  email: string;
  marked: 0 | 1;
}
const OWNERS: Owner[] = [
  // A per-run owner: the shape the backfill exists to mark.
  { owner: "per-run", email: "e2e+abc123@0509.io", marked: 1 },
  // The six fixed journey accounts, the exact addresses the NOT IN list holds.
  ...FIXTURE_EMAILS.map((email, index) => ({ owner: `fixed-${index}`, email, marked: 0 as const })),
  // A real customer on another domain, and the same local part as the per-run
  // owner but off @0509.io: the LIKE is anchored on that domain, so both stay 0.
  { owner: "customer", email: "ada@example.com", marked: 0 },
  { owner: "off-domain", email: "e2e+abc123@example.com", marked: 0 },
];

// The UPDATE, taken from the migration rather than restated here, so the test
// cannot pass against a copy that has drifted from the file that ships.
//
// It asserts exactly one match: a future version of this migration that adds a
// second UPDATE over workspace.fixture must fail this file, not leave the new
// statement untested while the old one keeps the case green.
function backfillUpdate(): string {
  const found: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
    migration.name.endsWith("_workspace_fixture.sql"),
  );
  if (found === undefined) throw new Error("0040_workspace_fixture.sql is missing from TEST_MIGRATIONS");
  // Not anchored: a leading comment line, or a quoted identifier, would
  // otherwise lose the statement the migration is supposed to ship.
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
  const { results } = await env.DB.prepare("SELECT id, fixture FROM workspace ORDER BY id").all<{
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

    // Idempotent, so a later run of the same file cannot mark a second
    // workspace or clear a first one.
    await env.DB.prepare(update).run();

    const after = await fixtureMarks();
    expect(after.size).toBe(OWNERS.length);
    for (const { owner, marked } of OWNERS) expect(after.get(`w-${owner}`)).toBe(marked);
    expect([...after.values()].filter((value) => value === 1)).toHaveLength(
      OWNERS.filter((row) => row.marked === 1).length,
    );
  });

  it("excludes the same six addresses app/lib/fixture-accounts.ts names", () => {
    // A rename in the app, or a seventh fixed account, would drift from the
    // SQL that protects them and start skipping a live account. The six are
    // pinned because the roster is the contract, not because six is the number.
    expect(FIXTURE_EMAILS).toHaveLength(6);
    expect(isPerRunFixtureEmail("e2e+abc123@0509.io")).toBe(true);
    for (const email of FIXTURE_EMAILS) expect(isPerRunFixtureEmail(email)).toBe(false);

    // Matched as bare addresses, so the check fails on the emails themselves
    // rather than on how the SQL quotes them.
    const update = backfillUpdate();
    const notIn = /email\s+not\s+in\s*\(([^)]*)\)/i.exec(update)?.[1] ?? "";
    expect(notIn).not.toBe("");
    expect((notIn.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []).sort()).toEqual([...FIXTURE_EMAILS].sort());
  });
});
