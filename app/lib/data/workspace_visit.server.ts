import { env } from "cloudflare:workers";

const INSERT_VISIT = `INSERT OR IGNORE INTO workspace_visit (workspace_id, day)
SELECT id, ?2 FROM workspace WHERE id = ?1 AND last_seen_at = ?3`;

export function visitDayStatement(workspaceId: string, now: Date): D1PreparedStatement {
  return env.DB.prepare(INSERT_VISIT).bind(workspaceId, now.toISOString().slice(0, 10), now.toISOString());
}
