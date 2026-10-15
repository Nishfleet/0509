import { env } from "cloudflare:workers";

const UPSERT_ACTIVE_WORKSPACE = `INSERT INTO active_workspace (user_id, workspace_id)
SELECT ?1, id FROM workspace WHERE id = ?2 AND owner_user_id = ?1
ON CONFLICT(user_id) DO UPDATE SET workspace_id = excluded.workspace_id`;

export async function setActiveWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const result = await env.DB.prepare(UPSERT_ACTIVE_WORKSPACE).bind(userId, workspaceId).run();
  return result.meta.changes > 0;
}
