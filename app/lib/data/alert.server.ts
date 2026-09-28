import { env } from "cloudflare:workers";

import type { BriefPayload } from "../brief-payload";
import { readBriefPayload } from "../brief-payload";

const INSERT_DELIVERY_FAILED = `INSERT INTO alert (id, workspace_id, kind, severity, title, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`;

export interface DeliveryFailedAlert {
  id: string;
  workspace_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

export async function insertDeliveryFailedAlert(
  db: D1Database,
  alert: DeliveryFailedAlert,
): Promise<void> {
  await db
    .prepare(INSERT_DELIVERY_FAILED)
    .bind(
      alert.id,
      alert.workspace_id,
      alert.kind,
      alert.severity,
      alert.title,
      alert.body,
      alert.status,
      alert.created_at,
    )
    .run();
}

export interface DeliveryFailureRow {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  digest_id: string | null;
  brief: BriefPayload | null;
}

interface AlertJoinRow {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  digest_id: string | null;
  payload_json: string | null;
}

const SELECT_DELIVERY_FAILURES = `SELECT a.id, a.title, a.body, a.created_at, d.id AS digest_id, d.payload_json
FROM alert a
LEFT JOIN digest d ON d.id = substr(a.id, 5) AND d.workspace_id = a.workspace_id
WHERE a.workspace_id = ? AND a.kind = 'delivery_failed'
ORDER BY a.created_at DESC
LIMIT 20`;

export async function readDeliveryFailures(
  db: D1Database,
  workspaceId: string,
): Promise<DeliveryFailureRow[]> {
  const { results } = await db.prepare(SELECT_DELIVERY_FAILURES).bind(workspaceId).all<AlertJoinRow>();
  return results.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    created_at: row.created_at,
    digest_id: row.digest_id,
    brief: row.payload_json === null ? null : readBriefPayload(row.payload_json),
  }));
}

export interface TakedownNote {
  id: string;
  title: string;
  created_at: string;
}

const SELECT_TAKEDOWN_NOTES = `SELECT id, title, created_at FROM alert
WHERE workspace_id = ? AND kind = 'takedown'
ORDER BY created_at DESC
LIMIT 20`;

export async function readTakedownNotes(
  db: D1Database,
  workspaceId: string,
): Promise<TakedownNote[]> {
  const { results } = await db.prepare(SELECT_TAKEDOWN_NOTES).bind(workspaceId).all<TakedownNote>();
  return results;
}

export interface OwnSiteBreakageAlertRow {
  id: string;
  workspaceId: string;
  entityId: string;
  pageId: string;
  signalId: string | null;
  incidentId: string;
  severity: "high" | "normal";
  title: string;
  body: string | null;
  createdAt: string;
}

const INSERT_OWN_SITE_BREAKAGE_ALERT = `INSERT INTO alert
  (id, workspace_id, entity_id, signal_id, page_id, incident_id, kind, severity, title, body, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'own_site_broken', ?7, ?8, ?9, ?10
WHERE EXISTS (SELECT 1 FROM incident WHERE id = ?11)
ON CONFLICT(id) DO NOTHING`;

export function insertIncidentAlertStatement(row: OwnSiteBreakageAlertRow): D1PreparedStatement {
  return env.DB
    .prepare(INSERT_OWN_SITE_BREAKAGE_ALERT)
    .bind(
      row.id,
      row.workspaceId,
      row.entityId,
      row.signalId,
      row.pageId,
      row.incidentId,
      row.severity,
      row.title,
      row.body,
      row.createdAt,
      row.incidentId,
    );
}

export interface OwnSiteIncidentNote {
  id: string;
  title: string;
  created_at: string;
  closed_at: string | null;
}

const SELECT_OWN_SITE_INCIDENTS = `SELECT a.id, a.title, a.created_at, i.closed_at
FROM alert a
JOIN incident i ON i.id = a.incident_id
WHERE a.workspace_id = ? AND a.kind = 'own_site_broken'
ORDER BY a.created_at DESC
LIMIT 20`;

export async function readOwnSiteIncidents(
  db: D1Database,
  workspaceId: string,
): Promise<OwnSiteIncidentNote[]> {
  const { results } = await db
    .prepare(SELECT_OWN_SITE_INCIDENTS)
    .bind(workspaceId)
    .all<OwnSiteIncidentNote>();
  return results;
}

