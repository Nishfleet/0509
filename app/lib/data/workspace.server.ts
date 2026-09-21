/**
 * `workspace` + `user` reads — the incident notice needs the owner email.
 */
import type { DataEnv } from "./entity.server";

export async function getOwnerEmail(
  env: DataEnv,
  workspaceId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT u.email FROM workspace w JOIN user u ON u.id = w.owner_user_id WHERE w.id = ?`,
  )
    .bind(workspaceId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

export interface UserDecisionRow {
  verdict: string;
  note: string | null;
  decided_at: string;
}

export async function listUserDecisionsForEntity(
  env: DataEnv,
  entityId: string,
): Promise<UserDecisionRow[]> {
  const rows = await env.DB.prepare(
    "SELECT verdict, note, decided_at FROM user_decision WHERE entity_id = ? ORDER BY decided_at DESC LIMIT 20",
  )
    .bind(entityId)
    .all<UserDecisionRow>();
  return rows.results ?? [];
}
