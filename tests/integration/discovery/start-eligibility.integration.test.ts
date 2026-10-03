import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiscoveryParams } from "../../../app/lib/discovery/start.server";
import { startNightlyDiscovery, startWeeklyRefresh } from "../../../app/lib/discovery/start.server";

const MONDAY = "2026-09-28T03:00:00.000Z";
const TUESDAY = "2026-09-29T03:00:00.000Z";
const CREATED_ON_A_MONDAY = "2026-09-14T10:00:00.000Z";
const CREATED_ON_A_TUESDAY = "2026-09-15T10:00:00.000Z";

interface BatchItem {
  id: string;
  params: DiscoveryParams;
}

interface Seed {
  name: string;
  createdAt: string;
  fixture?: boolean;
  plan?: { status: string; currentPeriodEnd: string | null } | null;
}

let seeded = 0;

async function seed(input: Seed): Promise<string> {
  seeded += 1;
  const id = `elig-${String(seeded)}`;
  const plan = input.plan === undefined ? { status: "active", currentPeriodEnd: null } : input.plan;
  const statements = [
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(`user-${id}`, `${input.name}@example.com`, input.createdAt),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture) VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4, ?5)",
    ).bind(id, input.name, `user-${id}`, input.createdAt, input.fixture === true ? 1 : 0),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', ?3, 'Self', '{}', ?4)",
    ).bind(`${id}-self`, id, `${id}.example.com`, input.createdAt),
  ];
  if (plan !== null) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO plan (id, workspace_id, tier, status, current_period_end, updated_at) VALUES (?1, ?2, 'starter', ?3, ?4, ?5)",
      ).bind(`${id}-plan`, id, plan.status, plan.currentPeriodEnd, input.createdAt),
    );
  }
  await env.DB.batch(statements);
  return id;
}

async function startedBy(start: (now: Date) => Promise<number>, at: string): Promise<string[]> {
  const createBatch = vi.fn((_batch: BatchItem[]) => Promise.resolve([]));
  Reflect.set(env, "DISCOVERY", { createBatch });
  await start(new Date(at));
  return createBatch.mock.calls.flatMap(([batch]) => batch.map((item) => item.params.workspaceId)).sort();
}

afterEach(async () => {
  Reflect.deleteProperty(env, "DISCOVERY");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM workspace WHERE id LIKE 'elig-%'"),
    env.DB.prepare("DELETE FROM \"user\" WHERE id LIKE 'user-elig-%'"),
  ]);
});

describe("which workspaces discovery runs for", () => {
  it("skips fixture workspaces and workspaces with no live plan, in both modes", async () => {
    const paid = await seed({ name: "paid", createdAt: CREATED_ON_A_MONDAY });
    const trial = await seed({
      name: "trial",
      createdAt: CREATED_ON_A_MONDAY,
      plan: { status: "trialing", currentPeriodEnd: null },
    });
    await seed({ name: "fixture", createdAt: CREATED_ON_A_MONDAY, fixture: true });
    await seed({ name: "noplan", createdAt: CREATED_ON_A_MONDAY, plan: null });
    await seed({
      name: "lapsed",
      createdAt: CREATED_ON_A_MONDAY,
      plan: { status: "cancelled", currentPeriodEnd: "2026-09-10T00:00:00.000Z" },
    });
    const paidThrough = await seed({
      name: "paidthrough",
      createdAt: CREATED_ON_A_MONDAY,
      plan: { status: "cancelled", currentPeriodEnd: "2026-10-30T00:00:00.000Z" },
    });
    const expected = [paid, paidThrough, trial].sort();

    expect(await startedBy(startNightlyDiscovery, MONDAY)).toEqual(expected);
    expect(await startedBy(startWeeklyRefresh, MONDAY)).toEqual(expected);
  });

  it("proposes new rivals for a workspace once a week, on the weekday it was created", async () => {
    const mondayBorn = await seed({ name: "monday-born", createdAt: CREATED_ON_A_MONDAY });
    const tuesdayBorn = await seed({ name: "tuesday-born", createdAt: CREATED_ON_A_TUESDAY });

    expect(await startedBy(startNightlyDiscovery, MONDAY)).toEqual([mondayBorn]);
    expect(await startedBy(startNightlyDiscovery, TUESDAY)).toEqual([tuesdayBorn]);
  });

  it("starts nothing when no workspace is eligible", async () => {
    await seed({ name: "noplan", createdAt: CREATED_ON_A_MONDAY, plan: null });

    expect(await startedBy(startNightlyDiscovery, MONDAY)).toEqual([]);
  });
});
