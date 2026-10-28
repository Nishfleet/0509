import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { ensureWorkspace } from "../../app/lib/workspace.server";
import { loadNightlyPlan } from "../../workers/standing/rollover-plan";

const NOW = new Date("2026-09-24T03:00:00.000Z");

async function onboard(id: string, email: string) {
  const at = "2026-09-22T12:00:00.000Z";
  const known = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first<{ id: string }>();
  const userId = known?.id ?? id;
  if (known === null) {
    await env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
    )
      .bind(userId, email, email, at, at)
      .run();
  }
  const workspace = await ensureWorkspace(env.DB, { userId, email, timezone: "UTC", now: at });
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, state, domain, created_at)
     SELECT ?, ?, 'self', 'on', ?, ? WHERE NOT EXISTS (SELECT 1 FROM entity WHERE workspace_id = ? AND role = 'self')`,
  )
    .bind(`ent_${id}`, workspace.id, `${id}.example.com`, at, workspace.id)
    .run();
  await env.DB.prepare(
    `INSERT INTO plan (id, workspace_id, tier, status, updated_at)
     SELECT ?, ?, 'scout', 'trialing', ? WHERE NOT EXISTS (SELECT 1 FROM plan WHERE workspace_id = ?)`,
  )
    .bind(`plan_${id}`, workspace.id, at, workspace.id)
    .run();
  return workspace.id;
}

describe("fixture workspaces and the nightly plan (0509#5774)", () => {
  it("schedules a real user alone: the kept journey accounts and the per-run e2e workspaces are fixtures (#7757)", async () => {
    const real = await onboard("u-real", "ada@example.com");
    const kept = await onboard("u-kept", "e2e+j12-rollovers@0509.io");
    const keptLane = await onboard("u-kept-lane", "e2e+onboarded-desktop@0509.io");
    const fixture = await onboard("u-fix", "e2e+abc123@0509.io");

    const marks = await env.DB.prepare("SELECT id, fixture FROM workspace WHERE id IN (?, ?, ?, ?) ORDER BY id")
      .bind(real, kept, keptLane, fixture)
      .all<{
        id: string;
        fixture: number;
      }>();
    expect(Object.fromEntries(marks.results.map((row) => [row.id, row.fixture]))).toEqual({
      [real]: 0,
      [kept]: 1,
      [keptLane]: 1,
      [fixture]: 1,
    });

    const plan = await loadNightlyPlan(env.DB, NOW);
    expect(plan.workspaces).toBe(1);
    expect(plan.scheduled.map((instance) => instance.params.workspaceId)).toEqual([real]);
  });
});
