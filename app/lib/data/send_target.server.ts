import type { WorkspaceDb } from "./workspace.server";

const WRITE_UNSUBSCRIBE_TOKEN = `UPDATE send_target SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL`;

const INSERT_DEFAULT_EMAIL_TARGET = `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
SELECT ?, ?, ?, ?, 1, ?
WHERE NOT EXISTS (SELECT 1 FROM send_target WHERE workspace_id = ? AND channel_id = ?)`;

export async function writeUnsubscribeToken(
  db: D1Database,
  input: { targetId: string; token: string },
): Promise<void> {
  await db.prepare(WRITE_UNSUBSCRIBE_TOKEN).bind(input.token, input.targetId).run();
}

export async function insertDefaultEmailTarget(
  db: WorkspaceDb,
  input: { workspaceId: string; channelId: string; address: string; createdAt: string },
): Promise<void> {
  await db
    .prepare(INSERT_DEFAULT_EMAIL_TARGET)
    .bind(`st_${crypto.randomUUID()}`, input.workspaceId, input.channelId, input.address, input.createdAt, input.workspaceId, input.channelId)
    .run();
}
