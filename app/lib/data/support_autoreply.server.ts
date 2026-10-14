const CLAIM = `INSERT INTO support_autoreply (sender_sha256, sent_at) VALUES (?1, ?2)
ON CONFLICT (sender_sha256) DO UPDATE SET sent_at = excluded.sent_at WHERE support_autoreply.sent_at < ?3`;

const RELEASE = "DELETE FROM support_autoreply WHERE sender_sha256 = ?";

const DELETE_EXPIRED = "DELETE FROM support_autoreply WHERE sent_at < ?";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function claimAutoReply(db: D1Database, senderSha256: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  const result = await db.prepare(CLAIM).bind(senderSha256, now.toISOString(), cutoff).run();
  return result.meta.changes > 0;
}

export async function releaseAutoReply(db: D1Database, senderSha256: string): Promise<void> {
  await db.prepare(RELEASE).bind(senderSha256).run();
}

export async function deleteExpiredAutoReplies(db: D1Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  const result = await db.prepare(DELETE_EXPIRED).bind(cutoff).run();
  return result.meta.changes;
}
