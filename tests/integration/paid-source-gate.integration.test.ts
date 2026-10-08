import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  readActiveWatches,
  readHiringTargets,
  readSiteSweepTarget,
  readSiteSweepTargets,
} from "../../app/lib/data/watch.server";

const NOW = "2026-10-08T02:00:00Z";
const PAID_PLUGIN = "scraper.paid";
const FREE_PLUGIN = "test.free";

const SCOUT = { user: "user-paid-gate-scout", ws: "ws-paid-gate-scout", entity: "ent-paid-gate-scout" };
const STARTER = { user: "user-paid-gate-starter", ws: "ws-paid-gate-starter", entity: "ent-paid-gate-starter" };

type Account = typeof SCOUT;

async function seedAccount(account: Account, tier: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(account.user, `${account.user}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Gate', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(account.ws, account.user, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', ?, ?, '{}', 'manual', 'on', ?)`,
  )
    .bind(account.entity, account.ws, `${account.entity}.example`, `${account.entity}.example`, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`)
    .bind(`page-${account.entity}`, account.entity, `https://${account.entity}.example/`, NOW)
    .run();
  if (tier === null) return;
  await env.DB.prepare(
    `INSERT INTO plan (id, workspace_id, tier, status, limits_json, updated_at) VALUES (?, ?, ?, 'active', '{}', ?)`,
  )
    .bind(`plan-${account.ws}`, account.ws, tier, NOW)
    .run();
}

async function seedSource(id: string, kind: string, platform: string, plugin: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO source (id, key, kind, platform, plugin_key, is_enabled) VALUES (?, ?, ?, ?, ?, 1)`)
    .bind(id, `test.${id}`, kind, platform, plugin)
    .run();
}

async function seedWatch(id: string, account: Account, sourceId: string, target: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO watch (id, entity_id, source_id, target_key, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, account.entity, sourceId, target, NOW)
    .run();
}

const siteTarget = (account: Account) => `https://${account.entity}.example/`;
const mentionTarget = (account: Account) => `${account.entity}.example`;

describe("paid scraper sources stay behind the plan (0509#7062)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM plan");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec("DELETE FROM source WHERE id LIKE 'paidgate-%'");

    await seedAccount(SCOUT, null);
    await seedAccount(STARTER, "starter");

    await seedSource("paidgate-mentions-paid", "mentions", "paid-mentions", PAID_PLUGIN);
    await seedSource("paidgate-mentions-free", "mentions", "free-mentions", FREE_PLUGIN);
    await seedSource("paidgate-hiring-paid", "hiring", "paid-hiring", PAID_PLUGIN);
    await seedSource("paidgate-hiring-free", "hiring", "free-hiring", FREE_PLUGIN);
    await seedSource("paidgate-site-paid", "site", "paid-site", PAID_PLUGIN);
    await seedSource("paidgate-site-free", "site", "free-site", FREE_PLUGIN);

    for (const account of [SCOUT, STARTER]) {
      await seedWatch(`w-mp-${account.ws}`, account, "paidgate-mentions-paid", mentionTarget(account));
      await seedWatch(`w-mf-${account.ws}`, account, "paidgate-mentions-free", mentionTarget(account));
      await seedWatch(`w-hp-${account.ws}`, account, "paidgate-hiring-paid", "https://jobs.example/board");
      await seedWatch(`w-hf-${account.ws}`, account, "paidgate-hiring-free", "https://jobs.example/board");
      await seedWatch(`w-sp-${account.ws}`, account, "paidgate-site-paid", siteTarget(account));
      await seedWatch(`w-sf-${account.ws}`, account, "paidgate-site-free", siteTarget(account));
    }
  });

  it("gives a Scout workspace only free mention watches", async () => {
    const rows = (await readActiveWatches("mentions")).filter((row) => row.source_id.startsWith("paidgate-"));

    expect(rows.map((row) => [row.workspace_id, row.plugin_key]).sort()).toEqual([
      [SCOUT.ws, FREE_PLUGIN],
      [STARTER.ws, PAID_PLUGIN],
      [STARTER.ws, FREE_PLUGIN],
    ]);
  });

  it("gives a Scout workspace only free hiring targets", async () => {
    const targets = await readHiringTargets();

    expect(targets.map((row) => row.watchId).sort()).toEqual([
      `w-hf-${SCOUT.ws}`,
      `w-hf-${STARTER.ws}`,
      `w-hp-${STARTER.ws}`,
    ]);
  });

  it("gives a Scout workspace only free site targets, by source and by watch", async () => {
    const paid = await readSiteSweepTargets("test.paidgate-site-paid");
    const free = await readSiteSweepTargets("test.paidgate-site-free");

    expect(paid.map((row) => row.watchId)).toEqual([`w-sp-${STARTER.ws}`]);
    expect(free.map((row) => row.watchId).sort()).toEqual([`w-sf-${SCOUT.ws}`, `w-sf-${STARTER.ws}`]);
    expect(await readSiteSweepTarget(`w-sp-${SCOUT.ws}`)).toBeNull();
    expect((await readSiteSweepTarget(`w-sp-${STARTER.ws}`))?.watchId).toBe(`w-sp-${STARTER.ws}`);
    expect((await readSiteSweepTarget(`w-sf-${SCOUT.ws}`))?.watchId).toBe(`w-sf-${SCOUT.ws}`);
  });
});
