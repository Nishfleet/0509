import { env } from "cloudflare:workers";

export function insertHomePageStmt(
  db: D1Database,
  args: { id: string; entityId: string; url: string; title: string | null; now: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO page (id, entity_id, url, title, role, discovered_at) VALUES (?,?,?,?, 'home', ?)
       ON CONFLICT (entity_id, url) DO NOTHING`,
    )
    .bind(args.id, args.entityId, args.url, args.title, args.now);
}

export function insertRolePageStmt(
  db: D1Database,
  args: { id: string; entityId: string; url: string; role: string; roleHash: string; now: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO page (id, entity_id, url, title, role, role_decided_for_hash, discovered_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT (entity_id, url) DO NOTHING`,
    )
    .bind(args.id, args.entityId, args.url, null, args.role, args.roleHash, args.now);
}

export async function readHomeUrlForEntity(entityId: string): Promise<string | null> {
  const row = await env.DB
    .prepare(`SELECT url FROM page WHERE entity_id = ? AND role = 'home' LIMIT 1`)
    .bind(entityId)
    .first<{ url: string }>();
  return row?.url ?? null;
}
