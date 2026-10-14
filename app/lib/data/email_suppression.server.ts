import { env } from "cloudflare:workers";
import { z } from "zod";

import type { SuppressionScope } from "../mail-kind";
import type { WorkspaceDb } from "./workspace.server";

const SUPPRESS_BY_UNSUBSCRIBE_TOKEN = `INSERT INTO email_suppression (address, reason, created_at, stops_brief, stops_alerts)
SELECT lower(trim(target_value)), 'unsubscribed', ?1, ?2, ?3
  FROM send_target
 WHERE unsubscribe_token = ?4
ON CONFLICT(address) DO UPDATE SET
  stops_brief = max(stops_brief, excluded.stops_brief),
  stops_alerts = max(stops_alerts, excluded.stops_alerts)`;

const SET_KINDS = `INSERT INTO email_suppression (address, reason, created_at, stops_brief, stops_alerts)
VALUES (lower(trim(?1)), 'unsubscribed', ?2, ?3, ?4)
ON CONFLICT(address) DO UPDATE SET stops_brief = excluded.stops_brief, stops_alerts = excluded.stops_alerts`;

const SELECT_KINDS = `SELECT stops_brief, stops_alerts FROM email_suppression WHERE lower(trim(address)) = lower(trim(?)) LIMIT 1`;

const SUPPRESS_WORKSPACE_TARGETS = `INSERT INTO email_suppression (address, reason, created_at)
SELECT lower(trim(t.target_value)), 'workspace_deleted', ?
  FROM send_target t
  JOIN channel c ON c.id = t.channel_id
 WHERE t.workspace_id = ? AND c.key = 'email' AND t.role = 'owner'
ON CONFLICT(address) DO NOTHING`;

const SELECT_SUPPRESSION = `SELECT address FROM email_suppression
 WHERE lower(trim(address)) = lower(trim(?1))
   AND CASE ?2 WHEN 'brief' THEN stops_brief WHEN 'alerts' THEN stops_alerts ELSE stops_brief AND stops_alerts END = 1
 LIMIT 1`;

const SELECT_UNSUBSCRIBE_TOKEN = `SELECT 1 AS present FROM send_target WHERE unsubscribe_token = ?`;

const DELETE_SUPPRESSION = `DELETE FROM email_suppression WHERE lower(trim(address)) = lower(trim(?))`;

const DELETE_WORKSPACE_DELETED_SUPPRESSION = `DELETE FROM email_suppression WHERE lower(trim(address)) = lower(trim(?)) AND reason = 'workspace_deleted'`;

export async function suppressByUnsubscribeToken(token: string, scope: SuppressionScope): Promise<void> {
  await env.DB.prepare(SUPPRESS_BY_UNSUBSCRIBE_TOKEN)
    .bind(new Date().toISOString(), scope === "alerts" ? 0 : 1, scope === "brief" ? 0 : 1, token)
    .run();
}

const isUnsubscribeTokenKnownRow = z.object({ present: z.number() });

export async function isUnsubscribeTokenKnown(token: string): Promise<boolean> {
  const row = isUnsubscribeTokenKnownRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_UNSUBSCRIBE_TOKEN).bind(token).first());
  return row !== null;
}

const SELECT_TEAMMATE_TOKEN = `SELECT 1 AS present FROM send_target WHERE unsubscribe_token = ? AND role = 'teammate'`;

export async function isTeammateUnsubscribeToken(token: string): Promise<boolean> {
  const row = isUnsubscribeTokenKnownRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_TEAMMATE_TOKEN).bind(token).first());
  return row !== null;
}

export async function suppressWorkspaceTargets(workspaceId: string): Promise<void> {
  await env.DB.prepare(SUPPRESS_WORKSPACE_TARGETS).bind(new Date().toISOString(), workspaceId).run();
}

const isAddressSuppressedRow = z.object({ address: z.string() });

export async function isAddressSuppressed(
  address: string,
  scope: SuppressionScope,
  db: D1Database = env.DB,
): Promise<boolean> {
  const row = isAddressSuppressedRow
    .nullable()
    .parse(await db.prepare(SELECT_SUPPRESSION).bind(address, scope).first());
  return row !== null;
}

const kindsRow = z.object({ stops_brief: z.number(), stops_alerts: z.number() });

export async function readMailKinds(address: string): Promise<{ brief: boolean; alerts: boolean }> {
  const row = kindsRow.nullable().parse(await env.DB.prepare(SELECT_KINDS).bind(address).first());
  return { brief: row === null || row.stops_brief === 0, alerts: row === null || row.stops_alerts === 0 };
}

export async function writeMailKinds(address: string, on: { brief: boolean; alerts: boolean }): Promise<void> {
  if (on.brief && on.alerts) {
    await clearSuppression(address);
    return;
  }
  await env.DB.prepare(SET_KINDS)
    .bind(address, new Date().toISOString(), on.brief ? 0 : 1, on.alerts ? 0 : 1)
    .run();
}

export async function clearSuppression(address: string): Promise<void> {
  await env.DB.prepare(DELETE_SUPPRESSION).bind(address).run();
}

export async function clearWorkspaceDeletedSuppression(address: string, db: WorkspaceDb = env.DB): Promise<void> {
  await db.prepare(DELETE_WORKSPACE_DELETED_SUPPRESSION).bind(address).run();
}
