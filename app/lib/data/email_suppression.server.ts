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

const SELECT_SUPPRESSION = `SELECT address FROM email_suppression WHERE address = ?`;

// The unsubscribe route's liveness check: an unknown token belongs to no
// target, so the route can answer with the invalid-link page instead of
// claiming a suppression that never happened (0509#5761). Served by
// idx_send_target_unsubscribe_token, so it is one indexed read.
const SELECT_UNSUBSCRIBE_TOKEN = `SELECT 1 AS present FROM send_target WHERE unsubscribe_token = ?`;

const DELETE_SUPPRESSION = `DELETE FROM email_suppression WHERE address = ?`;

export async function suppressByUnsubscribeToken(token: string): Promise<void> {
  await env.DB.prepare(SUPPRESS_BY_UNSUBSCRIBE_TOKEN)
    .bind(new Date().toISOString(), token)
    .run();
}

export async function isUnsubscribeTokenKnown(token: string): Promise<boolean> {
  const row = await env.DB.prepare(SELECT_UNSUBSCRIBE_TOKEN)
    .bind(token)
    .first<{ present: number }>();
  return row !== null;
}

export async function suppressWorkspaceTargets(workspaceId: string): Promise<void> {
  await env.DB.prepare(SUPPRESS_WORKSPACE_TARGETS)
    .bind(new Date().toISOString(), workspaceId)
    .run();
}

export async function isAddressSuppressed(address: string): Promise<boolean> {
  const row = await env.DB.prepare(SELECT_SUPPRESSION)
    .bind(address)
    .first<{ address: string }>();
  return row !== null;
}

export async function clearSuppression(address: string): Promise<void> {
  await env.DB.prepare(DELETE_SUPPRESSION).bind(address).run();
}
