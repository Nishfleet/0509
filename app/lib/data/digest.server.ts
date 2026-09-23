const MARK_SENT = `UPDATE digest SET status = 'sent', sent_at = ? WHERE id = ?`;

export async function markDigestSent(db: D1Database, digestId: string): Promise<void> {
  await db.prepare(MARK_SENT).bind(new Date().toISOString(), digestId).run();
}
