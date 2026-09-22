import { env } from "cloudflare:workers";
import { z } from "zod";

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
): Promise<{ id: string; domain: string; identityJson: string } | null> {
  const row = await env.DB
    .prepare(`SELECT id, domain, identity_json FROM entity WHERE id = ? AND workspace_id = ?`)
    .bind(entityId, workspaceId)
    .first<{ id: string; domain: string; identity_json: string }>();
  return row ? { id: row.id, domain: row.domain, identityJson: row.identity_json } : null;
}

const IdentityMeta = z.object({
  public_subject: z.enum(["cleared", "ask", "unverified"]).optional(),
});

export function publicSubjectFromIdentityJson(
  identityJson: string,
): "cleared" | "ask" | "unverified" {
  try {
    const parsed: unknown = JSON.parse(identityJson);
    const meta = IdentityMeta.safeParse(parsed);
    return meta.success ? (meta.data.public_subject ?? "unverified") : "unverified";
  } catch {
    return "unverified";
  }
}
