import { env } from "cloudflare:workers";
import { z } from "zod";

export interface NewIncident {
  id: string;
  workspaceId: string;
  entityId: string;
  pageId: string;
  kind: string;
  openedAt: string;
}

const INSERT_INCIDENT = `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT DO NOTHING`;

const OPEN_INCIDENT_FOR_PAGE = `SELECT id FROM incident WHERE page_id = ?1 AND closed_at IS NULL`;

const OPEN_INCIDENTS = `SELECT id, page_id FROM incident WHERE closed_at IS NULL ORDER BY page_id`;

const CLOSE_INCIDENT = `UPDATE incident SET closed_at = ?2 WHERE id = ?1 AND closed_at IS NULL`;

const CLOSE_UNWATCHED = `UPDATE incident SET closed_at = ?2
WHERE closed_at IS NULL AND page_id NOT IN (SELECT value FROM json_each(?1))`;

const openRows = z.array(z.object({ id: z.string(), page_id: z.string() }));

export async function openIncident(row: NewIncident): Promise<string | null> {
  await env.DB.prepare(INSERT_INCIDENT)
    .bind(row.id, row.workspaceId, row.entityId, row.pageId, row.kind, row.openedAt)
    .run();
  const open = await env.DB.prepare(OPEN_INCIDENT_FOR_PAGE).bind(row.pageId).first<{ id: string }>();
  return open?.id ?? null;
}

export async function readOpenIncidents(): Promise<Record<string, string>> {
  const rows = await env.DB.prepare(OPEN_INCIDENTS).all();
  return Object.fromEntries(openRows.parse(rows.results).map((row) => [row.page_id, row.id]));
}

export async function closeIncident(id: string, closedAt: string): Promise<void> {
  await env.DB.prepare(CLOSE_INCIDENT).bind(id, closedAt).run();
}

export async function closeIncidentsOutside(pageIds: readonly string[], closedAt: string): Promise<void> {
  await env.DB.prepare(CLOSE_UNWATCHED).bind(JSON.stringify(pageIds), closedAt).run();
}
