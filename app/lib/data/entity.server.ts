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

export async function readEntityForWorkspace(
  entityId: string,
  workspaceId: string,
): Promise<{ id: string; domain: string } | null> {
  return env.DB.prepare(`SELECT id, domain FROM entity WHERE id = ? AND workspace_id = ?`)
    .bind(entityId, workspaceId)
    .first<{ id: string; domain: string }>();
}
