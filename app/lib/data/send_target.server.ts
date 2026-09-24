const WRITE_UNSUBSCRIBE_TOKEN = `UPDATE send_target SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL`;

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
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export async function writeUnsubscribeToken(
  db: D1Database,
  input: { targetId: string; token: string },
): Promise<void> {
  await db.prepare(WRITE_UNSUBSCRIBE_TOKEN).bind(input.token, input.targetId).run();
}

export async function ensureOwnerEmailTarget(
  db: TargetDb,
  input: { workspaceId: string; now: string },
): Promise<void> {
  await db.prepare(INSERT_OWNER_EMAIL_TARGET).bind(input.now, input.workspaceId).run();
}
