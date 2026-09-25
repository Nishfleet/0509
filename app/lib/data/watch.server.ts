import { env } from "cloudflare:workers";
import { z } from "zod";

export interface NewWatch {
  id: string;
  entityId: string;
  sourceId: string;
  targetKey: string;
}

export interface SiteSweepTarget {
  workspaceId: string;
  entityId: string;
  entityRole: string;
  sourceId: string;
  watchId: string;
  pageId: string;
  pageRole: string;
  url: string;
}

const INSERT_WATCH = `INSERT INTO watch (id, entity_id, source_id, target_key)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (entity_id, source_id, target_key) DO NOTHING`;

const UNWATCHED_ENTITIES = `SELECT e.id AS id, e.domain AS domain
FROM entity e
WHERE e.state = 'on'
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.entity_id = e.id AND w.source_id = ?1)
ORDER BY e.id`;

const MARK_POLLED = `UPDATE watch SET last_polled_at = ?2 WHERE id = ?1`;

const SITE_SWEEP_TARGETS = `SELECT e.workspace_id AS workspace_id,
       e.id AS entity_id,
       e.role AS entity_role,
       w.source_id AS source_id,
       w.id AS watch_id,
       p.id AS page_id,
       COALESCE(p.role, 'other') AS page_role,
       p.url AS url
FROM watch w
JOIN source src ON src.id = w.source_id AND src.key = ?1 AND src.is_enabled = 1
JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
JOIN page p ON p.entity_id = e.id AND p.url = w.target_key
WHERE w.is_active = 1
ORDER BY e.workspace_id, e.id, p.url`;

const entityRows = z.array(z.object({ id: z.string(), domain: z.string() }));

const targetRows = z.array(
  z.object({
    workspace_id: z.string(),
    entity_id: z.string(),
    entity_role: z.string(),
    source_id: z.string(),
    watch_id: z.string(),
    page_id: z.string(),
    page_role: z.string(),
    url: z.string(),
  }),
);

export async function insertWatches(rows: readonly NewWatch[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(INSERT_WATCH).bind(row.id, row.entityId, row.sourceId, row.targetKey),
    ),
  );
}

export async function readUnwatchedEntities(
  sourceId: string,
): Promise<readonly { id: string; domain: string }[]> {
  const rows = await env.DB.prepare(UNWATCHED_ENTITIES).bind(sourceId).all();
  return entityRows.parse(rows.results);
}

export async function markWatchPolled(watchId: string, polledAt: string): Promise<void> {
  await env.DB.prepare(MARK_POLLED).bind(watchId, polledAt).run();
}

const READ_WATCH_CONFIG = "SELECT config_json FROM watch WHERE id = ?1";
const WRITE_WATCH_CONFIG = "UPDATE watch SET config_json = ?2 WHERE id = ?1";

export async function readWatchConfigJson(watchId: string): Promise<string | null> {
  const row = await env.DB.prepare(READ_WATCH_CONFIG).bind(watchId).first<{ config_json: string }>();
  return row === null ? null : row.config_json;
}

export async function writeWatchConfigJson(watchId: string, configJson: string): Promise<void> {
  const result = await env.DB.prepare(WRITE_WATCH_CONFIG).bind(watchId, configJson).run();
  if (result.meta.changes !== 1) throw new Error(`watch ${watchId} was not updated`);
}

export async function readSiteSweepTargets(sourceKey: string): Promise<readonly SiteSweepTarget[]> {
  const rows = await env.DB.prepare(SITE_SWEEP_TARGETS).bind(sourceKey).all();
  return targetRows.parse(rows.results).map((row) => ({
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    entityRole: row.entity_role,
    sourceId: row.source_id,
    watchId: row.watch_id,
    pageId: row.page_id,
    pageRole: row.page_role,
    url: row.url,
  }));
}

const ENSURE_WATCHES = `INSERT INTO watch (id, entity_id, source_id, target_key)
SELECT lower(hex(randomblob(16))), e.id, s.id, COALESCE(NULLIF(e.name, ''), e.domain)
FROM entity e JOIN source s ON s.kind = ?1 AND s.is_enabled = 1
WHERE e.state = 'on'
ON CONFLICT (entity_id, source_id, target_key) DO NOTHING`;

