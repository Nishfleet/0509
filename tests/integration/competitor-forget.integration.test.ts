import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetCompetitor } from "../../app/lib/competitor-forget.server";

const NOW = "2026-09-24T18:00:00.000Z";

async function seedWorkspace(id: string, ownerUserId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Owner', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, ownerUserId, NOW)
    .run();
}

async function seedEntity(row: {
  id: string;
  workspaceId: string;
  role: "self" | "competitor";
  domain: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?, ?, ?, ?, 'Brand', 'on', ?)`,
  )
    .bind(row.id, row.workspaceId, row.role, row.domain, NOW)
    .run();
}

async function seedTrackedEntity(row: {
  id: string;
  workspaceId: string;
  role: "self" | "competitor";
  domain: string;
}): Promise<void> {
  await seedEntity(row);
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json)
     VALUES (?, ?, 'src_site_web', ?, 1, '{}')`,
  )
    .bind(`watch-${row.id}`, row.id, row.domain)
    .run();
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
     VALUES (?, ?, NULL, ?, ?, 'hash', 1)`,
  )
    .bind(`snapshot-${row.id}`, `watch-${row.id}`, NOW, `snapshot/site/watch-${row.id}/page.html`)
    .run();
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, aspect,
                         payload_json, dedup_key, observed_at, last_seen_at, is_tombstoned)
     VALUES (?, ?, ?, 'src_site_web', ?, ?, 'change', 'pricing', '{}', ?, ?, ?, 0)`,
  )
    .bind(
      `signal-${row.id}`,
      row.workspaceId,
      row.id,
      `watch-${row.id}`,
      `snapshot-${row.id}`,
      `dedup-${row.id}`,
      NOW,
      NOW,
    )
    .run();
}

async function count(table: "signal" | "snapshot", id: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM workspace").run();
  await env.DB.prepare('DELETE FROM "user"').run();
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-forget-a', 'Owner A', 'a@example.com', 1, ?, ?),
            ('user-forget-b', 'Owner B', 'b@example.com', 1, ?, ?)`,
  )
    .bind(NOW, NOW, NOW, NOW)
    .run();
  await seedWorkspace("workspace-a", "user-forget-a");
  await seedWorkspace("workspace-b", "user-forget-b");
  await seedTrackedEntity({ id: "competitor-a", workspaceId: "workspace-a", role: "competitor", domain: "rival.example" });
  await seedTrackedEntity({ id: "competitor-b", workspaceId: "workspace-b", role: "competitor", domain: "rival.example" });
  await seedTrackedEntity({ id: "self-a", workspaceId: "workspace-a", role: "self", domain: "own-brand.example" });
});

afterEach(() => {
  Reflect.deleteProperty(env, "ACCOUNT_DELETE");
});

describe("forgetCompetitor", () => {
  it("turns off and forgets one competitor without touching another workspace or the own brand", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await expect(forgetCompetitor("workspace-a", "competitor-a", NOW)).resolves.toBe(true);

    expect(await count("signal", "signal-competitor-a")).toBe(0);
    expect(await count("snapshot", "snapshot-competitor-a")).toBe(0);
    expect(
      await env.DB.prepare("SELECT state, state_changed_at FROM entity WHERE id = 'competitor-a'").first(),
    ).toEqual({ state: "off", state_changed_at: NOW });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM watch WHERE id = 'watch-competitor-a'").first(),
    ).toEqual({ n: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ params: { prefixes: ["snapshot/site/watch-competitor-a/"] } });

    expect(await count("signal", "signal-competitor-b")).toBe(1);
    expect(await count("snapshot", "snapshot-competitor-b")).toBe(1);
    expect(
      await env.DB.prepare("SELECT state FROM entity WHERE id = 'competitor-b'").first(),
    ).toEqual({ state: "on" });
    expect(await count("signal", "signal-self-a")).toBe(1);
    expect(await count("snapshot", "snapshot-self-a")).toBe(1);
  });

  it("does nothing when the entity belongs to another workspace", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await expect(forgetCompetitor("workspace-a", "competitor-b", NOW)).resolves.toBe(false);

    expect(await count("signal", "signal-competitor-a")).toBe(1);
    expect(await count("snapshot", "snapshot-competitor-a")).toBe(1);
    expect(await count("signal", "signal-competitor-b")).toBe(1);
    expect(await count("snapshot", "snapshot-competitor-b")).toBe(1);
    expect(
      await env.DB.prepare("SELECT state FROM entity WHERE id = 'competitor-b'").first(),
    ).toEqual({ state: "on" });
    expect(create).not.toHaveBeenCalled();
  });

  it("never forgets the own brand", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await expect(forgetCompetitor("workspace-a", "self-a", NOW)).resolves.toBe(false);

    expect(await count("signal", "signal-self-a")).toBe(1);
    expect(await count("snapshot", "snapshot-self-a")).toBe(1);
    expect(
      await env.DB.prepare("SELECT state, state_changed_at FROM entity WHERE id = 'self-a'").first(),
    ).toEqual({ state: "on", state_changed_at: null });
    expect(create).not.toHaveBeenCalled();
  });
});
