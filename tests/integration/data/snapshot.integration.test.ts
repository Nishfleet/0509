import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { latestSiteSnapshot, readCoveredPagePairs } from "../../../app/lib/data/snapshot.server";

const NOW = "2026-09-24T00:00:00Z";
const FETCHED_AT = "2026-09-22T10:00:00.000Z";
const BEFORE = "2026-09-23T00:00:00.000Z";

beforeEach(async () => {
  for (const table of ["snapshot", "page", "watch", "source", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind("user-ws-a", "Owner", "ws-a@0509.io", NOW, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`)
    .bind("ws-a", "Owner", "user-ws-a", NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES (?, ?, 'self', ?, 'on', ?)`,
  )
    .bind("e-a", "ws-a", "self.example", NOW)
    .run();
  await env.DB.prepare(`INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?, ?, 'site', ?, ?)`)
    .bind("src-a", "site.web", "web", "site")
    .run();
  await env.DB.prepare(`INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES (?, ?, ?, ?, 1)`)
    .bind("w-a", "e-a", "src-a", "https://self.example/")
    .run();
  await env.DB.prepare(`INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?, ?, ?, ?)`)
    .bind("p-a", "e-a", "https://self.example/", NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind("snap-a", "w-a", "p-a", FETCHED_AT, "r2/snap-a", "hash-a")
    .run();
});

describe("latestSiteSnapshot", () => {
  it("returns the newest snapshot for the watch and page before the cutoff", async () => {
    expect(await latestSiteSnapshot("w-a", "p-a", BEFORE)).toEqual({
      id: "snap-a",
      payload_hash: "hash-a",
      payload_r2_key: "r2/snap-a",
    });
  });
});

describe("readCoveredPagePairs", () => {
  it("returns the watch and page pair from a stored snapshot", async () => {
    expect(await readCoveredPagePairs("2026-09-22T00:00:00.000Z", ["w-a"])).toEqual([
      { watchId: "w-a", pageId: "p-a" },
    ]);
  });
});
