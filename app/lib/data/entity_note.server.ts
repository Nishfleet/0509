import { env } from "cloudflare:workers";
import { z } from "zod";

const SELECT_NOTE = `SELECT body FROM entity_note WHERE workspace_id = ?1 AND entity_id = ?2`;

const UPSERT_NOTE = `INSERT INTO entity_note (workspace_id, entity_id, body, updated_at)
SELECT e.workspace_id, e.id, ?3, ?4 FROM entity e
WHERE e.workspace_id = ?1 AND e.id = ?2 AND e.role = 'competitor'
ON CONFLICT (workspace_id, entity_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`;

const DELETE_NOTE = `DELETE FROM entity_note WHERE workspace_id = ?1 AND entity_id = ?2`;

const noteRow = z.object({ body: z.string() });

export async function readEntityNote(workspaceId: string, entityId: string): Promise<string> {
  const row = noteRow.nullable().parse(await env.DB.prepare(SELECT_NOTE).bind(workspaceId, entityId).first());
  return row?.body ?? "";
}

export async function saveEntityNote(input: {
  workspaceId: string;
  entityId: string;
  body: string;
  now: string;
}): Promise<boolean> {
  const { workspaceId, entityId, body, now } = input;
  if (body.trim() === "") {
    await env.DB.prepare(DELETE_NOTE).bind(workspaceId, entityId).run();
    return true;
  }
  const result = await env.DB.prepare(UPSERT_NOTE).bind(workspaceId, entityId, body, now).run();
  return result.meta.changes === 1;
}
