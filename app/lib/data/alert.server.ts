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
