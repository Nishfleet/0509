import { env } from "cloudflare:workers";

import {
  allSourcesDown,
  andMoreLabel,
  mentionWhen,
  readPayload,
  readSourceConfig,
  SOURCE_LABELS,
  sourcePill,
  type SourceHealth,
} from "../../../workers/mentions/map";

export interface FeedMention {
  id: string;
  title: string;
  canonicalUrl: string;
  publisher: string | null;
  when: string;
  andMore: string | null;
  unreviewed: boolean;
  possibly: boolean;
}

export interface SourceLine {
  text: string;
  tone: "normal" | "degraded";
  freshness: string | null;
}

async function workspaceFor(userId: string): Promise<{ id: string; timezone: string } | null> {
  return env.DB
    .prepare("SELECT id, timezone FROM workspace WHERE owner_user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ id: string; timezone: string }>();
}

export async function loadSourceLines(userId: string): Promise<{ lines: SourceLine[]; allDown: boolean }> {
  const workspace = await workspaceFor(userId);
  if (!workspace) return { lines: [], allDown: false };
  const sources = await env.DB
    .prepare("SELECT plugin_key, is_enabled, config_json FROM source WHERE kind = 'mentions'")
    .all<{ plugin_key: string; is_enabled: number; config_json: string }>();
  const latest = await env.DB
    .prepare(
      `SELECT source.plugin_key AS plugin_key, MAX(snapshot.fetched_at) AS fetched_at
       FROM snapshot
       JOIN watch ON watch.id = snapshot.watch_id
       JOIN source ON source.id = watch.source_id
       JOIN entity ON entity.id = watch.entity_id
       WHERE entity.workspace_id = ?
       GROUP BY source.plugin_key`,
    )
    .bind(workspace.id)
    .all<{ plugin_key: string; fetched_at: string }>();
  const lastByKey = new Map((latest.results ?? []).map((row) => [row.plugin_key, row.fetched_at]));
  const health: SourceHealth[] = (sources.results ?? []).map((row) => {
    const config = readSourceConfig(row.config_json);
    return {
      pluginKey: row.plugin_key,
      label: SOURCE_LABELS[row.plugin_key] ?? row.plugin_key,
      isEnabled: row.is_enabled === 1,
      degradedSince: config.degradedSince ?? null,
      degradedReason: config.degradedReason ?? null,
      lastGoodAt: config.lastGoodAt ?? null,
      lastSnapshotAt: lastByKey.get(row.plugin_key) ?? null,
    };
  });
  const lines: SourceLine[] = [];
  for (const source of health) {
    const pill = sourcePill(source);
    if (!pill) continue;
    lines.push({
      text: pill.text,
      tone: pill.tone,
      freshness: source.lastSnapshotAt ? `last landed ${source.lastSnapshotAt}` : null,
    });
  }
  return { lines, allDown: allSourcesDown(health) };
}

export async function loadMentionFeed(userId: string, showAll: boolean, now = new Date()): Promise<FeedMention[]> {
  const workspace = await workspaceFor(userId);
  if (!workspace) return [];
  const rows = await env.DB
    .prepare(
      `SELECT id, title, canonical_url, payload_json, published_at, observed_at
       FROM signal
       WHERE workspace_id = ? AND kind = 'mention' AND is_tombstoned = 0
         AND json_extract(payload_json, '$.collapsed_into') IS NULL
       ORDER BY COALESCE(published_at, observed_at) DESC
       LIMIT 100`,
    )
    .bind(workspace.id)
    .all<{
      id: string;
      title: string | null;
      canonical_url: string;
      payload_json: string;
      published_at: string | null;
      observed_at: string;
    }>();
  const extras = await env.DB
    .prepare(
      `SELECT json_extract(payload_json, '$.collapsed_into') AS parent_id, COUNT(*) AS n
       FROM signal
       WHERE workspace_id = ? AND kind = 'mention'
         AND json_extract(payload_json, '$.collapsed_into') IS NOT NULL
       GROUP BY parent_id`,
    )
    .bind(workspace.id)
    .all<{ parent_id: string; n: number }>();
  const more = new Map((extras.results ?? []).map((row) => [row.parent_id, row.n]));
  const mentions: FeedMention[] = [];
  for (const row of rows.results ?? []) {
    const payload = readPayload(row.payload_json);
    if (!showAll && payload.d6 === "show_all") continue;
    mentions.push({
      id: row.id,
      title: row.title ?? "",
      canonicalUrl: row.canonical_url,
      publisher: payload.publisher,
      when: mentionWhen(row.published_at, row.observed_at, workspace.timezone, now),
      andMore: andMoreLabel(more.get(row.id) ?? 0),
      unreviewed: payload.unreviewed === true,
      possibly: payload.d5 === "possibly",
    });
  }
  return mentions;
}
