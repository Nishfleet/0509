const WRITE_UNSUBSCRIBE_TOKEN = `UPDATE send_target SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL`;

export async function writeUnsubscribeToken(
  db: D1Database,
  input: { targetId: string; token: string },
): Promise<void> {
  await db.prepare(WRITE_UNSUBSCRIBE_TOKEN).bind(input.token, input.targetId).run();
}
