import { env } from "cloudflare:workers";

const MARK_COMPETITORS_READY = `UPDATE onboarding_run SET competitors_ready_at = ?
WHERE id = (
  SELECT id FROM onboarding_run
  WHERE workspace_id = ? AND competitors_ready_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
)`;

export async function markCompetitorsReady(workspaceId: string, now?: string): Promise<void> {
  await env.DB.prepare(MARK_COMPETITORS_READY).bind(now ?? new Date().toISOString(), workspaceId).run();
}
