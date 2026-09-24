const DELETE_EXPIRED_SESSIONS = `DELETE FROM "session" WHERE "expiresAt" < ?`;

const DELETE_EXPIRED_VERIFICATIONS = `DELETE FROM "verification" WHERE "expiresAt" < ?`;

export interface AuthExpirySweep {
  sessions: number;
  verifications: number;
}

/**
 * Deletes the auth rows better-auth leaves behind: `session` rows past their
 * `expiresAt`, and `verification` rows (magic-link tokens, sign-in links) past
 * theirs. Both hold personal data, `session` in its `ipAddress` and `userAgent`
 * columns, and better-auth deletes neither on its own schedule.
 *
 * `verification` gets one opportunistic delete: the library sweeps it when a row
 * is looked up by identifier, unless `verification.disableCleanup` is set. A row
 * nobody looks up again is never swept, so the same is true of every `session`
 * row — better-auth 1.7 offers no scheduled sweep and no `session`-side option
 * for one. This is that sweep, run from the nightly cron.
 *
 * `expiresAt` holds ISO-8601 text, so the comparison is a text comparison and
 * both statements must be bound the same-shaped string.
 */
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
