const STALE_CLAIM_MS = 60 * 60 * 1000;

const CLAIM_ATTEMPT = `INSERT INTO send_attempt
  (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
VALUES (?, ?, ?, ?, ?, 'pending', ?)
ON CONFLICT(idempotency_key) DO UPDATE
  SET status = 'pending', error = NULL, attempted_at = excluded.attempted_at
  WHERE send_attempt.status = 'failed' OR (send_attempt.status = 'pending' AND send_attempt.attempted_at < ?)
RETURNING id`;

const RESOLVE_ATTEMPT = `UPDATE send_attempt SET status = ?, error = ? WHERE id = ?`;

export async function claimSendAttempt(
  db: D1Database,
  input: {
    idempotencyKey: string;
    workspaceId: string;
    targetId: string;
    digestId: string | null;
  },
): Promise<{ id: string } | null> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  return db
    .prepare(CLAIM_ATTEMPT)
    .bind(
      input.idempotencyKey,
      input.workspaceId,
      input.targetId,
      input.digestId,
      input.idempotencyKey,
      now,
      staleBefore,
    )
    .first<{ id: string }>();
}

export async function resolveSendAttempt(
  db: D1Database,
  input: { attemptId: string; outcome: "sent" | "failed"; error: string | null },
): Promise<void> {
  await db.prepare(RESOLVE_ATTEMPT).bind(input.outcome, input.error, input.attemptId).run();
}

const CLAIM_CHANGE_SLOT = `INSERT INTO send_attempt
  (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
SELECT ?, ?, ?, NULL, ?, 'pending', ?
WHERE (SELECT COUNT(*) FROM send_attempt
        WHERE workspace_id = ? AND idempotency_key LIKE 'change:%' AND status <> 'failed' AND attempted_at >= ?) < ?
ON CONFLICT(idempotency_key) DO UPDATE
  SET status = 'pending', error = NULL, attempted_at = excluded.attempted_at
  WHERE send_attempt.status = 'failed'
RETURNING id`;

const SELECT_ATTEMPT_KEY = `SELECT 1 AS found FROM send_attempt WHERE idempotency_key = ?`;

export type ChangeSlot = { kind: "claimed"; id: string } | { kind: "duplicate" } | { kind: "capped" };

export async function claimChangeSlot(
  db: D1Database,
  input: { idempotencyKey: string; workspaceId: string; targetId: string; since: string; cap: number },
): Promise<ChangeSlot> {
  const claimed = await db
    .prepare(CLAIM_CHANGE_SLOT)
    .bind(
      crypto.randomUUID(),
      input.workspaceId,
      input.targetId,
      input.idempotencyKey,
      new Date().toISOString(),
      input.workspaceId,
      input.since,
      input.cap,
    )
    .first<{ id: string }>();
  if (claimed !== null) return { kind: "claimed", id: claimed.id };
  const existing = await db.prepare(SELECT_ATTEMPT_KEY).bind(input.idempotencyKey).first<{ found: number }>();
  return existing === null ? { kind: "capped" } : { kind: "duplicate" };
}
