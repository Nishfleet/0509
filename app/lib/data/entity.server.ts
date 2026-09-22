import { env } from "cloudflare:workers";

export function upsertSelfEntityStmt(
  db: D1Database,
  args: {
    id: string;
    workspaceId: string;
    domain: string;
    name: string | null;
    identityJson: string;
    now: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?,?,?,?,?,?, 'manual','on',?)
       ON CONFLICT (workspace_id, domain) DO UPDATE SET name=excluded.name, identity_json=excluded.identity_json`,
    )
    .bind(args.id, args.workspaceId, "self", args.domain, args.name, args.identityJson, args.now);
}

export function confirmEntityStmt(
  db: D1Database,
  args: { entityId: string; workspaceId: string; now: string },
): D1PreparedStatement {
  return db
    .prepare(`UPDATE entity SET confirmed_at = ? WHERE id = ? AND workspace_id = ?`)
    .bind(args.now, args.entityId, args.workspaceId);
}

export function deleteEntityStmt(
  db: D1Database,
  args: { entityId: string; workspaceId: string },
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM entity WHERE id = ? AND workspace_id = ?`)
    .bind(args.entityId, args.workspaceId);
}

export async function selfEntityIdForDomain(
  db: D1Database,
  workspaceId: string,
  domain: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM entity WHERE workspace_id = ? AND domain = ?`)
    .bind(workspaceId, domain)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function readEntityForWorkspace(
  entityId: string,
  workspaceId: string,
): Promise<{ id: string; domain: string; identityJson: string; confirmedAt: string | null } | null> {
  const row = await env.DB
    .prepare(`SELECT id, domain, identity_json, confirmed_at FROM entity WHERE id = ? AND workspace_id = ?`)
    .bind(entityId, workspaceId)
    .first<{ id: string; domain: string; identity_json: string; confirmed_at: string | null }>();
  return row
    ? { id: row.id, domain: row.domain, identityJson: row.identity_json, confirmedAt: row.confirmed_at }
    : null;
}

export async function readSelfEntityForWorkspace(
  entityId: string,
  workspaceId: string,
): Promise<{ id: string; domain: string; identityJson: string; confirmedAt: string | null } | null> {
  const row = await env.DB
    .prepare(
      `SELECT id, domain, identity_json, confirmed_at FROM entity WHERE id = ? AND workspace_id = ? AND role = 'self'`,
    )
    .bind(entityId, workspaceId)
    .first<{ id: string; domain: string; identity_json: string; confirmed_at: string | null }>();
  return row
    ? { id: row.id, domain: row.domain, identityJson: row.identity_json, confirmedAt: row.confirmed_at }
    : null;
}

export async function confirmedSelfEntityForWorkspace(
  workspaceId: string,
): Promise<{ id: string } | null> {
  const row = await env.DB
    .prepare(
      `SELECT id FROM entity WHERE workspace_id = ? AND role = 'self' AND confirmed_at IS NOT NULL LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ id: string }>();
  return row ? { id: row.id } : null;
}
