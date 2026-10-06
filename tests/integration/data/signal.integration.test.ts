import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readSeenDedupKeys } from "../../../app/lib/data/signal.server";

const NOW = "2026-09-24T00:00:00Z";

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(`user-${id}`, "Owner", `${id}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`)
    .bind(id, "Owner", `user-${id}`, NOW)
    .run();
}

async function insertSignal(
  workspaceId: string,
  sourceId: string,
  id: string,
  dedupKey: string,
  state: "judged" | "unjudged" = "unjudged",
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, canonical_url, url_hash,
       payload_json, dedup_key, observed_at, state)
     VALUES (?, ?, 'ent-self', ?, 'mention', ?, ?, ?, '{}', ?, ?, ?)`,
  )
    .bind(id, workspaceId, sourceId, `Title ${id}`, `https://${id}.example`, `hash-${id}`, dedupKey, NOW, state)
    .run();
}

beforeEach(async () => {
  for (const table of ["signal", "entity", "source", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seedWorkspace("ws-a");
  await seedWorkspace("ws-b");
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES (?, ?, 'self', ?, 'on', ?)`,
  )
    .bind("ent-self", "ws-a", "self.example", NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES (?, ?, 'self', ?, 'on', ?)`,
  )
    .bind("ent-self-b", "ws-b", "self.example", NOW)
    .run();
});

describe("readSeenDedupKeys", () => {
  it("returns only the dedup keys that exist for the given source and workspace", async () => {
    await env.DB.prepare(`INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?, ?, 'mentions', ?, ?)`)
      .bind("src-a", "key-a", "gdelt", "plugin-a")
      .run();
    await env.DB.prepare(`INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?, ?, 'mentions', ?, ?)`)
      .bind("src-b", "key-b", "hn", "plugin-b")
      .run();

    await insertSignal("ws-a", "src-a", "sig-a1", "dk-a1");
    await insertSignal("ws-a", "src-a", "sig-a2", "dk-a2");
    await insertSignal("ws-a", "src-b", "sig-b1", "dk-b1");

    const seen = await readSeenDedupKeys("src-a", ["dk-a1", "dk-a2", "dk-missing", "dk-b1"]);

    expect(seen).toEqual(new Set(["dk-a1", "dk-a2"]));
  });

  it("returns an empty set when every key is unknown", async () => {
    await env.DB.prepare(`INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?, ?, 'mentions', ?, ?)`)
      .bind("src-a", "key-a", "gdelt", "plugin-a")
      .run();

    const seen = await readSeenDedupKeys("src-a", ["dk-nope-1", "dk-nope-2"]);

    expect(seen).toEqual(new Set());
  });

  it("returns an empty set without querying when the key list is empty", async () => {
    const seen = await readSeenDedupKeys("src-a", []);

    expect(seen).toEqual(new Set());
  });
});
