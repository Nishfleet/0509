import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { readAgentAlerts } from "../../../app/lib/agent/read.server";
import { POSSIBLY_LINE } from "../../../app/lib/mention-feed";

const STAMP = "2026-09-25T00:00:00.000Z";
const RECENT = new Date(Date.now() - 3_600_000).toISOString();

const created: string[] = [];

async function seed(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const workspaceId = `ws-agent-mention-${suffix}`;
  const userId = `user-agent-mention-${suffix}`;
  const onId = `ent-on-${suffix}`;
  const offId = `ent-off-${suffix}`;
  created.push(workspaceId);
  const mention = (id: string, entityId: string, title: string, url: string) =>
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, published_at, observed_at)
       VALUES (?1, ?2, ?3, 'src_mentions_gdelt', 'mention', ?4, ?5, ?5, ?6, '{}', ?7, ?8, ?8)`,
    ).bind(id, workspaceId, entityId, title, url, `hash-${id}`, `dedup-${id}`, RECENT);
  const verdict = (id: string, signalId: string, entityId: string, p: number) =>
    env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at)
       VALUES (?1, ?2, 'mention_matters', ?3, ?4, ?5, ?6, 'stored reason', ?7)`,
    ).bind(id, workspaceId, `hash-${id}`, signalId, entityId, p, STAMP);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, "Agent Reader", `${userId}@example.com`, STAMP),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Agent Mentions', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, STAMP),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Zephyrwear', ?4)",
    ).bind(onId, workspaceId, `zephyr-${suffix}.example`, STAMP),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Paused Brand', 'off', ?4)",
    ).bind(offId, workspaceId, `paused-${suffix}.example`, STAMP),
    mention(`sig-high-${suffix}`, onId, "Zephyrwear opens a flagship", "https://news.example/flagship"),
    mention(`sig-mid-${suffix}`, onId, "Zephyrwear in a roundup", "https://news.example/roundup"),
    mention(`sig-low-${suffix}`, onId, "Zephyrwear ticker line", "https://news.example/ticker"),
    mention(`sig-off-${suffix}`, offId, "Paused brand mention", "https://news.example/paused"),
    verdict(`jev-high-${suffix}`, `sig-high-${suffix}`, onId, 0.95),
    verdict(`jev-mid-${suffix}`, `sig-mid-${suffix}`, onId, 0.42),
    verdict(`jev-low-${suffix}`, `sig-low-${suffix}`, onId, 0.05),
    verdict(`jev-off-${suffix}`, `sig-off-${suffix}`, offId, 0.99),
  ]);
  return workspaceId;
}

describe("agent alerts mentions", () => {
  afterEach(async () => {
    const workspaceId = created.pop();
    if (workspaceId === undefined) return;
    await env.DB.prepare("DELETE FROM workspace WHERE id = ?").bind(workspaceId).run();
  });

  it("returns the mention rows the alerts page shows, in words only", async () => {
    const workspaceId = await seed();
    const { alerts } = await readAgentAlerts(workspaceId);
    const mentions = alerts.filter((alert) => alert.kind === "mention");
    expect(mentions.map((alert) => alert.title).sort()).toEqual([
      "Zephyrwear in a roundup",
      "Zephyrwear opens a flagship",
    ]);
    const high = mentions.find((alert) => alert.title === "Zephyrwear opens a flagship");
    const middle = mentions.find((alert) => alert.title === "Zephyrwear in a roundup");
    expect(high?.body).not.toContain("Possibly");
    expect(middle?.body).toContain(POSSIBLY_LINE);
    expect(JSON.stringify(alerts)).not.toMatch(/\b0\.\d+\b/);
  });
});
