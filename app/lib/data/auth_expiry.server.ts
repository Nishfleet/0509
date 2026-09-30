import { required } from "../required";

export const DELETE_EXPIRED_SESSIONS = `DELETE FROM "session" WHERE "expiresAt" < ?`;

export const DELETE_EXPIRED_VERIFICATIONS = `DELETE FROM "verification" WHERE "expiresAt" < ?`;

export interface AuthExpirySweep {
  sessions: number;
  verifications: number;
}

export async function deleteExpiredAuthRows(db: D1Database, now: Date): Promise<AuthExpirySweep> {
  const cutoff = now.toISOString();

  const [sessions, verifications] = await db.batch([
    db.prepare(DELETE_EXPIRED_SESSIONS).bind(cutoff),
    db.prepare(DELETE_EXPIRED_VERIFICATIONS).bind(cutoff),
  ]);

  return {
    sessions: required(sessions, "auth_expiry.sessions").meta.changes,
    verifications: required(verifications, "auth_expiry.verifications").meta.changes,
  };
}
