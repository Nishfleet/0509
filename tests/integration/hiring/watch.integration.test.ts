import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deactivateWatch,
  insertWatches,
  readEntitiesWithoutHiringWatch,
  readHiringTargets,
} from "../../../app/lib/data/watch.server";

const USER = "user-hiring-watch";
const WS = "ws-hiring-watch";
const NOW = "2026-09-24T02:00:00Z";

const ON_SOURCE = "test-hiring-on";
const OFF_SOURCE = "test-hiring-off";

const GREENHOUSE_BOARD = "https://boards.greenhouse.io/a";
const LEVER_BOARD = "https://jobs.lever.co/b";

const seedEntity = (id: string, domain: string, state: "on" | "off") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', ?, '{}', 'manual', ?, ?)`,
  )
    .bind(id, WS, domain, state, NOW)
    .run();

const eligibleIds = async () => (await readEntitiesWithoutHiringWatch()).map((row) => row.id);

describe("hiring board watches", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec("DELETE FROM source WHERE id LIKE 'test-hiring-%'");

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'hiring-watch@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Hiring', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();

    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, is_enabled)
       VALUES ('test-hiring-on', 'test.hiring.on', 'hiring', 'greenhouse', 'test-hiring-on', 1),
              ('test-hiring-off', 'test.hiring.off', 'hiring', 'lever', 'test-hiring-off', 0)`,
    ).run();

    await seedEntity("ent-a", "a.example", "on");
    await seedEntity("ent-b", "b.example", "on");
    await seedEntity("ent-off", "off.example", "off");
  });

  it("offers every on entity before any watch exists and never the off one", async () => {
    const rows = await readEntitiesWithoutHiringWatch();

    expect(rows.map((row) => [row.id, row.domain])).toEqual([
      ["ent-a", "a.example"],
      ["ent-b", "b.example"],
    ]);
    expect(rows.map((row) => row.id)).not.toContain("ent-off");
  });

  it("withdraws a watched entity and restores it when the watch is deactivated", async () => {
    await insertWatches([
      { id: "w-a", entityId: "ent-a", sourceId: ON_SOURCE, targetKey: GREENHOUSE_BOARD },
    ]);

    expect(await eligibleIds()).toEqual(["ent-b"]);

    await deactivateWatch("w-a");

    expect(await eligibleIds()).toEqual(["ent-a", "ent-b"]);
  });

  it("ignores a watch whose hiring source is disabled", async () => {
    await insertWatches([
      { id: "w-b", entityId: "ent-b", sourceId: OFF_SOURCE, targetKey: LEVER_BOARD },
    ]);

    expect(await eligibleIds()).toEqual(["ent-a", "ent-b"]);
    expect(await readHiringTargets()).toEqual([]);
  });

  it("reads the active target with its platform while the watch is active", async () => {
    await insertWatches([
      { id: "w-a", entityId: "ent-a", sourceId: ON_SOURCE, targetKey: GREENHOUSE_BOARD },
    ]);

    expect(await readHiringTargets()).toEqual([
      {
        workspaceId: WS,
        entityId: "ent-a",
        sourceId: ON_SOURCE,
        platform: "greenhouse",
        watchId: "w-a",
        boardUrl: GREENHOUSE_BOARD,
      },
    ]);

    await deactivateWatch("w-a");

    expect(await readHiringTargets()).toEqual([]);
  });
});
