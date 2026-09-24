const MARK_SENT = `UPDATE digest SET status = 'sent', sent_at = ? WHERE id = ?`;

const CANCEL_PENDING = `UPDATE digest SET status = 'cancelled'
WHERE workspace_id = ? AND status = 'pending'`;

export async function markDigestSent(db: D1Database, digestId: string): Promise<void> {
  await db.prepare(MARK_SENT).bind(new Date().toISOString(), digestId).run();
}

export async function cancelPendingDigests(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(CANCEL_PENDING).bind(workspaceId).run();
}
