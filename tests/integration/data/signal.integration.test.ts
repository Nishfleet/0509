import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readSeenDedupKeys, readSiteChanges } from "../../../app/lib/data/signal.server";

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
  for (const table of ["signal", "snapshot", "page", "watch", "entity", "source", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seedWorkspace("ws-a");
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES (?, ?, 'self', ?, 'on', ?)`,
  )
    .bind("ent-self", "ws-a", "ent-self.example", NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key) VALUES ('src_site_web', 'site-web', 'site', 'web', 'site-web')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES ('ent-rival', 'ws-a', 'competitor', 'rival.example', 'Rival', 'on', ?)`,
  )
    .bind(NOW)
    .run();
});

describe("readSeenDedupKeys", () => {
  it("returns only the dedup keys that exist for the given source", async () => {
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

describe("readSiteChanges", () => {
  async function insertChange(
    id: string,
    input: { url: string | null } = { url: `https://rival.example/${id}` },
  ): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at,
         is_tombstoned, title, url, payload_json)
       VALUES (?, 'ws-a', 'ent-rival', 'src_site_web', 'change', 'home', ?, '2026-09-24T00:00:00Z', 0, 'Pricing rewrote its hero', ?, '{}')`,
    )
      .bind(id, `dedup-${id}`, input.url)
      .run();
  }

  it("reads a change row whose url column is NULL", async () => {
    await insertChange("sig-null-url", { url: null });
    const rows = await readSiteChanges({
      workspaceId: "ws-a",
      entityId: null,
      since: "2026-09-01T00:00:00Z",
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBeNull();
    expect(rows[0].entity_role).toBe("competitor");
  });

  it("reads a change row that nobody has judged, with no verdict columns", async () => {
    await insertChange("sig-no-verdict");

    const rows = await readSiteChanges({
      workspaceId: "ws-a",
      entityId: null,
      since: "2026-09-01T00:00:00Z",
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].verdict_id).toBeNull();
    expect(rows[0].verdict_p).toBeNull();
    expect(rows[0].before_at).toBeNull();
    expect(rows[0].after_at).toBeNull();
  });
});
