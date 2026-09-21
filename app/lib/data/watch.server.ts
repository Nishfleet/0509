/**
 * `watch` reads and the per-tick touch. The poll contract is
 * `watch JOIN entity WHERE entity.state = 'on'` (docs/REBUILD-SCHEMA.md §4).
 */
import type { DataEnv } from "./entity.server";

export interface WatchRow {
  id: string;
  entity_id: string;
  source_id: string;
  target_key: string;
  cursor: string | null;
  last_polled_at: string | null;
}

export async function listDueSiteWatches(
  env: DataEnv,
): Promise<WatchRow[]> {
  const rows = await env.DB.prepare(
    `SELECT w.id, w.entity_id, w.source_id, w.target_key, w.cursor, w.last_polled_at
     FROM watch w
     JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
     JOIN source s ON s.id = w.source_id AND s.is_enabled = 1 AND s.kind = 'site'
     WHERE w.is_active = 1
     ORDER BY w.last_polled_at IS NULL DESC, w.last_polled_at ASC`,
  ).all<WatchRow>();
  return rows.results ?? [];
}

export async function getSiteWatch(
  env: DataEnv,
  watchId: string,
): Promise<(WatchRow & { entity_role: string; entity_domain: string; entity_workspace_id: string; source_reliability: string }) | null> {
  return env.DB.prepare(
    `SELECT w.id, w.entity_id, w.source_id, w.target_key, w.cursor, w.last_polled_at,
            e.role AS entity_role, e.domain AS entity_domain, e.workspace_id AS entity_workspace_id,
            s.reliability AS source_reliability
     FROM watch w
     JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
     JOIN source s ON s.id = w.source_id AND s.is_enabled = 1 AND s.kind = 'site'
     WHERE w.id = ? AND w.is_active = 1`,
  )
    .bind(watchId)
    .first();
}

export async function touchWatch(env: DataEnv, watchId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE watch SET last_polled_at = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), watchId)
    .run();
}
