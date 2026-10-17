import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { upsertJudgedPages, type JudgedPage } from "../../../app/lib/data/page.server";
import { storeTailHome } from "../../../app/lib/identity/tail.server";
import migration from "../../../migrations/0071_one_home_per_rival.sql?raw";

const NOW = "2026-10-17T04:00:00.000Z";
const ENTITY = "e-one-home";

function judged(url: string, role: JudgedPage["role"]): JudgedPage {
  return { id: `p-${url}`, entityId: ENTITY, url, title: "t", role, roleDecidedForHash: "h", discoveredAt: NOW };
}

async function roles(): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare("SELECT url, role FROM page ORDER BY url").all();
  return Object.fromEntries(results.map((row) => [row.url, row.role]));
}

beforeEach(async () => {
  const userId = "u-one-home";
  const workspaceId = "ws-one-home";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entity WHERE id = ?1").bind(ENTITY),
    env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(workspaceId),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(userId),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(userId, "Owner", "one-home@0509.io", NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'W', ?2, ?3)").bind(
      workspaceId,
      userId,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'linear.app', 'Linear', '{}', 'manual', 'on', ?3)",
    ).bind(ENTITY, workspaceId, NOW),
  ]);
});

describe("one home page per entity", () => {
  it("keeps the judged home when the entity has none, and stores a second home as other", async () => {
    await upsertJudgedPages([judged("https://linear.app/", "home")]);
    await upsertJudgedPages([judged("https://linear.app/homepage", "home"), judged("https://linear.app/now", "home")]);
    expect(await roles()).toEqual({
      "https://linear.app/": "home",
      "https://linear.app/homepage": "other",
      "https://linear.app/now": "other",
    });
  });

  it("keeps the real home stored first by the tail, and stores judged strays as other", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO source (id, key, plugin_key, platform, is_enabled) VALUES ('src_site_web', 'site.web', 'site.page', 'web', 1)",
    ).run();
    await storeTailHome(
      {
        workspaceId: "ws-one-home",
        entityId: ENTITY,
        name: "Linear",
        domain: "linear.app",
        homepageUrl: "https://linear.app/en-gb/",
      },
      NOW,
    );
    await upsertJudgedPages([judged("https://linear.app/homepage", "home"), judged("https://linear.app/", "home")]);
    expect(await roles()).toEqual({
      "https://linear.app/": "other",
      "https://linear.app/en-gb/": "home",
      "https://linear.app/homepage": "other",
    });
  });

  it("lets the judge re-decide the one home page", async () => {
    await upsertJudgedPages([judged("https://linear.app/", "home")]);
    await upsertJudgedPages([judged("https://linear.app/", "home")]);
    expect(await roles()).toEqual({ "https://linear.app/": "home" });
  });

  it("migration keeps the home the judge never touched over a stray judged root", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('w1', ?1, 'https://brand.example/en-gb/', 'home', ?2)",
      ).bind(ENTITY, NOW),
      env.DB.prepare(
        "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES ('w2', ?1, 'https://brand.example/', 'home', 'h', ?2)",
      ).bind(ENTITY, NOW),
    ]);
    await env.DB.exec(migration.replace(/--.*\n/g, "").replace(/\s+/g, " "));
    expect(await roles()).toEqual({ "https://brand.example/": "other", "https://brand.example/en-gb/": "home" });
  });

  it("migration keeps a watched home over an unjudged site root", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('v1', ?1, 'https://brand.example/', 'home', ?2), ('v2', ?1, 'https://brand.example/en-gb/', 'home', ?2)",
      ).bind(ENTITY, NOW),
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json) VALUES ('wv', ?1, 'src_site_web', 'https://brand.example/en-gb/', 1, '{}')",
      ).bind(ENTITY),
    ]);
    await env.DB.exec(migration.replace(/--.*\n/g, "").replace(/\s+/g, " "));
    expect(await roles()).toEqual({ "https://brand.example/": "other", "https://brand.example/en-gb/": "home" });
  });

  it("migration demotes stray homes already stored and keeps the site root", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('a', ?1, 'https://linear.app/now', 'home', ?2), ('b', ?1, 'https://www.linear.app/', 'home', ?2), ('c', ?1, 'https://linear.app/homepage', 'home', ?2)",
      ).bind(ENTITY, NOW),
    ]);
    await env.DB.exec(migration.replace(/--.*\n/g, "").replace(/\s+/g, " "));
    expect(await roles()).toEqual({
      "https://linear.app/homepage": "other",
      "https://linear.app/now": "other",
      "https://www.linear.app/": "home",
    });
  });
});
