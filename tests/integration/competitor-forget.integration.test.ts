import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetCompetitor } from "../../app/lib/competitor-forget.server";
import { writeDiscoveryResults } from "../../app/lib/data/suggestion.server";

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

async function count(table: "entity" | "watch" | "snapshot" | "signal" | "alert", id: string): Promise<number> {
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
  await env.DB.prepare(
    `INSERT INTO alert (id, workspace_id, entity_id, kind, title, created_at)
     VALUES ('alert-competitor-a', 'workspace-a', 'competitor-a', 'competitor_retired', 'Rival retired', ?)`,
  )
    .bind(NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, candidate_name, evidence_json,
                             verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
     VALUES ('suggestion-competitor-a', 'workspace-a', 'competitor-a', 'add', 'rival.example', 'Brand',
             '{"evidence":[]}', 0.95, 'Same buyers', 'accepted', 'user', ?, ?)`,
  )
    .bind(NOW, NOW)
    .run();
});

afterEach(() => {
  Reflect.deleteProperty(env, "ACCOUNT_DELETE");
});

describe("forgetCompetitor", () => {
  it("deletes the competitor and everything under it, and queues its screenshots", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await expect(forgetCompetitor("workspace-a", "competitor-a", "  bRAND ")).resolves.toBe("forgotten");

    expect(await count("entity", "competitor-a")).toBe(0);
    expect(await count("watch", "watch-competitor-a")).toBe(0);
    expect(await count("snapshot", "snapshot-competitor-a")).toBe(0);
    expect(await count("signal", "signal-competitor-a")).toBe(0);
    expect(await count("alert", "alert-competitor-a")).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT entity_id, kind, status, decided_by, evidence_json, verdict_p, verdict_reason FROM suggestion WHERE id = 'suggestion-competitor-a'",
      ).first(),
    ).toEqual({
      entity_id: null,
      kind: "add",
      status: "dismissed",
      decided_by: "user",
      evidence_json: "{}",
      verdict_p: null,
      verdict_reason: null,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ params: { prefixes: ["snapshot/site/watch-competitor-a/"] } });

    expect(await count("entity", "competitor-b")).toBe(1);
    expect(await count("watch", "watch-competitor-b")).toBe(1);
    expect(await count("snapshot", "snapshot-competitor-b")).toBe(1);
    expect(await count("signal", "signal-competitor-b")).toBe(1);
    expect(await count("entity", "self-a")).toBe(1);
    expect(await count("snapshot", "snapshot-self-a")).toBe(1);
    expect(await count("signal", "signal-self-a")).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace WHERE id = 'workspace-a'").first(),
    ).toEqual({ n: 1 });
  });

  it("remembers the no, so discovery cannot add the brand back", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await env.DB.prepare("DELETE FROM suggestion WHERE id = 'suggestion-competitor-a'").run();
    await expect(forgetCompetitor("workspace-a", "competitor-a", "Brand")).resolves.toBe("forgotten");

    expect(
      await env.DB.prepare(
        "SELECT candidate_name, kind, status, decided_by FROM suggestion WHERE workspace_id = 'workspace-a' AND candidate_domain = 'rival.example'",
      ).first(),
    ).toEqual({ candidate_name: "Brand", kind: "add", status: "dismissed", decided_by: "user" });

    await writeDiscoveryResults(
      "workspace-a",
      [
        {
          name: "Brand",
          domain: "rival.example",
          evidence: [],
          line: "Sells the same thing",
          verdict: { questionId: "q-discovery", inputHash: "h", p: 0.99, cached: true },
        },
      ],
      NOW,
    );
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM entity WHERE workspace_id = 'workspace-a' AND domain = 'rival.example'",
      ).first(),
    ).toEqual({ n: 0 });
  });

  it("keeps everything when the typed name does not match", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await expect(forgetCompetitor("workspace-a", "competitor-a", "Rival")).resolves.toBe("mismatch");

    expect(await count("entity", "competitor-a")).toBe(1);
    expect(await count("signal", "signal-competitor-a")).toBe(1);
    expect(await count("snapshot", "snapshot-competitor-a")).toBe(1);
    expect(
      await env.DB.prepare("SELECT status FROM suggestion WHERE id = 'suggestion-competitor-a'").first(),
    ).toEqual({ status: "accepted" });
    expect(create).not.toHaveBeenCalled();
  });

  it("does nothing when the entity belongs to another workspace", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await expect(forgetCompetitor("workspace-a", "competitor-b", "Brand")).resolves.toBe("missing");

    expect(await count("entity", "competitor-b")).toBe(1);
    expect(await count("signal", "signal-competitor-b")).toBe(1);
    expect(await count("snapshot", "snapshot-competitor-b")).toBe(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("never forgets the own brand", async () => {
    const create = vi.fn(() => Promise.resolve({ id: "account-delete" }));
    Reflect.set(env, "ACCOUNT_DELETE", { create });

    await expect(forgetCompetitor("workspace-a", "self-a", "Brand")).resolves.toBe("missing");

    expect(await count("entity", "self-a")).toBe(1);
    expect(await count("signal", "signal-self-a")).toBe(1);
    expect(await count("snapshot", "snapshot-self-a")).toBe(1);
    expect(create).not.toHaveBeenCalled();
  });
});
