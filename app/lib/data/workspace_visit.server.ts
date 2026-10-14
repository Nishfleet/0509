import { env } from "cloudflare:workers";

const INSERT_VISIT = `INSERT OR IGNORE INTO workspace_visit (workspace_id, day)
SELECT id, ?2 FROM workspace WHERE id = ?1 AND last_seen_at = ?3`;

export function visitDayStatement(workspaceId: string, now: Date): D1PreparedStatement {
  return env.DB.prepare(INSERT_VISIT).bind(workspaceId, now.toISOString().slice(0, 10), now.toISOString());
}

export const VISIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

export async function deleteExpiredVisits(db: D1Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - VISIT_RETENTION_MS).toISOString().slice(0, 10);
  const result = await db.prepare("DELETE FROM workspace_visit WHERE day < ?1").bind(cutoff).run();
  return result.meta.changes;
}
