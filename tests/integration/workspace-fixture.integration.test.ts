import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { ensureWorkspace } from "../../app/lib/workspace.server";
import { loadNightlyPlan } from "../../workers/standing/rollover-plan";

const NOW = new Date("2026-09-24T03:00:00.000Z");

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
