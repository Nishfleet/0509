import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readActivationBoard } from "../../app/lib/data/activation_board.server";

const NOW = new Date("2026-10-14T12:00:00.000Z");

const workspace = (id: string, createdAt: string, lastSeen: string | null) => [
  env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?1, 'U', ?1 || '@example.test', 1, ?2, ?2)`,
  ).bind(`u-${id}`, createdAt),
  env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at, last_seen_at)
     VALUES (?1, 'W', ?2, 'UTC', ?3, ?4)`,
  ).bind(id, `u-${id}`, createdAt, lastSeen),
  env.DB.prepare(
    `INSERT INTO plan (id, workspace_id, tier, status, trialing, updated_at) VALUES (?1, ?2, 'starter', 'active', 0, ?3)`,
  ).bind(`p-${id}`, id, createdAt),
];

const rival = (workspaceId: string, n: number, createdAt: string, state = "on") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
     VALUES (?1, ?2, 'competitor', ?3, 'R', '{}', 'manual', ?4, ?5)`,
  ).bind(`e-${workspaceId}-${String(n)}`, workspaceId, `r${String(n)}-${workspaceId}.example`, state, createdAt);

const brief = (workspaceId: string, sentAt: string, status = "sent") =>
  env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, sent_at)
     VALUES (?1, ?2, 'weekly', '2026-09-01', '2026-09-08', ?3, ?4)`,
  ).bind(`d-${workspaceId}-${sentAt}`, workspaceId, status, sentAt);

const visit = (workspaceId: string, day: string) =>
  env.DB.prepare("INSERT INTO workspace_visit (workspace_id, day) VALUES (?1, ?2)").bind(workspaceId, day);

const answer = (workspaceId: string, n: number, verdict: string, at: string) =>
  env.DB.prepare(
    `INSERT INTO user_decision (id, workspace_id, user_id, verdict, decided_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(`ud-${workspaceId}-${String(n)}`, workspaceId, `u-${workspaceId}`, verdict, at);

describe("activation board", () => {
  beforeEach(async () => {
    for (const table of ["user_decision", "digest", "workspace_visit", "entity", "plan", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      ...workspace("a", "2026-10-06T10:00:00Z", "2026-10-13T08:00:00Z"),
      ...workspace("b", "2026-10-07T10:00:00Z", "2026-10-08T08:00:00Z"),
      ...workspace("c", "2026-10-08T10:00:00Z", null),
      rival("a", 1, "2026-10-06T10:05:00Z"),
      rival("a", 2, "2026-10-09T10:00:00Z"),
      rival("b", 1, "2026-10-07T10:05:00Z"),
      brief("a", "2026-10-12T08:00:00Z"),
      brief("b", "2026-10-12T08:00:00Z"),
      visit("a", "2026-10-12"),
      visit("a", "2026-10-13"),
      visit("b", "2026-10-08"),
    ]);
  });

  it("counts each step of activation by signup week", async () => {
    const { cohorts } = await readActivationBoard(env.DB, NOW);
    expect(cohorts).toEqual([
      { week: "2026-10-05", signed_up: 3, watching: 2, briefed: 2, came_back: 1, activated: 1 },
    ]);
  });

  it("does not count a visit before the first brief as coming back, or a feedback-less visit as doing something", async () => {
    await env.DB.exec("DELETE FROM entity WHERE id = 'e-a-2'");
    const { cohorts } = await readActivationBoard(env.DB, NOW);
    expect(cohorts[0]).toMatchObject({ came_back: 1, activated: 0 });
  });

  it("counts a feedback answer as doing something", async () => {
    await env.DB.exec("DELETE FROM entity WHERE id = 'e-a-2'");
    await env.DB.batch([answer("a", 1, "change_feedback:useful", "2026-10-13T09:00:00Z")]);
    const { cohorts } = await readActivationBoard(env.DB, NOW);
    expect(cohorts[0]).toMatchObject({ activated: 1 });
  });

  it("flags each at-risk signal once per workspace", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE workspace SET brief_paused_at = '2026-10-10T00:00:00Z' WHERE id = 'b'"),
      answer("c", 1, "change_feedback:not_useful", "2026-10-10T00:00:00Z"),
      answer("c", 2, "change_feedback:not_useful", "2026-10-10T01:00:00Z"),
      answer("c", 3, "change_feedback:not_useful", "2026-10-10T02:00:00Z"),
    ]);
    const { atRisk } = await readActivationBoard(env.DB, NOW);
    expect(atRisk).toEqual({
      live: 3,
      unseen: 1,
      unopened_brief: 1,
      paused: 1,
      few_rivals: 2,
      unhappy: 1,
      unreachable: 0,
      any: 2,
      two_or_more: 2,
    });
  });

  it("flags a suppressed owner address and a failed last brief as unreachable", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO channel (id, key, is_enabled) VALUES ('chan-email', 'email', 1) ON CONFLICT DO NOTHING`,
      ),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
         VALUES ('t-a', 'a', 'chan-email', 'a@example.test', 1, '2026-10-06T10:00:00Z', 'owner')`,
      ),
      env.DB.prepare(
        `INSERT INTO email_suppression (address, reason, created_at) VALUES ('a@example.test', 'x', '2026-10-10')`,
      ),
      env.DB.prepare("UPDATE digest SET status = 'failed' WHERE workspace_id = 'b'"),
    ]);
    const { atRisk } = await readActivationBoard(env.DB, NOW);
    expect(atRisk.unreachable).toBe(2);
  });

  it("holds no address or name anywhere in what it returns", async () => {
    const board = JSON.stringify(await readActivationBoard(env.DB, NOW));
    expect(board).not.toMatch(/@|example/);
  });
});
