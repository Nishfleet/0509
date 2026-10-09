import { env } from "cloudflare:workers";
import { z } from "zod";

import type { FreshnessSource } from "../freshness.server";
import type { SourceTick } from "../observability/pipeline-health";
import { BLIND_REASON } from "../observability/pipeline-health";
import { effectiveKindSql } from "../source-kind";

const SOURCE_KIND = effectiveKindSql("s");

const ENABLED_SOURCE_ID = `SELECT id FROM source WHERE key = ?1 AND is_enabled = 1`;

const SELECT_ENTITY_SOURCES = `SELECT s.key, s.platform, ${SOURCE_KIND} AS kind, s.is_enabled, s.config_json, (SELECT MAX(sn.fetched_at) FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id WHERE w2.entity_id = ?2 AND w2.source_id = s.id) AS fetched_at, (SELECT sn.item_count FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id WHERE w2.entity_id = ?2 AND w2.source_id = s.id ORDER BY sn.fetched_at DESC LIMIT 1) AS item_count, (SELECT w3.config_json FROM watch w3 WHERE w3.entity_id = ?2 AND w3.source_id = s.id AND w3.is_active = 1 ORDER BY CASE WHEN 'degraded' IN (json_extract(CASE WHEN json_valid(w3.config_json) THEN w3.config_json ELSE '{}' END, '$.degraded.state'), json_extract(CASE WHEN json_valid(w3.config_json) THEN w3.config_json ELSE '{}' END, '$.noChannel.state')) THEN 0 ELSE 1 END, w3.last_polled_at DESC LIMIT 1) AS watch_config_json FROM source s WHERE s.id IN (SELECT w.source_id FROM watch w JOIN entity e ON e.id = w.entity_id WHERE e.workspace_id = ?1 AND e.id = ?2) ORDER BY s.kind, s.key`;

const LATEST_SNAPSHOT_COLUMN = (column: string) =>
  `(SELECT sn.${column} FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id JOIN entity e2 ON e2.id = w2.entity_id WHERE e2.workspace_id = ?1 AND w2.source_id = s.id ORDER BY sn.fetched_at DESC LIMIT 1) AS ${column}`;

const SELECT_WORKSPACE_MENTION_SOURCES = `SELECT s.key, s.platform, ${SOURCE_KIND} AS kind, s.is_enabled, s.config_json, s.degraded_reason, s.last_good_at, ${LATEST_SNAPSHOT_COLUMN("fetched_at")}, ${LATEST_SNAPSHOT_COLUMN("item_count")}, ${LATEST_SNAPSHOT_COLUMN("canary_count")}, (SELECT w3.config_json FROM watch w3 JOIN entity e3 ON e3.id = w3.entity_id WHERE e3.workspace_id = ?1 AND w3.source_id = s.id AND w3.is_active = 1 ORDER BY CASE WHEN 'degraded' IN (json_extract(CASE WHEN json_valid(w3.config_json) THEN w3.config_json ELSE '{}' END, '$.degraded.state'), json_extract(CASE WHEN json_valid(w3.config_json) THEN w3.config_json ELSE '{}' END, '$.noChannel.state')) THEN 0 ELSE 1 END, w3.last_polled_at DESC LIMIT 1) AS watch_config_json FROM source s WHERE (s.kind = 'mentions' OR s.degraded_reason IS NOT NULL) AND s.id IN (SELECT w.source_id FROM watch w JOIN entity e ON e.id = w.entity_id WHERE e.workspace_id = ?1 AND w.is_active = 1) ORDER BY s.key`;

const SELECT_SOURCE_TICKS = `SELECT source_id, source_key, kind, platform, watch_id, fetched_at, item_count FROM (SELECT s.id AS source_id, s.key AS source_key, ${SOURCE_KIND} AS kind, s.platform, w.id AS watch_id, sn.fetched_at, sn.item_count, ROW_NUMBER() OVER (PARTITION BY w.id ORDER BY sn.fetched_at DESC) AS rn FROM snapshot sn JOIN watch w ON w.id = sn.watch_id JOIN source s ON s.id = w.source_id WHERE s.is_enabled = 1 AND w.is_active = 1) WHERE rn <= 2 ORDER BY source_key, watch_id, fetched_at DESC`;

const SELECT_SOURCE_LAST_GOOD = `SELECT w.source_id AS source_id, MAX(sn.fetched_at) AS at FROM snapshot sn JOIN watch w ON w.id = sn.watch_id WHERE sn.item_count > 0 GROUP BY w.source_id`;

const MARK_SOURCE_BLIND = `UPDATE source SET degraded_reason = ?2 WHERE id = ?1 AND degraded_reason IS NULL`;

const CLEAR_SOURCE_BLIND = `UPDATE source SET degraded_reason = NULL WHERE degraded_reason = ?1 AND id NOT IN (SELECT value FROM json_each(?2))`;

