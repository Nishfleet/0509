import { env } from "cloudflare:workers";

import type { WorkspaceDb } from "./workspace.server";

const SUPPRESS_BY_UNSUBSCRIBE_TOKEN = `INSERT INTO email_suppression (address, reason, created_at)
SELECT lower(trim(target_value)), 'unsubscribed', ?
  FROM send_target
 WHERE unsubscribe_token = ?
ON CONFLICT(address) DO NOTHING`;

const SUPPRESS_WORKSPACE_TARGETS = `INSERT INTO email_suppression (address, reason, created_at)
SELECT lower(trim(t.target_value)), 'workspace_deleted', ?
  FROM send_target t
  JOIN channel c ON c.id = t.channel_id
 WHERE t.workspace_id = ? AND c.key = 'email'
ON CONFLICT(address) DO NOTHING`;

const SELECT_SUPPRESSION = `SELECT address FROM email_suppression WHERE lower(trim(address)) = lower(trim(?)) LIMIT 1`;

const SELECT_UNSUBSCRIBE_TOKEN = `SELECT 1 AS present FROM send_target WHERE unsubscribe_token = ?`;

const DELETE_SUPPRESSION = `DELETE FROM email_suppression WHERE lower(trim(address)) = lower(trim(?))`;

const DELETE_WORKSPACE_DELETED_SUPPRESSION = `DELETE FROM email_suppression WHERE lower(trim(address)) = lower(trim(?)) AND reason = 'workspace_deleted'`;

export async function suppressByUnsubscribeToken(token: string): Promise<void> {
  await env.DB.prepare(SUPPRESS_BY_UNSUBSCRIBE_TOKEN).bind(new Date().toISOString(), token).run();
}

export async function isUnsubscribeTokenKnown(token: string): Promise<boolean> {
  const row = await env.DB.prepare(SELECT_UNSUBSCRIBE_TOKEN).bind(token).first<{ present: number }>();
  return row !== null;
}

export async function suppressWorkspaceTargets(workspaceId: string): Promise<void> {
  await env.DB.prepare(SUPPRESS_WORKSPACE_TARGETS).bind(new Date().toISOString(), workspaceId).run();
}

export async function isAddressSuppressed(address: string, db: D1Database = env.DB): Promise<boolean> {
  const row = await db.prepare(SELECT_SUPPRESSION).bind(address).first<{ address: string }>();
  return row !== null;
}

export async function clearSuppression(address: string): Promise<void> {
  await env.DB.prepare(DELETE_SUPPRESSION).bind(address).run();
}

export async function clearWorkspaceDeletedSuppression(
  address: string,
  db: WorkspaceDb = env.DB,
): Promise<void> {
  await db.prepare(DELETE_WORKSPACE_DELETED_SUPPRESSION).bind(address).run();
}
