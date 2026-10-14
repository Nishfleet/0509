import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetCompetitor } from "../../app/lib/competitor-forget.server";
import { saveCompetitorNote } from "../../app/lib/competitor-note.server";
import { readEntityNote, saveEntityNote } from "../../app/lib/data/entity_note.server";
import { NOTE_MAX, NOTE_TOO_LONG } from "../../app/lib/entity-note";

const NOW = "2026-10-14T06:00:00.000Z";

async function seed(tag: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?1, ?2, 1, ?3, ?3)',
    ).bind(`user-${tag}`, `${tag}@test.dev`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, 'UTC', ?4)",
    ).bind(`ws-${tag}`, tag, `user-${tag}`, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Rival', 'on', ?4)",
    ).bind(`rival-${tag}`, `ws-${tag}`, `${tag}.example`, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', ?3, 'Me', 'on', ?4)",
    ).bind(`self-${tag}`, `ws-${tag}`, `me-${tag}.example`, NOW),
  ]);
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM workspace").run();
  await env.DB.prepare('DELETE FROM "user"').run();
  await seed("a");
  await seed("b");
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(env, "ACCOUNT_DELETE");
});

describe("competitor notes", () => {
  it("saves, updates and reads one note per competitor", async () => {
    await saveCompetitorNote("ws-a", "rival-a", "  Discounts every Q4  ");
    expect(await readEntityNote("ws-a", "rival-a")).toBe("Discounts every Q4");
    await saveCompetitorNote("ws-a", "rival-a", "Discounts in Q4 and Q1");
    expect(await readEntityNote("ws-a", "rival-a")).toBe("Discounts in Q4 and Q1");
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM entity_note").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("clears the note when it is saved empty", async () => {
    await saveCompetitorNote("ws-a", "rival-a", "something");
    await saveCompetitorNote("ws-a", "rival-a", "   ");
    expect(await readEntityNote("ws-a", "rival-a")).toBe("");
  });

  it("refuses a note that is too long and keeps the old one", async () => {
    await saveCompetitorNote("ws-a", "rival-a", "keep me");
    const result = await saveCompetitorNote("ws-a", "rival-a", "x".repeat(NOTE_MAX + 1));
    expect(result).toEqual({ ok: false, message: NOTE_TOO_LONG });
    expect(await readEntityNote("ws-a", "rival-a")).toBe("keep me");
  });

  it("keeps a workspace's notes private to it", async () => {
    await saveCompetitorNote("ws-a", "rival-a", "secret plan");
    expect(await readEntityNote("ws-b", "rival-a")).toBe("");
    expect(await readEntityNote("ws-b", "rival-b")).toBe("");
    const crossed = await saveEntityNote({ workspaceId: "ws-b", entityId: "rival-a", body: "mine now", now: NOW });
    expect(crossed).toBe(false);
    expect(await readEntityNote("ws-a", "rival-a")).toBe("secret plan");
  });

  it("refuses an empty save for an id that is not one of its competitors", async () => {
    expect(await saveEntityNote({ workspaceId: "ws-a", entityId: "nope", body: "", now: NOW })).toBe(false);
    expect(await saveEntityNote({ workspaceId: "ws-a", entityId: "self-a", body: " ", now: NOW })).toBe(false);
    expect(await saveEntityNote({ workspaceId: "ws-b", entityId: "rival-a", body: "", now: NOW })).toBe(false);
    expect(await saveEntityNote({ workspaceId: "ws-a", entityId: "rival-a", body: "", now: NOW })).toBe(true);
  });

  it("only attaches to a competitor, not the own brand", async () => {
    const result = await saveCompetitorNote("ws-a", "self-a", "about me");
    expect(result.ok).toBe(false);
    expect(await readEntityNote("ws-a", "self-a")).toBe("");
  });

  it("is deleted with the competitor on Remove and forget, and with the workspace", async () => {
    Reflect.set(env, "ACCOUNT_DELETE", { create: vi.fn(() => Promise.resolve({ id: "x" })) });
    await saveCompetitorNote("ws-a", "rival-a", "gone with it");
    await saveCompetitorNote("ws-b", "rival-b", "stays");
    await expect(forgetCompetitor("ws-a", "rival-a", "Rival")).resolves.toBe("forgotten");
    expect(await readEntityNote("ws-a", "rival-a")).toBe("");
    expect(await readEntityNote("ws-b", "rival-b")).toBe("stays");
    await env.DB.prepare("DELETE FROM workspace WHERE id = 'ws-b'").run();
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM entity_note").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
