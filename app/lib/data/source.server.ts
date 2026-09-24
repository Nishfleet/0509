import { env } from "cloudflare:workers";

const ENABLED_SOURCE_ID = `SELECT id FROM source WHERE key = ?1 AND is_enabled = 1`;

const SELECT_ENTITY_SOURCES =
  "SELECT s.key, s.platform, s.kind, s.is_enabled, s.config_json, (SELECT MAX(sn.fetched_at) FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id WHERE w2.entity_id = ?2 AND w2.source_id = s.id) AS fetched_at, (SELECT sn.item_count FROM snapshot sn JOIN watch w2 ON w2.id = sn.watch_id WHERE w2.entity_id = ?2 AND w2.source_id = s.id ORDER BY sn.fetched_at DESC LIMIT 1) AS item_count FROM source s WHERE s.id IN (SELECT w.source_id FROM watch w JOIN entity e ON e.id = w.entity_id WHERE e.workspace_id = ?1 AND e.id = ?2) ORDER BY s.kind, s.key";

export interface EntitySource {
  source: {
    key: string;
    platform: string;
    kind: string;
    is_enabled: number;
    config_json: string;
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
}

export async function readEnabledSourceId(key: string): Promise<string | null> {
  const row = await env.DB.prepare(ENABLED_SOURCE_ID).bind(key).first<{ id: string }>();
  return row?.id ?? null;
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
    },
    snapshot:
      row.fetched_at === null
        ? null
        : { item_count: row.item_count ?? 0, fetched_at: row.fetched_at },
  }));
}
