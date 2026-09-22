import { env } from "cloudflare:workers";

export async function workspaceForUser(userId: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT id FROM workspace WHERE owner_user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ id: string }>();
  if (row) return row.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?,?,?,?)`)
    .bind(id, "My workspace", userId, new Date().toISOString())
    .run();
  return id;
}
