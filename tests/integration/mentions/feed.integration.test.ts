import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { readMentionFeed } from "../../../app/lib/data/mention.server";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const STAMP = "2026-09-25T00:00:00.000Z";
const BANNED = /probability|confidence|mention_matters|mention_is_about_brand|\b0\.\d{2,}\b/i;

const created: { workspaceId: string; sourceId: string }[] = [];

async function seed(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const workspaceId = `ws-feed-${suffix}`;
  const userId = `user-feed-${suffix}`;
  const onId = `ent-on-${suffix}`;
  const offId = `ent-off-${suffix}`;
  const dismissedId = `ent-dismissed-${suffix}`;
  const sourceId = `src-medium-${suffix}`;
  created.push({ workspaceId, sourceId });
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, "Mention Reader", `${userId}@example.com`, STAMP),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Mention Feed', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, STAMP),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'self', ?3, 'Self Brand', ?4)",
    ).bind(`ent-self-${suffix}`, workspaceId, `self-${suffix}.example`, STAMP),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Zephyrwear', ?4)",
    ).bind(onId, workspaceId, `zephyr-${suffix}.example`, STAMP),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Paused Brand', 'off', ?4)",
    ).bind(offId, workspaceId, `paused-${suffix}.example`, STAMP),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Dismissed Brand', 'dismissed', ?4)",
    ).bind(dismissedId, workspaceId, `dismissed-${suffix}.example`, STAMP),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?1, ?2, 'mentions', 'medium', ?3, 'rss', 1, '{}')",
    ).bind(sourceId, `medium.feed-${suffix}`, `medium.feed-${suffix}`),
  ]);
  const mention = (
    id: string,
    entityId: string,
    source: string,
    title: string,
    url: string,
    publishedAt: string | null,
    observedAt: string,
  ) =>
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, published_at, observed_at)
       VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?6, ?7, '{}', ?8, ?9, ?10)`,
    ).bind(id, workspaceId, entityId, source, title, url, `hash-${id}`, `dedup-${id}`, publishedAt, observedAt);
  const verdict = (id: string, signalId: string, entityId: string, p: number, reason: string, decidedAt: string) =>
    env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at)
       VALUES (?1, ?2, 'mention_matters', ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(id, workspaceId, `hash-${id}`, signalId, entityId, p, reason, decidedAt);
  await env.DB.batch([
    mention(
      `sig-unjudged-${suffix}`,
      onId,
      "src_mentions_gdelt",
      "Zephyrwear posts a hiring page",
      "https://news.example/hiring",
      "2026-09-25T07:00:00.000Z",
      "2026-09-25T10:00:00.000Z",
    ),
    mention(
      `sig-news-${suffix}`,
      onId,
      "src_mentions_gdelt",
      "Zephyrwear opens a London flagship",
      "https://news.example/flagship",
      "2026-09-24T08:00:00.000Z",
      "2026-09-25T09:00:00.000Z",
    ),
    mention(
      `sig-hn-${suffix}`,
      onId,
      "src_mentions_hn",
      "Zephyrwear thread on Hacker News",
      "https://news.ycombinator.com/item?id=1",
      "2026-09-25T07:00:00.000Z",
      "2026-09-25T08:00:00.000Z",
    ),
    mention(
      `sig-medium-${suffix}`,
      onId,
      sourceId,
      "Zephyrwear shows up in a roundup",
      "https://medium.example/roundup",
      null,
      "2026-09-25T07:00:00.000Z",
    ),
    mention(
      `sig-held-${suffix}`,
      onId,
      "src_mentions_gdelt",
      "Zephyrwear ticker line",
      "https://news.example/ticker",
      "2026-09-25T06:00:00.000Z",
      "2026-09-25T06:00:00.000Z",
    ),
    mention(
      `sig-off-${suffix}`,
      offId,
      "src_mentions_gdelt",
      "Paused brand should stay hidden",
      "https://news.example/paused",
      "2026-09-25T06:00:00.000Z",
      "2026-09-25T06:00:00.000Z",
    ),
    mention(
      `sig-dismissed-${suffix}`,
      dismissedId,
      "src_mentions_hn",
      "Dismissed brand should stay hidden",
      "https://news.example/dismissed",
      "2026-09-25T06:00:00.000Z",
      "2026-09-25T05:00:00.000Z",
    ),
    verdict(
      `jev-news-old-${suffix}`,
      `sig-news-${suffix}`,
      onId,
      0.04,
      "An old read that should stay hidden.",
      "2026-09-25T08:00:00.000Z",
    ),
    verdict(
      `jev-news-${suffix}`,
      `sig-news-${suffix}`,
      onId,
      0.95,
      "A London flagship is a move worth knowing.",
      "2026-09-25T09:00:00.000Z",
    ),
    verdict(
      `jev-hn-${suffix}`,
      `sig-hn-${suffix}`,
      onId,
      0.93,
      "A public thread about the brand is worth a look.",
      "2026-09-25T08:00:00.000Z",
    ),
    verdict(
      `jev-medium-${suffix}`,
      `sig-medium-${suffix}`,
      onId,
      0.42,
      "A roundup mention, not a move of its own.",
      "2026-09-25T07:00:00.000Z",
    ),
    verdict(`jev-held-${suffix}`, `sig-held-${suffix}`, onId, 0.05, "A ticker line, not a move.", "2026-09-25T06:00:00.000Z"),
    verdict(`jev-off-${suffix}`, `sig-off-${suffix}`, offId, 0.99, "Paused brand reason.", "2026-09-25T06:00:00.000Z"),
    verdict(
      `jev-dismissed-${suffix}`,
      `sig-dismissed-${suffix}`,
      dismissedId,
      0.99,
      "Dismissed brand reason.",
      "2026-09-25T05:00:00.000Z",
    ),
  ]);
  return workspaceId;
}

describe("mention feed read", () => {
  afterEach(async () => {
    const row = created.pop();
    if (row === undefined) return;
    await env.DB.prepare("DELETE FROM workspace WHERE id = ?").bind(row.workspaceId).run();
    await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(row.sourceId).run();
  });

  it("reads on-brand mentions, the latest stored reason, and leaves off brands out", async () => {
    const workspaceId = await seed();
    const mentions = await readMentionFeed(workspaceId, NOW);
    expect(mentions.map((mention) => mention.title)).toEqual([
      "Zephyrwear posts a hiring page",
      "Zephyrwear opens a London flagship",
      "Zephyrwear thread on Hacker News",
      "Zephyrwear shows up in a roundup",
      "Zephyrwear ticker line",
    ]);
    expect(mentions.map((mention) => mention.treatment)).toEqual([
      "unreviewed",
      "shown",
      "shown",
      "possibly",
      "held",
    ]);
    expect(mentions.map((mention) => mention.sourceName)).toEqual([
      "News mentions",
      "News mentions",
      "Hacker News mentions",
      "Medium mentions",
      "News mentions",
    ]);
    expect(mentions[3]?.when).toBe("found today");
    expect(mentions.map((mention) => mention.why)).toEqual([
      null,
      "A London flagship is a move worth knowing.",
      "A public thread about the brand is worth a look.",
      "A roundup mention, not a move of its own.",
      "A ticker line, not a move.",
    ]);
    expect(JSON.stringify(mentions)).not.toMatch(BANNED);
    expect(JSON.stringify(mentions)).not.toContain("Paused brand");
    expect(JSON.stringify(mentions)).not.toContain("Dismissed brand");
    expect(JSON.stringify(mentions)).not.toContain("An old read");
  });
});
