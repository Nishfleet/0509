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

export async function readSiteSweepTargets(sourceKey: string): Promise<readonly SiteSweepTarget[]> {
  const rows = await env.DB.prepare(SITE_SWEEP_TARGETS).bind(sourceKey).all();
  return targetRows.parse(rows.results).map((row) => ({
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    sourceId: row.source_id,
    watchId: row.watch_id,
    pageId: row.page_id,
    pageRole: row.page_role,
    url: row.url,
  }));
}
