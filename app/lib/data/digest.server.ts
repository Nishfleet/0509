const MARK_SENT = `UPDATE digest SET status = 'sent', sent_at = ? WHERE id = ?`;

const CANCEL_PENDING = `UPDATE digest SET status = 'cancelled'
WHERE workspace_id = ? AND status = 'pending'`;

const MARK_FAILED = `UPDATE digest SET status = 'failed' WHERE id = ? AND status = 'pending'`;

const INSERT_WEEKLY_DIGEST = `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json)
VALUES (?1, ?2, 'weekly', ?3, ?4, ?5, ?6)
ON CONFLICT (id) DO NOTHING`;

const LIST_BRIEFS = "SELECT id, period_start, period_end, status, sent_at FROM digest WHERE workspace_id = ? AND kind = 'weekly' ORDER BY period_start DESC LIMIT 52";

const READ_BRIEF = "SELECT id, period_start, period_end, status, sent_at, payload_json FROM digest WHERE workspace_id = ? AND id = ? AND kind = 'weekly'";

export interface BriefRow {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  sent_at: string | null;
}

export interface BriefWithPayload extends BriefRow {
  payload_json: string;
}

export interface WeeklyDigest {
  id: string;
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  status: "pending" | "paused";
  payloadJson: string;
}

export function markDigestSentStatement(db: D1Database, digestId: string, sentAt: string): D1PreparedStatement {
  return db.prepare(MARK_SENT).bind(sentAt, digestId);
}

export async function cancelPendingDigests(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(CANCEL_PENDING).bind(workspaceId).run();
}

export async function markDigestFailed(db: D1Database, digestId: string): Promise<void> {
  await db.prepare(MARK_FAILED).bind(digestId).run();
}

export async function listBriefs(db: D1Database, workspaceId: string): Promise<BriefRow[]> {
  const { results } = await db.prepare(LIST_BRIEFS).bind(workspaceId).all<BriefRow>();
  return results;
}

export async function readBrief(
  db: D1Database,
  workspaceId: string,
  digestId: string,
): Promise<BriefWithPayload | null> {
  return db.prepare(READ_BRIEF).bind(workspaceId, digestId).first<BriefWithPayload>();
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
