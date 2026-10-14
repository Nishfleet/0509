import { env } from "cloudflare:workers";

const INSERT_VISIT = `INSERT OR IGNORE INTO workspace_visit (workspace_id, day) VALUES (?1, ?2)`;

export async function recordVisitDay(workspaceId: string, now: Date): Promise<void> {
  await env.DB.prepare(INSERT_VISIT).bind(workspaceId, now.toISOString().slice(0, 10)).run();
}
