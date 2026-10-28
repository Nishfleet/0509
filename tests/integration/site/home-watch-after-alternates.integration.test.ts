import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readUnwatchedEntities } from "../../../app/lib/data/watch.server";

const NOW = "2026-10-12T21:00:00Z";
const USER = "user-home-watch";
const WS = "ws-home-watch";
const BLOCKED = "ent-home-watch-blocked";
const WATCHED = "ent-home-watch-watched";
const ALTERNATE = '{"alternateHome":1,"at":"2026-10-12T21:00:04.446Z","reason":"escalation-failed"}';

async function seedEntity(id: string, domain: string, watchUrl: string, config: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?3, '{}', 'auto', 'on', ?4)",
    ).bind(id, WS, domain, NOW),
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json) VALUES (?1, ?2, 'src_site_web', ?3, ?4, ?5)",
    ).bind(`w-${id}`, id, watchUrl, config === ALTERNATE ? 0 : 1, config),
  ]);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WS),
    env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      NOW,
    ),
  ]);
});

describe("the home watch for a rival that only has alternate-home attempts", () => {
  it("is still planned, while a rival with its own home watch is not", async () => {
    await seedEntity(BLOCKED, "blocked-rival.com", "https://news.blocked-rival.com/", ALTERNATE);
    await seedEntity(WATCHED, "watched-rival.com", "https://watched-rival.com/", "{}");

    const rows = (await readUnwatchedEntities("src_site_web")).filter(
      (row) => row.id === BLOCKED || row.id === WATCHED,
    );

    expect(rows.map((row) => row.id)).toEqual([BLOCKED]);
  });
});
