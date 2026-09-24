const DELETE_EXPIRED_SESSIONS = `DELETE FROM "session" WHERE "expiresAt" < ?`;

const DELETE_EXPIRED_VERIFICATIONS = `DELETE FROM "verification" WHERE "expiresAt" < ?`;

export interface AuthExpirySweep {
  sessions: number;
  verifications: number;
}

export async function deleteExpiredAuthRows(
  db: D1Database,
  now: Date,
): Promise<AuthExpirySweep> {
  const cutoff = now.toISOString();

  const [sessions, verifications] = await db.batch([
    db.prepare(DELETE_EXPIRED_SESSIONS).bind(cutoff),
    db.prepare(DELETE_EXPIRED_VERIFICATIONS).bind(cutoff),
  ]);

  return { sessions: sessions.meta.changes, verifications: verifications.meta.changes };
}
