import { env } from "cloudflare:workers";

const SUPPRESS_BY_UNSUBSCRIBE_TOKEN = `INSERT INTO email_suppression (address, reason, created_at)
SELECT target_value, 'unsubscribed', ?
  FROM send_target
 WHERE unsubscribe_token = ?
ON CONFLICT(address) DO NOTHING`;

const SUPPRESS_WORKSPACE_TARGETS = `INSERT INTO email_suppression (address, reason, created_at)
SELECT target_value, 'workspace_deleted', ?
  FROM send_target
 WHERE workspace_id = ?
ON CONFLICT(address) DO NOTHING`;

export async function suppressByUnsubscribeToken(token: string): Promise<void> {
  await env.DB.prepare(SUPPRESS_BY_UNSUBSCRIBE_TOKEN)
    .bind(new Date().toISOString(), token)
    .run();
}

export async function suppressWorkspaceTargets(workspaceId: string): Promise<void> {
  await env.DB.prepare(SUPPRESS_WORKSPACE_TARGETS)
    .bind(new Date().toISOString(), workspaceId)
    .run();
}
