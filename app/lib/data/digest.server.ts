const MARK_SENT = `UPDATE digest SET status = 'sent', sent_at = ? WHERE id = ?`;

const CANCEL_PENDING = `UPDATE digest SET status = 'cancelled'
WHERE workspace_id = ? AND status = 'pending'`;

const MARK_FAILED = `UPDATE digest SET status = 'failed' WHERE id = ? AND status = 'pending'`;

const INSERT_WEEKLY_DIGEST = `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json)
VALUES (?1, ?2, 'weekly', ?3, ?4, ?5, ?6)
ON CONFLICT (id) DO NOTHING`;

export interface WeeklyDigest {
  id: string;
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  status: "pending" | "paused";
  payloadJson: string;
}

export async function markDigestSent(db: D1Database, digestId: string): Promise<void> {
  await db.prepare(MARK_SENT).bind(new Date().toISOString(), digestId).run();
}

export async function cancelPendingDigests(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(CANCEL_PENDING).bind(workspaceId).run();
}

export async function markDigestFailed(db: D1Database, digestId: string): Promise<void> {
  await db.prepare(MARK_FAILED).bind(digestId).run();
}

export async function insertWeeklyDigest(db: D1Database, digest: WeeklyDigest): Promise<void> {
  await db
    .prepare(INSERT_WEEKLY_DIGEST)
    .bind(
      digest.id,
      digest.workspaceId,
      digest.periodStart,
      digest.periodEnd,
      digest.status,
      digest.payloadJson,
    )
    .run();
}
