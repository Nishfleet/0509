import { env } from "cloudflare:workers";

const SELECT_WORKSPACE_WATCHES = `SELECT w.id FROM watch w
JOIN entity e ON e.id = w.entity_id
WHERE e.workspace_id = ?
ORDER BY w.id`;

const DELETE_WORKSPACE = "DELETE FROM workspace WHERE id = ?";

const SELECT_WORKSPACE_BY_OWNER = `SELECT id FROM workspace WHERE owner_user_id = ?
ORDER BY created_at LIMIT 1`;

export async function readWorkspaceIdForOwner(userId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_BY_OWNER).bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}

interface BoundStatement {
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface WorkspaceDb {
  prepare(query: string): {
    bind(...values: unknown[]): BoundStatement;
  };
}

const INSERT_WORKSPACE = `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
VALUES (?, ?, ?, ?, 1, 8, ?)
ON CONFLICT(id) DO NOTHING`;

const FILL_TIMEZONE = `UPDATE workspace SET timezone = ? WHERE id = ? AND timezone = 'UTC'`;

export async function insertWorkspace(
  db: WorkspaceDb,
  input: { id: string; name: string; ownerUserId: string; timezone: string; createdAt: string },
): Promise<void> {
  await db
    .prepare(INSERT_WORKSPACE)
    .bind(input.id, input.name, input.ownerUserId, input.timezone, input.createdAt)
    .run();
}

export async function fillWorkspaceTimezone(db: WorkspaceDb, id: string, timezone: string): Promise<void> {
  await db.prepare(FILL_TIMEZONE).bind(timezone, id).run();
}

export async function readWorkspaceR2Prefixes(workspaceId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACE_WATCHES)
    .bind(workspaceId)
    .all<{ id: string }>();
  return [`card/${workspaceId}/`, ...results.map((row) => `snapshot/site/${row.id}/`)];
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await env.DB.prepare(DELETE_WORKSPACE).bind(workspaceId).run();
}
