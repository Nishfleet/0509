import { isReliability, queueFor, readSourceConfig, splitMessages, type EligibleWatch, type MentionMessage } from "./map";

interface TickQueue {
  sendBatch(messages: { body: MentionMessage }[]): Promise<unknown>;
}

export async function selectEligible(db: D1Database): Promise<EligibleWatch[]> {
  const listed = await db
    .prepare(
      `SELECT w.id AS watch_id, w.source_id, e.id AS entity_id, e.workspace_id,
              s.plugin_key, s.reliability, s.config_json
       FROM watch w
       JOIN entity e ON e.id = w.entity_id
       JOIN source s ON s.id = w.source_id
       WHERE e.state = 'on' AND s.kind = 'mentions' AND s.is_enabled = 1 AND w.is_active = 1`,
    )
    .all<{
      watch_id: string;
      source_id: string;
      entity_id: string;
      workspace_id: string;
      plugin_key: string;
      reliability: string;
      config_json: string;
    }>();
  const rows: EligibleWatch[] = [];
  for (const row of listed.results ?? []) {
    if (!isReliability(row.reliability)) continue;
    const config = readSourceConfig(row.config_json);
    rows.push({
      watchId: row.watch_id,
      sourceId: row.source_id,
      entityId: row.entity_id,
      workspaceId: row.workspace_id,
      pluginKey: row.plugin_key,
      reliability: row.reliability,
      rateClass: queueFor({
        pluginKey: row.plugin_key,
        reliability: row.reliability,
        rateClass: config.rateClass,
      }),
    });
  }
  return rows;
}

async function sendAll(queue: TickQueue, messages: MentionMessage[]): Promise<void> {
  for (let index = 0; index < messages.length; index += 100) {
    const chunk = messages.slice(index, index + 100);
    if (chunk.length === 0) continue;
    await queue.sendBatch(chunk.map((body) => ({ body })));
  }
}

export async function enqueueMentionsTick(env: {
  DB: D1Database;
  MENTIONS_FAST: TickQueue;
  MENTIONS_PACED: TickQueue;
}): Promise<{ fast: number; paced: number }> {
  const split = splitMessages(await selectEligible(env.DB));
  await sendAll(env.MENTIONS_FAST, split.fast);
  await sendAll(env.MENTIONS_PACED, split.paced);
  return { fast: split.fast.length, paced: split.paced.length };
}
