const MARK_SENT = `UPDATE digest SET status = 'sent', sent_at = ? WHERE id = ?`;

const INSERT_WEEKLY_DIGEST = `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json)
VALUES (?1, ?2, 'weekly', ?3, ?4, 'pending', ?5)
ON CONFLICT (id) DO NOTHING`;

export interface WeeklyDigest {
  id: string;
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  payloadJson: string;
}

export async function markDigestSent(db: D1Database, digestId: string): Promise<void> {
  await db.prepare(MARK_SENT).bind(new Date().toISOString(), digestId).run();
}

export async function insertWeeklyDigest(db: D1Database, digest: WeeklyDigest): Promise<void> {
  await db
    .prepare(INSERT_WEEKLY_DIGEST)
    .bind(digest.id, digest.workspaceId, digest.periodStart, digest.periodEnd, digest.payloadJson)
    .run();
}
