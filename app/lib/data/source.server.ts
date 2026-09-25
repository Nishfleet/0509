import { env } from "cloudflare:workers";

import type { FreshnessSource } from "../../components/freshness-line";

const ENABLED_SOURCE_ID = `SELECT id FROM source WHERE key = ?1 AND is_enabled = 1`;

const SELECT_ENTITY_SOURCES =
  "SELECT s.key, s.platform, s.kind, s.is_enabled, s.config_json, (SELECT MAX(sn.fetched_at) FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id WHERE w2.entity_id = ?2 AND w2.source_id = s.id) AS fetched_at, (SELECT sn.item_count FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id WHERE w2.entity_id = ?2 AND w2.source_id = s.id ORDER BY sn.fetched_at DESC LIMIT 1) AS item_count, (SELECT w3.config_json FROM watch w3 WHERE w3.entity_id = ?2 AND w3.source_id = s.id AND w3.is_active = 1 ORDER BY CASE WHEN json_extract(w3.config_json, '$.degraded.state') = 'degraded' THEN 0 ELSE 1 END, w3.last_polled_at DESC LIMIT 1) AS watch_config_json FROM source s WHERE s.id IN (SELECT w.source_id FROM watch w JOIN entity e ON e.id = w.entity_id WHERE e.workspace_id = ?1 AND e.id = ?2) ORDER BY s.kind, s.key";

const LATEST_SNAPSHOT_COLUMN = (column: string) =>
  `(SELECT sn.${column} FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id JOIN entity e2 ON e2.id = w2.entity_id WHERE e2.workspace_id = ?1 AND w2.source_id = s.id ORDER BY sn.fetched_at DESC LIMIT 1) AS ${column}`;

const SELECT_WORKSPACE_MENTION_SOURCES = `SELECT s.key, s.platform, s.kind, s.is_enabled, s.config_json, s.degraded_reason, s.last_good_at, ${LATEST_SNAPSHOT_COLUMN("fetched_at")}, ${LATEST_SNAPSHOT_COLUMN("item_count")}, ${LATEST_SNAPSHOT_COLUMN("canary_count")} FROM source s WHERE s.kind = 'mentions' AND s.id IN (SELECT w.source_id FROM watch w JOIN entity e ON e.id = w.entity_id WHERE e.workspace_id = ?1 AND w.is_active = 1) ORDER BY s.key`;

export interface EntitySource {
  source: {
    key: string;
    platform: string;
    kind: string;
    is_enabled: number;
    config_json: string;
    watch_config_json: string | null;
  };
  snapshot: {
    item_count: number;
    fetched_at: string;
  } | null;
}

interface EntitySourceRow {
  key: string;
  platform: string;
  kind: string;
  is_enabled: number;
  config_json: string;
  fetched_at: string | null;
  item_count: number | null;
  watch_config_json: string | null;
}

interface WorkspaceMentionSourceRow {
  key: string;
  platform: string;
  kind: string;
  is_enabled: number;
  config_json: string;
  degraded_reason: string | null;
  last_good_at: string | null;
  fetched_at: string | null;
  item_count: number | null;
  canary_count: number | null;
}

export async function readEnabledSourceId(key: string): Promise<string | null> {
  const row = await env.DB.prepare(ENABLED_SOURCE_ID).bind(key).first<{ id: string }>();
  return row?.id ?? null;
}

const CANARY_SOURCES = `SELECT id, plugin_key, canary_query FROM source
WHERE kind = 'mentions' AND is_enabled = 1 AND canary_query IS NOT NULL
ORDER BY id`;

const MARK_CANARY_GOOD = `UPDATE source SET degraded_reason = NULL, last_good_at = ?2 WHERE id = ?1`;

const MARK_CANARY_BAD = `UPDATE source SET degraded_reason = 'not answering' WHERE id = ?1`;

const MARK_SOURCE_BLOCKED = "UPDATE source SET degraded_reason = ?2 WHERE id = ?1";

export interface CanarySource {
  id: string;
  pluginKey: string;
  canaryQuery: string;
}

export async function readCanarySources(): Promise<CanarySource[]> {
  const { results } = await env.DB.prepare(CANARY_SOURCES).all<{
    id: string;
    plugin_key: string;
    canary_query: string;
  }>();
  return results.map((row) => ({
    id: row.id,
    pluginKey: row.plugin_key,
    canaryQuery: row.canary_query,
  }));
}

export async function recordSourceCanary(
  sourceId: string,
  canaryCount: number,
  now: string,
): Promise<void> {
  if (canaryCount > 0) {
    await env.DB.prepare(MARK_CANARY_GOOD).bind(sourceId, now).run();
    return;
  }
  await env.DB.prepare(MARK_CANARY_BAD).bind(sourceId).run();
}

export async function markSourceBlocked(sourceId: string, status: number): Promise<void> {
  await env.DB.prepare(MARK_SOURCE_BLOCKED)
    .bind(sourceId, `blocked: HTTP ${String(status)}`)
    .run();
}

export async function readEntitySources(
  workspaceId: string,
  entityId: string,
): Promise<readonly EntitySource[]> {
  const { results } = await env.DB.prepare(SELECT_ENTITY_SOURCES)
    .bind(workspaceId, entityId)
    .all<EntitySourceRow>();
  return results.map((row) => ({
    source: {
      key: row.key,
      platform: row.platform,
      kind: row.kind,
      is_enabled: row.is_enabled,
      config_json: row.config_json,
      watch_config_json: row.watch_config_json,
    },
    snapshot:
      row.fetched_at === null
        ? null
        : { item_count: row.item_count ?? 0, fetched_at: row.fetched_at },
  }));
}

export async function readWorkspaceMentionSources(
  workspaceId: string,
): Promise<readonly FreshnessSource[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACE_MENTION_SOURCES)
    .bind(workspaceId)
    .all<WorkspaceMentionSourceRow>();
  return results.map((row) => ({
    kind: row.kind,
    source: {
      key: row.key,
      platform: row.platform,
      is_enabled: row.is_enabled,
      config_json: row.config_json,
      degraded_reason: row.degraded_reason,
      last_good_at: row.last_good_at,
    },
    snapshot:
      row.fetched_at === null
        ? null
        : {
            fetched_at: row.fetched_at,
            item_count: row.item_count ?? 0,
            canary_count: row.canary_count ?? null,
          },
  }));
}
