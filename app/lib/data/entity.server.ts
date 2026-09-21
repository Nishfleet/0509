/**
 * Reads over `entity` for the site-change engine. Writes to `entity` belong
 * to the onboarding packet, not this one.
 */
export interface EntityRow {
  id: string;
  workspace_id: string;
  role: "self" | "competitor";
  domain: string;
  name: string | null;
  identity_json: string;
  state: "on" | "off" | "dismissed";
}

export interface DataEnv {
  DB: D1Database;
}

export async function getEntity(
  env: DataEnv,
  id: string,
): Promise<EntityRow | null> {
  return env.DB.prepare(
    "SELECT id, workspace_id, role, domain, name, identity_json, state FROM entity WHERE id = ?",
  )
    .bind(id)
    .first<EntityRow>();
}

export async function listTrackedEntities(
  env: DataEnv,
  workspaceId: string,
): Promise<EntityRow[]> {
  const rows = await env.DB.prepare(
    "SELECT id, workspace_id, role, domain, name, identity_json, state FROM entity WHERE workspace_id = ? AND state = 'on'",
  )
    .bind(workspaceId)
    .all<EntityRow>();
  return rows.results ?? [];
}
