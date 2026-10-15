import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { deleteStoredPage } from "../../app/lib/account-delete.server";
import { readWorkspaceR2Prefixes } from "../../app/lib/data/workspace.server";

const NOW = "2026-10-05T00:00:00.000Z";
const MINE = [
  "card/ws-r2/rival.example.png",
  "snapshot/site/watch-r2/2026-10-05.html",
  "snapshot/site/watch-r2/diff-2026-10-05.json",
  "snapshot/hiring/watch-r2/snap.json",
  "snapshot/feed/watch-r2/snap.json",
];
const KEPT = ["logo/v3/rival.example", "card/ws-other/other.png", "snapshot/site/watch-other/other.html"];

async function seedWorkspace(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (\'u-r2\', \'r2\', \'r2@test.dev\', 1, ?1, ?1)',
    ).bind(NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES ('ws-r2', 'r2', 'u-r2', 'UTC', ?1)",
    ).bind(NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES ('ent-r2', 'ws-r2', 'competitor', 'rival.example', 'Rival', 'on', ?1)",
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES ('src-r2', 'site.r2', 'site', 'test', 'site.r2', 'best_effort', 1, '{}')`,
    ),
    env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key, cursor, last_polled_at, is_active, config_json)
       VALUES ('watch-r2', 'ent-r2', 'src-r2', 'rival.example', NULL, NULL, 1, '{}')`,
    ),
  ]);
}

async function storedKeys(): Promise<string[]> {
  const listed = await env.SNAPSHOTS.list();
  return listed.objects.map((object) => object.key).sort();
}

describe("workspace delete removes every workspace-scoped R2 object (0509#7080)", () => {
  it("empties each prefix the put paths write and leaves shared and other-workspace objects", async () => {
    await seedWorkspace();
    for (const key of [...MINE, ...KEPT]) await env.SNAPSHOTS.put(key, "x");

    for (const prefix of await readWorkspaceR2Prefixes("ws-r2")) await deleteStoredPage(prefix, null);

    expect(await storedKeys()).toEqual([...KEPT].sort());
  });
});
