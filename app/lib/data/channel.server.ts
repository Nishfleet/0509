import type { WorkspaceDb } from "./workspace.server";

const INSERT_CHANNEL = `INSERT INTO channel (id, key, is_enabled, config_json)
VALUES ('chan_email', 'email', 1, '{}')
ON CONFLICT(key) DO NOTHING`;

const SELECT_CHANNEL_ID = `SELECT id FROM channel WHERE key = 'email'`;

export async function ensureEmailChannel(db: WorkspaceDb): Promise<string> {
  await db.prepare(INSERT_CHANNEL).bind().run();
  const row = await db.prepare(SELECT_CHANNEL_ID).bind().first<{ id: string }>();
  if (row === null) throw new Error("email channel missing");
  return row.id;
}
