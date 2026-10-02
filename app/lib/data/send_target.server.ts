import { sha256Hex } from "../sha256";

const WRITE_UNSUBSCRIBE_TOKEN = `UPDATE send_target SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL`;

const SELECT_EMAIL_TARGET = `SELECT st.target_value, st.is_verified FROM send_target st
JOIN channel c ON c.id = st.channel_id
WHERE st.workspace_id = ? AND c.key = 'email'
ORDER BY st.created_at ASC
LIMIT 1`;

const WRITE_VERIFY_TOKEN = `UPDATE send_target SET verify_token = ?, verify_token_expires_at = ?
WHERE id = (
  SELECT st.id FROM send_target st
  JOIN channel c ON c.id = st.channel_id
  WHERE st.workspace_id = ? AND c.key = 'email'
  ORDER BY st.created_at ASC
  LIMIT 1
)`;

const MARK_EMAIL_TARGET_VERIFIED = `UPDATE send_target SET is_verified = 1, verify_token = NULL, verify_token_expires_at = NULL
WHERE id = (
  SELECT st.id FROM send_target st
  JOIN channel c ON c.id = st.channel_id
  WHERE st.workspace_id = ? AND c.key = 'email'
  ORDER BY st.created_at ASC
  LIMIT 1
)`;

const CHANGE_EMAIL_TARGET = `UPDATE send_target
SET target_value = ?, is_verified = 0, unsubscribe_token = NULL, verify_token = NULL, verify_token_expires_at = NULL
WHERE workspace_id = ?
  AND channel_id = (SELECT id FROM channel WHERE key = 'email')
  AND target_value <> ?`;

const CONFIRM_EMAIL_TARGET_BY_TOKEN = `UPDATE send_target SET is_verified = 1, verify_token = NULL, verify_token_expires_at = NULL
WHERE verify_token = ? AND verify_token_expires_at > ?`;

const INSERT_OWNER_EMAIL_TARGET = `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
SELECT 'st-email-' || w.id, w.id, c.id, u.email, u.emailVerified, ?
  FROM workspace w
  JOIN "user" u ON u.id = w.owner_user_id
  JOIN channel c ON c.key = 'email'
 WHERE w.id = ?
   AND NOT EXISTS (
     SELECT 1 FROM send_target st WHERE st.workspace_id = w.id AND st.channel_id = c.id
   )`;

interface TargetDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export async function writeUnsubscribeToken(db: D1Database, input: { targetId: string; token: string }): Promise<void> {
  await db.prepare(WRITE_UNSUBSCRIBE_TOKEN).bind(input.token, input.targetId).run();
}

export async function ensureOwnerEmailTarget(db: TargetDb, input: { workspaceId: string; now: string }): Promise<void> {
  await db.prepare(INSERT_OWNER_EMAIL_TARGET).bind(input.now, input.workspaceId).run();
}

export async function readEmailTarget(
  db: TargetDb,
  workspaceId: string,
): Promise<{ target_value: string; is_verified: number } | null> {
  const row = await db
    .prepare(SELECT_EMAIL_TARGET)
    .bind(workspaceId)
    .first<{ target_value: string; is_verified: number }>();
  return row ?? null;
}

export async function writeVerifyToken(
  db: TargetDb,
  input: { workspaceId: string; token: string; expiresAt: string },
): Promise<void> {
  const tokenHash = await sha256Hex(input.token);
  await db.prepare(WRITE_VERIFY_TOKEN).bind(tokenHash, input.expiresAt, input.workspaceId).run();
}

export async function markEmailTargetVerified(db: TargetDb, input: { workspaceId: string }): Promise<void> {
  await db.prepare(MARK_EMAIL_TARGET_VERIFIED).bind(input.workspaceId).run();
}

export async function changeEmailTarget(db: TargetDb, input: { workspaceId: string; address: string }): Promise<void> {
  await db.prepare(CHANGE_EMAIL_TARGET).bind(input.address, input.workspaceId, input.address).run();
}

export async function confirmEmailTargetByToken(db: TargetDb, input: { token: string; now: string }): Promise<void> {
  const tokenHash = await sha256Hex(input.token);
  await db.prepare(CONFIRM_EMAIL_TARGET_BY_TOKEN).bind(tokenHash, input.now).run();
}

const SELECT_SLACK_TARGET = `SELECT st.id, st.target_value FROM send_target st
JOIN channel c ON c.id = st.channel_id
WHERE st.workspace_id = ? AND c.key = 'slack' AND c.is_enabled = 1 AND st.is_verified = 1
LIMIT 1`;

const DELETE_SLACK_TARGET = `DELETE FROM send_target
WHERE workspace_id = ? AND channel_id = (SELECT id FROM channel WHERE key = 'slack')`;

const INSERT_SLACK_TARGET = `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
SELECT ?, ?, id, ?, 1, ? FROM channel WHERE key = 'slack'`;

export async function readSlackTarget(
  db: TargetDb,
  workspaceId: string,
): Promise<{ id: string; target_value: string } | null> {
  return db.prepare(SELECT_SLACK_TARGET).bind(workspaceId).first<{ id: string; target_value: string }>();
}

export async function removeSlackTarget(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(DELETE_SLACK_TARGET).bind(workspaceId).run();
}

export async function saveSlackTarget(
  db: D1Database,
  input: { workspaceId: string; webhookUrl: string; now: string },
): Promise<void> {
  await db.batch([
    db.prepare(DELETE_SLACK_TARGET).bind(input.workspaceId),
    db.prepare(INSERT_SLACK_TARGET).bind(crypto.randomUUID(), input.workspaceId, input.webhookUrl, input.now),
  ]);
}
