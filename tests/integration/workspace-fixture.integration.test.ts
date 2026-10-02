import { env, type D1Migration } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";

import { FIXTURE_ACCOUNTS, isPerRunFixtureEmail } from "../../app/lib/fixture-accounts";
import { ensureWorkspace } from "../../app/lib/workspace.server";
import { loadNightlyPlan } from "../../workers/standing/rollover-plan";

const NOW = new Date("2026-09-24T03:00:00.000Z");

const FIXTURE_EMAILS = Object.values(FIXTURE_ACCOUNTS).map((account) => account.email);

// The 0040 backfill UPDATE, taken from the migration itself. The workers setup
// has already applied the chain, so the ALTER is on the table; re-running the
// UPDATE is what the migration does to a workspace created before it shipped.
function backfillUpdate(): string {
  const found: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
    migration.name.endsWith("_workspace_fixture.sql"),
  );
  if (found === undefined) throw new Error("0040_workspace_fixture.sql is missing from TEST_MIGRATIONS");
  // Not anchored: a leading comment line in the SQL, or a quoted identifier,
  // would otherwise lose the update the migration is supposed to ship.
  const update = found.queries.find((query) => /update\s+workspace\s+set\s+fixture/i.test(query));
  if (update === undefined) throw new Error("0040_workspace_fixture.sql no longer sets workspace.fixture");
  return update;
}

