import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { isAdminEmail, requireAdmin } from "../../app/lib/admin.server";
import { readRetentionBoard } from "../../app/lib/data/retention_board.server";
import { touchWorkspaceSeen } from "../../app/lib/data/workspace.server";

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
];

const plan = (workspaceId: string, status: string, trialing: number, updatedAt = "2026-10-01T00:00:00Z") =>
  env.DB.prepare(
    `INSERT INTO plan (id, workspace_id, tier, status, trialing, updated_at) VALUES (?1, ?2, 'starter', ?3, ?4, ?5)`,
  ).bind(`p-${workspaceId}`, workspaceId, status, trialing, updatedAt);

const sent = (id: string, workspaceId: string, key: string, at: string) =>
  env.DB.prepare(
    `INSERT INTO send_attempt (id, workspace_id, idempotency_key, status, attempted_at) VALUES (?1, ?2, ?3, 'sent', ?4)`,
  ).bind(id, workspaceId, key, at);

const visit = (workspaceId: string, day: string) =>
  env.DB.prepare("INSERT INTO workspace_visit (workspace_id, day) VALUES (?1, ?2)").bind(workspaceId, day);

describe("retention board", () => {
  beforeEach(async () => {
    for (const table of ["send_attempt", "workspace_visit", "plan", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      ...workspace("a", "2026-09-29T10:00:00Z", "2026-10-13T08:00:00Z"),
      ...workspace("b", "2026-09-30T10:00:00Z", "2026-09-20T08:00:00Z"),
      ...workspace("c", "2026-10-01T10:00:00Z", "2026-10-06T08:00:00Z"),
      ...workspace("d", "2026-10-02T10:00:00Z", null),
      ...workspace("e", "2026-10-08T10:00:00Z", "2026-10-12T08:00:00Z"),
      plan("a", "active", 0),
      plan("b", "active", 0),
      plan("c", "cancelled", 0, "2026-10-09T00:00:00Z"),
      plan("e", "active", 1),
      sent("s1", "a", "digest:d1:t1", "2026-10-13T06:00:00Z"),
      sent("s2", "b", "digest:d2:t2", "2026-10-13T06:00:00Z"),
      sent("s3", "a", "welcome:a", "2026-10-02T06:00:00Z"),
      sent("s4", "a", "change:x", "2026-08-01T06:00:00Z"),
      visit("a", "2026-10-13"),
      visit("b", "2026-10-20"),
    ]);
  });

  it("counts the funnel by signup week", async () => {
    const { funnel } = await readRetentionBoard(NOW);
    expect(funnel).toEqual([
      { week: "2026-10-05", signed_up: 1, started: 1, trialing: 1, paying: 0, cancelled: 0 },
      { week: "2026-09-28", signed_up: 4, started: 3, trialing: 0, paying: 2, cancelled: 1 },
    ]);
  });

  it("buckets live workspaces by when they were last seen", async () => {
    const { lastSeen } = await readRetentionBoard(NOW);
    expect(lastSeen).toEqual({ week: 2, drifting: 0, away: 1, never: 0 });
  });

  it("counts cancellations by month", async () => {
    const { cancellations } = await readRetentionBoard(NOW);
    expect(cancellations).toEqual([{ month: "2026-10", cancelled: 1 }]);
  });

  it("says which emails were followed by a visit that day or the next, within 30 days", async () => {
    const { emails } = await readRetentionBoard(NOW);
    expect(emails).toEqual([
      { kind: "digest", sent: 2, visited: 1 },
      { kind: "welcome", sent: 1, visited: 0 },
    ]);
  });

  it("holds no address or name anywhere in what it returns", async () => {
    const board = JSON.stringify(await readRetentionBoard(NOW));
    expect(board).not.toMatch(/@|example\.test/);
  });
});

describe("recording visits", () => {
  beforeEach(async () => {
    for (const table of ["workspace_visit", "workspace"]) await env.DB.exec(`DELETE FROM ${table}`);
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch(workspace("v", "2026-09-01T00:00:00Z", null));
  });

  it("writes one row for the first visit of a day and none for the rest of it", async () => {
    await touchWorkspaceSeen("v", new Date("2026-10-14T08:00:00.000Z"));
    await touchWorkspaceSeen("v", new Date("2026-10-14T20:00:00.000Z"));
    await touchWorkspaceSeen("v", new Date("2026-10-15T08:00:00.000Z"));
    const days = await env.DB.prepare("SELECT day FROM workspace_visit ORDER BY day").all();
    expect(days.results).toEqual([{ day: "2026-10-14" }, { day: "2026-10-15" }]);
  });
});

describe("the admin check", () => {
  it("lets in only the allowed address, in any letter case", async () => {
    expect(await isAdminEmail("admin@0509.io")).toBe(true);
    expect(await isAdminEmail("  Admin@0509.IO ")).toBe(true);
    expect(await isAdminEmail("someone@0509.io")).toBe(false);
  });

  it("answers anyone else with a plain 404", async () => {
    await expect(requireAdmin("someone@0509.io")).rejects.toMatchObject({ status: 404 });
    await expect(requireAdmin("admin@0509.io")).resolves.toBeUndefined();
  });
});
