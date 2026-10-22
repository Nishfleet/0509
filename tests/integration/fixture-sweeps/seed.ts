import { env } from "cloudflare:test";

import { ensureWorkspace } from "../../../app/lib/workspace.server";

export const NOW = "2026-10-05T12:00:00.000Z";
export const LONG_AGO = "2026-09-01T00:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

export interface SeededWorkspace {
  tag: string;
  userId: string;
  workspaceId: string;
  selfId: string;
  rivalId: string;
  subscriptionId: string;
}

export interface SeededSite extends SeededWorkspace {
  selfWatchId: string;
  rivalWatchId: string;
}

export interface SeededPair {
  live: SeededWorkspace;
  fixture: SeededWorkspace;
}

async function seedOne(tag: string, email: string): Promise<SeededWorkspace> {
  const userId = `user-${tag}`;
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(userId, tag, email, NOW, NOW)
    .run();
  const workspace = await ensureWorkspace(env.DB, { userId, email, timezone: "UTC", now: NOW });
  const selfId = `self-${tag}`;
  const rivalId = `rival-${tag}`;
  const subscriptionId = `sub-${tag}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, state, domain, name, identity_json, created_at)
       VALUES (?, ?, 'self', 'on', ?, 'Self', '{}', ?)`,
    ).bind(selfId, workspace.id, `${tag}-self.com`, NOW),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, state, domain, name, identity_json, origin, created_at)
       VALUES (?, ?, 'competitor', 'on', ?, 'Rival', '{}', 'manual', ?)`,
    ).bind(rivalId, workspace.id, `${tag}-rival.com`, NOW),
    env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
       VALUES (?, ?, 'scout', 'active', ?, ?, ?, 1, ?)`,
    ).bind(`plan-${tag}`, workspace.id, `cus-${tag}`, subscriptionId, FAR_FUTURE, NOW),
    env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES (?, ?, 'chan-email', ?, 1, ?)`,
    ).bind(`target-${tag}`, workspace.id, email, NOW),
  ]);
  return { tag, userId, workspaceId: workspace.id, selfId, rivalId, subscriptionId };
}

export async function resetWorld(): Promise<void> {
  await env.DB.exec('DELETE FROM "user"');
}

export async function seedPair(): Promise<SeededPair> {
  const live = await seedOne("live", "ada@example.com");
  const fixture = await seedOne("fixture", "e2e+abc123@0509.io");
  return { live, fixture };
}

export async function sourceId(key: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM source WHERE key = ?").bind(key).first<{ id: string }>();
  if (row === null) throw new Error(`no source ${key}`);
  return row.id;
}

export async function seedSiteWatches(seeded: SeededWorkspace): Promise<SeededSite> {
  const site = await sourceId("site.web");
  const entities = [
    { entityId: seeded.selfId, url: `https://${seeded.tag}-self.com/` },
    { entityId: seeded.rivalId, url: `https://${seeded.tag}-rival.com/` },
  ];
  await env.DB.batch(
    entities.flatMap(({ entityId, url }) => [
      env.DB.prepare(`INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`).bind(
        `page-${entityId}`,
        entityId,
        url,
        LONG_AGO,
      ),
      env.DB.prepare(`INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?, ?, ?, ?)`).bind(
        `watch-${entityId}`,
        entityId,
        site,
        url,
      ),
    ]),
  );
  return { ...seeded, selfWatchId: `watch-${seeded.selfId}`, rivalWatchId: `watch-${seeded.rivalId}` };
}

export async function seedChangeSignals(pair: SeededPair): Promise<void> {
  const site = await sourceId("site.web");
  await env.DB.batch(
    [pair.live, pair.fixture].map((seeded) =>
      env.DB.prepare(
        `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, payload_json, dedup_key, observed_at)
         VALUES (?, ?, ?, ?, 'change', 'pricing', '{"diffKey":"diff/key.json"}', ?, ?)`,
      ).bind(
        `signal-${seeded.workspaceId}`,
        seeded.workspaceId,
        seeded.rivalId,
        site,
        `dedup-${seeded.workspaceId}`,
        NOW,
      ),
    ),
  );
}