const sourceTickRow = z.object({
  source_id: z.string(),
  source_key: z.string(),
  kind: z.string(),
  platform: z.string(),
  watch_id: z.string(),
  fetched_at: z.string(),
  item_count: z.number(),
});

const sourceLastGoodRow = z.object({
  source_id: z.string(),
  at: z.string(),
});

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

const entitySourceRow = z.object({
  key: z.string(),
  platform: z.string(),
  kind: z.string(),
  is_enabled: z.number(),
  config_json: z.string(),
  fetched_at: z.string().nullable(),
  item_count: z.number().nullable(),
  watch_config_json: z.string().nullable(),
});

const workspaceMentionSourceRow = z.object({
  key: z.string(),
  platform: z.string(),
  kind: z.string(),
  is_enabled: z.number(),
  config_json: z.string(),
  degraded_reason: z.string().nullable(),
  last_good_at: z.string().nullable(),
  fetched_at: z.string().nullable(),
  item_count: z.number().nullable(),
  canary_count: z.number().nullable(),
  watch_config_json: z.string().nullable(),
});

const readEnabledSourceIdRow = z.object({ id: z.string() });

export async function readEnabledSourceId(key: string): Promise<string | null> {
  const row = readEnabledSourceIdRow.nullable().parse(await env.DB.prepare(ENABLED_SOURCE_ID).bind(key).first());
  return row?.id ?? null;
}

const ENABLED_BY_KIND =
  "SELECT id, key FROM source WHERE kind = ?1 AND platform <> 'feed' AND is_enabled = 1 ORDER BY key";

const enabledSourceRows = z.array(z.object({ id: z.string(), key: z.string() }));

export async function readEnabledSources(
  kind: "ads" | "mentions" | "site" | "hiring",
): Promise<{ id: string; key: string }[]> {
  const rows = await env.DB.prepare(ENABLED_BY_KIND).bind(kind).all();
  return enabledSourceRows.parse(rows.results);
}

const CANARY_STRIKES_BEFORE_DEGRADED = 2;

const CANARY_SOURCES = `SELECT id, plugin_key, canary_query,
COALESCE(json_extract(CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END, '$.min_interval_seconds'), 0) AS min_interval_seconds FROM source
WHERE kind = 'mentions' AND is_enabled = 1 AND canary_query IS NOT NULL
ORDER BY id`;

const MARK_CANARY_GOOD = `UPDATE source SET degraded_reason = NULL, last_good_at = ?2, canary_strikes = NULL WHERE id = ?1`;

const COUNT_CANARY_STRIKE = `UPDATE source SET canary_strikes = COALESCE(canary_strikes, 0) + 1 WHERE id = ?1 RETURNING canary_strikes`;

const MARK_CANARY_BAD = `UPDATE source SET degraded_reason = 'not answering' WHERE id = ?1 AND COALESCE(canary_strikes, 0) >= ?2`;

const MARK_SOURCE_BLOCKED = "UPDATE source SET degraded_reason = ?2 WHERE id = ?1";

const RECORD_SOURCE_LATEST_SNAPSHOT = `UPDATE source SET latest_fetched_at = sn.fetched_at, latest_item_count = sn.item_count, latest_canary_count = sn.canary_count FROM snapshot sn WHERE sn.id = ?1 AND source.id = (SELECT w.source_id FROM watch w WHERE w.id = sn.watch_id) AND (source.latest_fetched_at IS NULL OR source.latest_fetched_at < sn.fetched_at)`;

export function recordSourceLatestSnapshot(snapshotId: string): D1PreparedStatement {
  return env.DB.prepare(RECORD_SOURCE_LATEST_SNAPSHOT).bind(snapshotId);
}

export interface CanarySource {
  id: string;
  pluginKey: string;
  canaryQuery: string;
  minIntervalSeconds: number;
}

const readCanarySourcesRow = z.object({
  id: z.string(),
  plugin_key: z.string(),
  canary_query: z.string(),
  min_interval_seconds: z.number(),
});

export async function readCanarySources(): Promise<CanarySource[]> {
  const { results } = await env.DB.prepare(CANARY_SOURCES).all();
  return z
    .array(readCanarySourcesRow)
    .parse(results)
    .map((row) => ({
      id: row.id,
      pluginKey: row.plugin_key,
      canaryQuery: row.canary_query,
      minIntervalSeconds: row.min_interval_seconds,
    }));
}

export async function recordSourceCanary(sourceId: string, canaryCount: number, now: string): Promise<void> {
  if (canaryCount > 0) {
    await env.DB.prepare(MARK_CANARY_GOOD).bind(sourceId, now).run();
    return;
  }
  const struck = await env.DB.prepare(COUNT_CANARY_STRIKE).bind(sourceId).first<{ canary_strikes: number }>();
  const strikes = struck?.canary_strikes ?? 0;
  if (strikes < CANARY_STRIKES_BEFORE_DEGRADED) return;
  await env.DB.prepare(MARK_CANARY_BAD).bind(sourceId, CANARY_STRIKES_BEFORE_DEGRADED).run();
}

