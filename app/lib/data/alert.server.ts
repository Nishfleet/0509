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
  brief: BriefPayload | null;
}

interface AlertJoinRow {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  payload_json: string | null;
}

const SELECT_DELIVERY_FAILURES = `SELECT a.id, a.title, a.body, a.created_at, d.payload_json
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

export interface IncidentAlert {
  incidentId: string;
  workspaceId: string;
  entityId: string;
  pageId: string;
  title: string;
  createdAt: string;
}

const INSERT_INCIDENT_ALERT = `INSERT INTO alert (id, workspace_id, entity_id, page_id, incident_id, kind, severity, title, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, 'own_site_broken', 'high', ?6, ?7)
ON CONFLICT(id) DO NOTHING`;

export async function insertIncidentAlert(db: D1Database, alert: IncidentAlert): Promise<void> {
  await db
    .prepare(INSERT_INCIDENT_ALERT)
    .bind(
      `incident-${alert.incidentId}`,
      alert.workspaceId,
      alert.entityId,
      alert.pageId,
      alert.incidentId,
      alert.title,
      alert.createdAt,
    )
    .run();
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
