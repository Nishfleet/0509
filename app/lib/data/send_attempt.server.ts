const CLAIM_ATTEMPT = `INSERT INTO send_attempt
  (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
VALUES (?, ?, ?, ?, ?, 'pending', ?)
ON CONFLICT(idempotency_key) DO UPDATE
  SET status = 'pending', error = NULL, attempted_at = excluded.attempted_at
  WHERE send_attempt.status = 'failed'
RETURNING id`;

const RESOLVE_ATTEMPT = `UPDATE send_attempt SET status = ?, error = ? WHERE id = ?`;

export async function claimSendAttempt(
  db: D1Database,
  input: { idempotencyKey: string; workspaceId: string; targetId: string; digestId: string },
): Promise<{ id: string } | null> {
  const now = new Date().toISOString();
  return db
    .prepare(CLAIM_ATTEMPT)
    .bind(input.idempotencyKey, input.workspaceId, input.targetId, input.digestId, input.idempotencyKey, now)
    .first<{ id: string }>();
}

export async function resolveSendAttempt(
  db: D1Database,
  attemptId: string,
  outcome: "sent" | "failed",
  error: string | null,
): Promise<void> {
  await db.prepare(RESOLVE_ATTEMPT).bind(outcome, error, attemptId).run();
}
