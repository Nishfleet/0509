const INSERT_DELIVERY_FAILED = `INSERT INTO alert (id, workspace_id, kind, severity, title, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`;

export interface DeliveryFailedAlertRow {
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
  alert: DeliveryFailedAlertRow,
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
