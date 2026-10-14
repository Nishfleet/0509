import { env } from "cloudflare:workers";
import { z } from "zod";

const RECORD_EVENT = `INSERT INTO dodo_webhook_event (id, event_type, payload_json, received_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING`;

const SELECT_PROCESSED = "SELECT processed_at FROM dodo_webhook_event WHERE id = ?";

const MARK_PROCESSED = "UPDATE dodo_webhook_event SET processed_at = ? WHERE id = ?";

const COUNT_UNPROCESSED = `SELECT COUNT(*) AS total FROM dodo_webhook_event
WHERE processed_at IS NULL AND received_at < ?1 AND received_at >= ?2`;

const countRow = z.object({ total: z.number() });

const recordWebhookEventRow = z.object({ processed_at: z.string().nullable() });

export async function recordWebhookEvent(input: {
  id: string;
  eventType: string;
  payloadJson: string;
  receivedAt: string;
}): Promise<"processed" | "pending"> {
  await env.DB.prepare(RECORD_EVENT).bind(input.id, input.eventType, input.payloadJson, input.receivedAt).run();
  const row = recordWebhookEventRow.nullable().parse(await env.DB.prepare(SELECT_PROCESSED).bind(input.id).first());
  return row !== null && row.processed_at !== null ? "processed" : "pending";
}

export async function markWebhookEventProcessed(id: string, processedAt: string): Promise<void> {
  await env.DB.prepare(MARK_PROCESSED).bind(processedAt, id).run();
}

export async function countUnprocessedWebhookEvents(input: {
  receivedBefore: string;
  receivedSince: string;
}): Promise<number> {
  const row = countRow.parse(
    await env.DB.prepare(COUNT_UNPROCESSED).bind(input.receivedBefore, input.receivedSince).first(),
  );
  return row.total;
}