export async function markSourceBlocked(sourceId: string, status: number): Promise<void> {
  await env.DB.prepare(MARK_SOURCE_BLOCKED)
    .bind(sourceId, `blocked: HTTP ${String(status)}`)
    .run();
}

const SELECT_WORKSPACES_WATCHING_SOURCE = `SELECT DISTINCT e.workspace_id AS workspace_id FROM watch w JOIN entity e ON e.id = w.entity_id WHERE w.source_id = ?1 AND w.is_active = 1 ORDER BY e.workspace_id`;

const readWorkspacesWatchingSourceRow = z.object({ workspace_id: z.string() });

export async function readWorkspacesWatchingSource(sourceId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACES_WATCHING_SOURCE).bind(sourceId).all();
  return z
    .array(readWorkspacesWatchingSourceRow)
    .parse(results)
    .map((row) => row.workspace_id);
}

export async function readSourceTicks(): Promise<SourceTick[]> {
  const { results } = await env.DB.prepare(SELECT_SOURCE_TICKS).all();
  return z
    .array(sourceTickRow)
    .parse(results)
    .map((row) => ({
      sourceId: row.source_id,
      sourceKey: row.source_key,
      kind: row.kind,
      platform: row.platform,
      watchId: row.watch_id,
      fetchedAt: row.fetched_at,
      itemCount: row.item_count,
    }));
}

export async function readSourceLastGood(): Promise<ReadonlyMap<string, string>> {
  const { results } = await env.DB.prepare(SELECT_SOURCE_LAST_GOOD).all();
  return new Map(
    z
      .array(sourceLastGoodRow)
      .parse(results)
      .map((row) => [row.source_id, row.at]),
  );
}

export async function markSourceBlind(sourceId: string): Promise<void> {
  await env.DB.prepare(MARK_SOURCE_BLIND).bind(sourceId, BLIND_REASON).run();
}

export async function clearSourceBlind(blindIds: readonly string[]): Promise<void> {
  await env.DB.prepare(CLEAR_SOURCE_BLIND).bind(BLIND_REASON, JSON.stringify(blindIds)).run();
}

export async function markSourceTimedOut(sourceId: string): Promise<void> {
  await env.DB.prepare(MARK_SOURCE_BLOCKED).bind(sourceId, "timed out").run();
}

export async function readEntitySources(workspaceId: string, entityId: string): Promise<readonly EntitySource[]> {
  const { results } = await env.DB.prepare(SELECT_ENTITY_SOURCES).bind(workspaceId, entityId).all();
  return z
    .array(entitySourceRow)
    .parse(results)
    .map((row) => ({
      source: {
        key: row.key,
        platform: row.platform,
        kind: row.kind,
        is_enabled: row.is_enabled,
        config_json: row.config_json,
        watch_config_json: row.watch_config_json,
      },
      snapshot: row.fetched_at === null ? null : { item_count: row.item_count ?? 0, fetched_at: row.fetched_at },
    }));
}

export async function readWorkspaceMentionSources(workspaceId: string): Promise<readonly FreshnessSource[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACE_MENTION_SOURCES).bind(workspaceId).all();
  return z
    .array(workspaceMentionSourceRow)
    .parse(results)
    .map((row) => ({
      kind: row.kind,
      source: {
        key: row.key,
        platform: row.platform,
        is_enabled: row.is_enabled,
        config_json: row.config_json,
        degraded_reason: row.degraded_reason,
        last_good_at: row.last_good_at,
        watch_config_json: row.watch_config_json,
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

export const SELECT_REGISTRY_SOURCES = `SELECT s.key, s.plugin_key, s.platform, ${SOURCE_KIND} AS kind, s.is_enabled, s.config_json, s.degraded_reason, s.last_good_at, s.latest_fetched_at AS fetched_at, s.latest_item_count AS item_count, s.latest_canary_count AS canary_count FROM source s ORDER BY s.kind, s.key`;

const registrySourceRow = workspaceMentionSourceRow
  .omit({ watch_config_json: true })
  .extend({ plugin_key: z.string() });

export async function readRegistrySources(): Promise<readonly FreshnessSource[]> {
  const { results } = await env.DB.prepare(SELECT_REGISTRY_SOURCES).all();
  return z
    .array(registrySourceRow)
    .parse(results)
    .map((row) => ({
      kind: row.kind,
      source: {
        key: row.key,
        platform: row.platform,
        name: row.plugin_key,
        is_enabled: row.is_enabled,
        config_json: row.config_json,
        degraded_reason: row.degraded_reason,
        last_good_at: row.last_good_at,
        watch_config_json: null,
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