export interface OpenIncidentBlock {
  alert_id: string;
  title: string;
  kind: string;
  url: string;
  opened_at: string;
}

const SELECT_OPEN_INCIDENT_BLOCK = `SELECT a.id AS alert_id, a.title, i.kind, p.url, i.opened_at FROM alert a JOIN incident i ON i.id = a.incident_id JOIN page p ON p.id = i.page_id WHERE a.workspace_id = ?1 AND a.kind = 'own_site_broken' AND i.closed_at IS NULL AND a.status <> 'acknowledged' ORDER BY i.opened_at DESC LIMIT 1`;

export async function readOpenIncidentBlock(
  db: D1Database,
  workspaceId: string,
): Promise<OpenIncidentBlock | null> {
  const row = await db
    .prepare(SELECT_OPEN_INCIDENT_BLOCK)
    .bind(workspaceId)
    .first<OpenIncidentBlock>();
  return row ?? null;
}

const ACKNOWLEDGE_INCIDENT_ALERT = `UPDATE alert SET status = 'acknowledged', read_at = ?3 WHERE workspace_id = ?1 AND id = ?2 AND kind = 'own_site_broken'`;

export async function acknowledgeIncidentAlert(
  db: D1Database,
  workspaceId: string,
  alertId: string,
  at: string,
): Promise<void> {
  await db
    .prepare(ACKNOWLEDGE_INCIDENT_ALERT)
    .bind(workspaceId, alertId, at)
    .run();
}

const INSERT_SIGNAL_ALERT = `INSERT INTO alert (id, workspace_id, entity_id, signal_id, kind, severity, title, body, status, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, 'normal', ?6, ?7, 'unread', ?8) ON CONFLICT(id) DO NOTHING`;

export function insertSignalAlert(db: D1Database, alert: {
  workspaceId: string;
  entityId: string;
  signalId: string;
  kind: "mention" | "ad";
  title: string;
  body: string | null;
  createdAt: string;
}): D1PreparedStatement {
  return db.prepare(INSERT_SIGNAL_ALERT).bind(
    `${alert.kind}-${alert.signalId}`,
    alert.workspaceId,
    alert.entityId,
    alert.signalId,
    alert.kind,
    alert.title,
    alert.body,
    alert.createdAt,
  );
}

export interface SignalAlert {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
}

const SELECT_SIGNAL_ALERTS = `SELECT a.id, a.kind, a.title, a.body, s.url, a.created_at
FROM alert a
JOIN signal s ON s.id = a.signal_id AND s.is_tombstoned = 0
JOIN entity e ON e.id = a.entity_id AND e.state = 'on'
WHERE a.workspace_id = ? AND a.kind IN ('mention', 'ad')
ORDER BY a.created_at DESC
LIMIT 50`;

export async function readSignalAlerts(db: D1Database, workspaceId: string): Promise<SignalAlert[]> {
  const { results } = await db.prepare(SELECT_SIGNAL_ALERTS).bind(workspaceId).all<SignalAlert>();
  return results;
}

const INSERT_COMPETITOR_RETIRED_ALERT =
  "INSERT INTO alert (id, workspace_id, entity_id, kind, title, body, created_at) VALUES (?, ?, ?, 'competitor_retired', ?, ?, ?)";

export function insertCompetitorRetiredAlert(
  db: D1Database,
  input: {
    workspaceId: string;
    entityId: string;
    name: string;
    line: string;
    now: string;
  },
): D1PreparedStatement {
  return db.prepare(INSERT_COMPETITOR_RETIRED_ALERT).bind(
    crypto.randomUUID(),
    input.workspaceId,
    input.entityId,
    `Stopped tracking ${input.name}`,
    `${input.line}. Its history is kept, and you can turn it back on in Competitors.`,
    input.now,
  );
}

const INSERT_SOURCE_BLIND_ALERT = `INSERT INTO alert (id, workspace_id, kind, severity, title, body, status, created_at) VALUES (?1, ?2, 'source_blind', 'high', ?3, ?4, 'unread', ?5) ON CONFLICT(id) DO NOTHING`;

export function insertSourceBlindAlert(
  db: D1Database,
  alert: {
    id: string;
    workspaceId: string;
    title: string;
    body: string;
    createdAt: string;
  },
): D1PreparedStatement {
  return db
    .prepare(INSERT_SOURCE_BLIND_ALERT)
    .bind(alert.id, alert.workspaceId, alert.title, alert.body, alert.createdAt);
}
