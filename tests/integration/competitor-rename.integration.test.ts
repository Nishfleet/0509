import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { saveCompetitorName } from "../../app/lib/competitor-name.server";
import { readActiveWatches } from "../../app/lib/data/watch.server";

const NOW = "2026-10-14T08:00:00.000Z";

async function nameOf(id: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT name FROM entity WHERE id = ?").bind(id).first<{ name: string | null }>();
  return row === null ? null : row.name;
}

describe("saveCompetitorName", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM source WHERE id LIKE 'rename-%'");
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
  describe("the mentions search follows the name", () => {
    const mentionKeys = async (): Promise<string[]> =>
      (await readActiveWatches("mentions"))
        .filter((row) => row.source_id === "rename-mentions" && row.entity_id === "ent-a")
        .map((row) => row.target_key);

    const activeFlags = async (): Promise<Record<string, number>> => {
      const rows = await env.DB.prepare(
        "SELECT target_key, is_active FROM watch WHERE entity_id = 'ent-a' AND source_id = 'rename-mentions'",
      ).all<{ target_key: string; is_active: number }>();
      return Object.fromEntries(rows.results.map((row) => [row.target_key, row.is_active]));
    };

    beforeEach(async () => {
      await env.DB.prepare(
        "INSERT INTO source (id, key, kind, platform, plugin_key, is_enabled) VALUES ('rename-mentions', 'test.rename-mentions', 'mentions', 'free-mentions', 'test.free', 1)",
      ).run();
      await env.DB.prepare(
        `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at)
         VALUES ('rename-sig', 'ws-a', 'ent-a', 'rename-mentions', 'mention', 'Found before', 'https://example.test/m', 'https://example.test/m', 'rename-hash', 'rename-dedup', ?)`,
      )
        .bind(NOW)
        .run();
      expect(await mentionKeys()).toEqual(["Old Name"]);
    });

    it("searches only the new name and switches the old name's watch off", async () => {
      await saveCompetitorName("ws-a", "ent-a", "Kindred Goods");
      expect(await mentionKeys()).toEqual(["Kindred Goods"]);
      expect(await activeFlags()).toEqual({ "Old Name": 0, "Kindred Goods": 1 });
    });

    it("never grows the active watches across repeated renames", async () => {
      for (const name of ["One", "Two", "Three"]) {
        await saveCompetitorName("ws-a", "ent-a", name);
        await mentionKeys();
      }
      const active = Object.values(await activeFlags()).filter((flag) => flag === 1);
      expect(active).toHaveLength(1);
    });

    it("keeps the mentions already found on the rival", async () => {
      await saveCompetitorName("ws-a", "ent-a", "Kindred Goods");
      const row = await env.DB.prepare("SELECT entity_id, is_tombstoned FROM signal WHERE id = 'rename-sig'").first();
      expect(row).toEqual({ entity_id: "ent-a", is_tombstoned: 0 });
    });

    it("searches again under the old name when the customer renames back", async () => {
      await saveCompetitorName("ws-a", "ent-a", "Kindred Goods");
      await mentionKeys();
      await saveCompetitorName("ws-a", "ent-a", "Old Name");
      expect(await mentionKeys()).toEqual(["Old Name"]);
    });
  });
});