const SELECT_WATCHES = `SELECT w.id AS watch_id, w.target_key, e.id AS entity_id, e.workspace_id, e.role,
  COALESCE(NULLIF(e.name, ''), e.domain) AS name, e.domain,
  s.id AS source_id, s.plugin_key, s.reliability,
  COALESCE(json_extract(s.config_json, '$.min_interval_seconds'), 0) AS min_interval_seconds
FROM watch w
JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
JOIN source s ON s.id = w.source_id AND s.kind = ?1 AND s.is_enabled = 1
WHERE w.is_active = 1 AND w.target_key = COALESCE(NULLIF(e.name, ''), e.domain)
ORDER BY s.plugin_key, w.target_key, w.id`;

export interface WatchRow {
  watch_id: string;
  target_key: string;
  entity_id: string;
  workspace_id: string;
  role: "self" | "competitor";
  name: string;
  domain: string;
  source_id: string;
  plugin_key: string;
  reliability: string;
  min_interval_seconds: number;
}

export async function readActiveWatches(kind: "mentions" | "ads"): Promise<WatchRow[]> {
  await env.DB.prepare(ENSURE_WATCHES).bind(kind).run();
  const rows = await env.DB.prepare(SELECT_WATCHES).bind(kind).all<WatchRow>();
  return rows.results;
}

const ENTITIES_WITHOUT_HIRING_WATCH = `SELECT e.id AS id, e.domain AS domain
FROM entity e
WHERE e.state = 'on'
  AND NOT EXISTS (
    SELECT 1 FROM watch w
    JOIN source src ON src.id = w.source_id AND src.kind = 'hiring' AND src.is_enabled = 1
    WHERE w.entity_id = e.id AND w.is_active = 1
  )
ORDER BY e.id`;

const HIRING_TARGETS = `SELECT e.workspace_id AS workspace_id, e.id AS entity_id, w.source_id AS source_id,
       src.platform AS platform, w.id AS watch_id, w.target_key AS board_url
FROM watch w
JOIN source src ON src.id = w.source_id AND src.kind = 'hiring' AND src.is_enabled = 1
JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
WHERE w.is_active = 1
ORDER BY e.workspace_id, e.id, w.id`;

const DEACTIVATE_WATCH = "UPDATE watch SET is_active = 0 WHERE id = ?1";

const hiringTargetRows = z.array(
  z.object({
    workspace_id: z.string(),
    entity_id: z.string(),
    source_id: z.string(),
    platform: z.string(),
    watch_id: z.string(),
    board_url: z.string(),
  }),
);

export interface HiringTarget {
  workspaceId: string;
  entityId: string;
  sourceId: string;
  platform: string;
  watchId: string;
  boardUrl: string;
}

export async function readEntitiesWithoutHiringWatch(): Promise<
  readonly { id: string; domain: string }[]
> {
  const rows = await env.DB.prepare(ENTITIES_WITHOUT_HIRING_WATCH).all();
  return entityRows.parse(rows.results);
}

export async function readHiringTargets(): Promise<readonly HiringTarget[]> {
  const rows = await env.DB.prepare(HIRING_TARGETS).all();
  return hiringTargetRows.parse(rows.results).map((row) => ({
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    sourceId: row.source_id,
    platform: row.platform,
    watchId: row.watch_id,
    boardUrl: row.board_url,
  }));
}

export async function deactivateWatch(watchId: string): Promise<void> {
  await env.DB.prepare(DEACTIVATE_WATCH).bind(watchId).run();
}

const SITE_WATCH_SUMMARY = `SELECT COUNT(*) AS pages, MAX(w.last_polled_at) AS last_polled_at
FROM watch w
JOIN source src ON src.id = w.source_id AND src.kind = 'site'
JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1
WHERE w.entity_id = ?2 AND w.is_active = 1`;

export interface SiteWatchSummary {
  pages: number;
  lastPolledAt: string | null;
}

export async function readSiteWatchSummary(workspaceId: string, entityId: string): Promise<SiteWatchSummary> {
  const row = await env.DB.prepare(SITE_WATCH_SUMMARY)
    .bind(workspaceId, entityId)
    .first<{ pages: number; last_polled_at: string | null }>();
  return { pages: row?.pages ?? 0, lastPolledAt: row?.last_polled_at ?? null };
}

const ENTITY_R2_PREFIXES = `SELECT w.id AS id
FROM watch w
JOIN entity e ON e.id = w.entity_id
WHERE e.id = ?2 AND e.workspace_id = ?1 AND e.role = 'competitor'
ORDER BY w.id`;

export async function readEntityR2Prefixes(workspaceId: string, entityId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(ENTITY_R2_PREFIXES)
    .bind(workspaceId, entityId)
    .all<{ id: string }>();
  return results.map((row) => `snapshot/site/${row.id}/`);
}
