import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { saveCompetitorName } from "../../app/lib/competitor-name.server";

const NOW = "2026-10-14T08:00:00.000Z";

async function nameOf(id: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT name FROM entity WHERE id = ?").bind(id).first<{ name: string | null }>();
  return row === null ? null : row.name;
}

describe("saveCompetitorName", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch(
      ["a", "b"].flatMap((suffix) => [
        env.DB.prepare(
          `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES (?, 'Owner', ?, 1, ?, ?)`,
        ).bind(`user-${suffix}`, `${suffix}@0509.io`, NOW, NOW),
        env.DB.prepare(
          `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
           VALUES (?, 'W', ?, 'UTC', 1, 8, ?)`,
        ).bind(`ws-${suffix}`, `user-${suffix}`, NOW),
        env.DB.prepare(
          `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
           VALUES (?, ?, 'competitor', ?, 'Old Name', 'on', ?)`,
        ).bind(`ent-${suffix}`, `ws-${suffix}`, `${suffix}.example`, NOW),
      ]),
    );
  });

  it("renames the competitor and leaves its domain and state alone", async () => {
    expect(await saveCompetitorName("ws-a", "ent-a", "  Kindred   Goods ")).toEqual({ ok: true });
    expect(await nameOf("ent-a")).toBe("Kindred Goods");
    const row = await env.DB.prepare("SELECT domain, state FROM entity WHERE id = 'ent-a'").first();
    expect(row).toEqual({ domain: "a.example", state: "on" });
  });

  it("keeps the old name when the new one is refused", async () => {
    expect(await saveCompetitorName("ws-a", "ent-a", "   ")).toMatchObject({ ok: false });
    expect(await nameOf("ent-a")).toBe("Old Name");
  });

  it("never renames another workspace's competitor", async () => {
    await expect(saveCompetitorName("ws-a", "ent-b", "Hijacked")).rejects.toBeInstanceOf(Response);
    expect(await nameOf("ent-b")).toBe("Old Name");
  });

  it("never renames the own brand", async () => {
    await env.DB.exec("UPDATE entity SET role = 'self' WHERE id = 'ent-a'");
    await expect(saveCompetitorName("ws-a", "ent-a", "Mine")).rejects.toBeInstanceOf(Response);
    expect(await nameOf("ent-a")).toBe("Old Name");
  });
});
