import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readCompetitor, setCompetitorState } from "../../app/lib/data/entity.server";
import { ensureWorkspace } from "../../app/lib/workspace.server";

const NOW = "2026-09-22T12:00:00.000Z";

async function seedWorkspace(userId: string, email: string): Promise<string> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(userId, email, email, NOW, NOW)
    .run();
  const workspace = await ensureWorkspace(env.DB, { userId, email, timezone: "UTC", now: NOW });
  return workspace.id;
}

async function insertEntity(row: {
  id: string;
  workspaceId: string;
  role: "self" | "competitor";
  domain: string;
  name?: string | null;
  state?: "on" | "off" | "dismissed";
}) {
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.workspaceId, row.role, row.domain, row.name ?? null, row.state ?? "on", NOW)
    .run();
}

async function entityRow(id: string) {
  return env.DB.prepare(
    "SELECT state, state_changed_at, state_changed_by, state_reason FROM entity WHERE id = ?",
  )
    .bind(id)
    .first<{
      state: string;
      state_changed_at: string | null;
      state_changed_by: string | null;
      state_reason: string | null;
    }>();
}

describe("entity data layer", () => {
  it("reads a competitor whose name is NULL as its domain", async () => {
    const ws = await seedWorkspace("user-es1", "es1@example.com");
    await insertEntity({
      id: "es1-comp",
      workspaceId: ws,
      role: "competitor",
      domain: "rival.example",
    });
    expect(await readCompetitor(ws, "es1-comp")).toEqual({
      id: "es1-comp",
      name: "rival.example",
      domain: "rival.example",
      state: "on",
      stateChangedAt: null,
    });
  });

  it("returns null for dismissed, self, and another workspace's rows", async () => {
    const ws = await seedWorkspace("user-es2", "es2@example.com");
    const other = await seedWorkspace("user-es2b", "es2b@example.com");
    await insertEntity({
      id: "es2-dismissed",
      workspaceId: ws,
      role: "competitor",
      domain: "gone.example",
      state: "dismissed",
    });
    await insertEntity({ id: "es2-self", workspaceId: ws, role: "self", domain: "mine.example" });
    await insertEntity({
      id: "es2-other",
      workspaceId: other,
      role: "competitor",
      domain: "theirs.example",
    });
    expect(await readCompetitor(ws, "es2-dismissed")).toBeNull();
    expect(await readCompetitor(ws, "es2-self")).toBeNull();
    expect(await readCompetitor(ws, "es2-other")).toBeNull();
    expect(await readCompetitor(ws, "es2-missing")).toBeNull();
    expect(await setCompetitorState(ws, "es2-missing", "off", "2026-09-23T09:00:00.000Z")).toBe(
      false,
    );
  });

  it("flips a competitor off, stamps the change, and no-ops on a repeat", async () => {
    const ws = await seedWorkspace("user-es3", "es3@example.com");
    await insertEntity({
      id: "es3-comp",
      workspaceId: ws,
      role: "competitor",
      domain: "flip.example",
      name: "Flip Co",
    });
    expect(await setCompetitorState(ws, "es3-comp", "off", "2026-09-23T09:00:00.000Z")).toBe(true);
    expect(await readCompetitor(ws, "es3-comp")).toMatchObject({
      state: "off",
      stateChangedAt: "2026-09-23T09:00:00.000Z",
    });
    expect(await entityRow("es3-comp")).toMatchObject({ state_changed_by: "user" });
    expect(await setCompetitorState(ws, "es3-comp", "off", "2026-09-23T09:01:00.000Z")).toBe(false);
    expect(await setCompetitorState(ws, "es3-comp", "on", "2026-09-23T09:02:00.000Z")).toBe(true);
    expect(await entityRow("es3-comp")).toMatchObject({
      state: "on",
      state_changed_at: "2026-09-23T09:02:00.000Z",
    });
  });

  it("never writes dismissed, self, or another workspace's rows", async () => {
    const ws = await seedWorkspace("user-es4", "es4@example.com");
    const other = await seedWorkspace("user-es4b", "es4b@example.com");
    await insertEntity({
      id: "es4-dismissed",
      workspaceId: ws,
      role: "competitor",
      domain: "dis.example",
      state: "dismissed",
    });
    await insertEntity({ id: "es4-self", workspaceId: ws, role: "self", domain: "self.example" });
    await insertEntity({
      id: "es4-other",
      workspaceId: other,
      role: "competitor",
      domain: "other.example",
    });
    expect(await setCompetitorState(ws, "es4-dismissed", "off", "2026-09-23T09:00:00.000Z")).toBe(false);
    expect(await setCompetitorState(ws, "es4-self", "off", "2026-09-23T09:00:00.000Z")).toBe(false);
    expect(await setCompetitorState(ws, "es4-other", "off", "2026-09-23T09:00:00.000Z")).toBe(false);
    expect(await entityRow("es4-dismissed")).toMatchObject({
      state: "dismissed",
      state_changed_at: null,
      state_changed_by: null,
    });
    expect(await entityRow("es4-self")).toMatchObject({
      state: "on",
      state_changed_at: null,
      state_changed_by: null,
    });
    expect(await entityRow("es4-other")).toMatchObject({
      state: "on",
      state_changed_at: null,
      state_changed_by: null,
    });
  });
});
