import { env } from "cloudflare:workers";

export interface AlertItem {
  title: string;
  body: string | null;
  createdAt: string;
  status: string;
}

export async function listAlertsForOwner(userId: string): Promise<AlertItem[]> {
  const rows = await env.DB.prepare(
    `SELECT a.title, a.body, a.created_at, a.status
     FROM alert a
     JOIN workspace w ON w.id = a.workspace_id
     WHERE w.owner_user_id = ?
     ORDER BY a.created_at DESC
     LIMIT 50`,
  )
    .bind(userId)
    .all<{ title: string; body: string | null; created_at: string; status: string }>();
  return (rows.results ?? []).map((row) => ({
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    status: row.status,
  }));
}