async function onboard(id: string, email: string) {
  const at = "2026-09-22T12:00:00.000Z";
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, at, at)
    .run();
  const workspace = await ensureWorkspace(env.DB, { userId: id, email, timezone: "UTC", now: at });
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, state, domain, created_at) VALUES (?, ?, 'self', 'on', ?, ?)`,
  )
    .bind(`ent_${id}`, workspace.id, `${id}.example.com`, at)
    .run();
  return workspace.id;
}

describe("fixture workspaces and the nightly plan (0509#5774)", () => {
  it("schedules real users and the fixed journey accounts, skips per-run e2e workspaces", async () => {
    const real = await onboard("u-real", "ada@example.com");
    const kept = await onboard("u-kept", "e2e+j12-rollovers@0509.io");
    const fixture = await onboard("u-fix", "e2e+abc123@0509.io");

    const marks = await env.DB.prepare("SELECT id, fixture FROM workspace ORDER BY id").all<{
      id: string;
      fixture: number;
    }>();
    expect(Object.fromEntries(marks.results.map((row) => [row.id, row.fixture]))).toEqual({
      [real]: 0,
      [kept]: 0,
      [fixture]: 1,
    });

    const plan = await loadNightlyPlan(env.DB, NOW);
    expect(plan.workspaces).toBe(2);
    expect(plan.scheduled.map((instance) => instance.params.workspaceId).sort()).toEqual([kept, real].sort());
  });
});

describe("the 0040 backfill for workspaces that predate the fixture column", () => {
  // The case above proves the write path, where ensureWorkspace marks a new
  // owner. The rows already in D1 when 0040 shipped were never marked by that
  // path, so the migration's own UPDATE is what marks them, and it is the only
  // thing standing between a customer's workspace and the nightly skip. The
  // six fixed journey accounts keep rolling over, so they must stay 0.
  //
  // The seeds use the exact six addresses: NOT IN excludes them literally, and
  // a near-miss address would not prove the exclusion (SQLite's LIKE '%' also
  // matches '@', so 'e2e+j7+x@0509.io' still matches the LIKE and would come
  // back 1). user.email is globally unique and the case above already inserted
  // e2e+j12-rollovers@0509.io, so those users are cleared first; ON DELETE
  // CASCADE takes their workspaces and entities with them.
  // One owner row per case, seeded with fixture = 0. Only the per-run owner
  // carries an e2e+@0509.io address, so the fixed accounts differ from it by
  // local part alone and the real customers differ by domain: the LIKE is
  // anchored on @0509.io, and "ada@example.com" also comes back 0 from the
  // sibling case, so the off-domain one must match it.
  const PRE_EXISTING: { owner: string; email: string }[] = [
    { owner: "backfill-per-run", email: "e2e+backfill-run@0509.io" },
    ...FIXTURE_EMAILS.map((email, index) => ({ owner: `backfill-fixed-${index}`, email })),
    { owner: "backfill-customer", email: "ada@example.com" },
    { owner: "backfill-off-domain", email: "e2e+backfill-run@example.com" },
  ];

  // The seed's emails, so the clear below cannot drift from the cases listed
  // above. The sibling case owns ada@example.com and e2e+j12-rollovers@0509.io,
  // and user.email is globally unique, so those users are cleared before the
  // seed and restored in afterAll where nothing else depends on them.
  const SEED_EMAILS = PRE_EXISTING.map((row) => row.email);

  async function seedPreExisting(): Promise<void> {

    const at = "2026-09-22T12:00:00.000Z";
    // The fixed-account addresses are global singletons in user and the sibling
    // case above owns two of them, so clear those users first: the seed below is
    // then the only row carrying each address, and ON DELETE CASCADE takes the
    // workspaces and entities with them.
    const placeholders = SEED_EMAILS.map(() => "?").join(", ");
    await env.DB.prepare(`DELETE FROM "user" WHERE email IN (${placeholders})`)
      .bind(...SEED_EMAILS)
      .run();

    const statements = PRE_EXISTING.flatMap(({ owner, email }) => [
      env.DB.prepare(
        'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
      ).bind(`u-${owner}`, email, at),
      // fixture = 0 written explicitly: the assertion is about what the
      // backfill changes, not about a default that happens to be 0.
      env.DB.prepare(
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture) VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4, 0)",
      ).bind(`w-${owner}`, `w-${owner}`, `u-${owner}`, at),
    ]);
    await env.DB.batch(statements);
  }

  it("marks the per-run e2e+ owner and leaves the six fixed accounts and real customers at 0", async () => {
    await seedPreExisting();

    // The six accounts this migration protects are the same six the app owns.
    expect(FIXTURE_EMAILS).toHaveLength(6);
    expect(isPerRunFixtureEmail("e2e+backfill-run@0509.io")).toBe(true);
    for (const email of FIXTURE_EMAILS) expect(isPerRunFixtureEmail(email)).toBe(false);

    // The UPDATE in the migration names exactly those six as excluded, so a
    // rename or a seventh account in the app cannot drift from the SQL. Both
    // quote styles are stripped, so the drift check fails for the emails
    // themselves rather than for the quoting.
    const update = backfillUpdate();
    const notIn = /email\s+not\s+in\s*\(([^)]*)\)/i.exec(update)?.[1] ?? "";
    expect(notIn).not.toBe("");
    const address = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g;
    expect((notIn.match(address) ?? []).sort()).toEqual([...FIXTURE_EMAILS].sort());

    // Before: nothing is marked.
    const before = await env.DB.prepare("SELECT id, fixture FROM workspace WHERE id LIKE 'w-backfill-%' ORDER BY id").all<{
      id: string;
      fixture: number;
    }>();
    expect(before.results).toHaveLength(PRE_EXISTING.length);
    expect(before.results.every((row) => row.fixture === 0)).toBe(true);

    await env.DB.prepare(update).run();

    const after = await env.DB.prepare("SELECT id, fixture FROM workspace WHERE id LIKE 'w-backfill-%' ORDER BY id").all<{
      id: string;
      fixture: number;
    }>();
    const byId = Object.fromEntries(after.results.map((row) => [row.id, row.fixture]));
    const marked = after.results.filter((row) => row.fixture === 1).map((row) => row.id);
    expect(marked).toEqual(["w-backfill-per-run"]);
    for (const { owner } of PRE_EXISTING.filter((row) => row.owner !== "backfill-per-run")) {
      expect(byId[`w-${owner}`]).toBe(0);
    }
    // Every seeded row is still there: the backfill only flips the marker.
    expect(after.results).toHaveLength(PRE_EXISTING.length);
  });

  // Clears only this case's rows. The sibling case already ran and asserted
  // on its own, and the two users it shares an address with were deleted by
  // seedPreExisting, so nothing later in this file reads a row this case put in
  // the shared D1.
  afterAll(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM workspace WHERE id LIKE 'w-backfill-%'"),
      env.DB.prepare("DELETE FROM \"user\" WHERE id LIKE 'u-backfill-%'"),
    ]);
  });
});
