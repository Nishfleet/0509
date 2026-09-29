import { env } from "cloudflare:workers";

const RECORD_EVENT = `INSERT INTO dodo_webhook_event (id, event_type, payload_json, received_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING`;

const SELECT_PROCESSED = "SELECT processed_at FROM dodo_webhook_event WHERE id = ?";

const MARK_PROCESSED = "UPDATE dodo_webhook_event SET processed_at = ? WHERE id = ?";

export async function recordWebhookEvent(input: {
  id: string;
  eventType: string;
  payloadJson: string;
  receivedAt: string;
}): Promise<"processed" | "pending"> {
  await env.DB.prepare(RECORD_EVENT)
    .bind(input.id, input.eventType, input.payloadJson, input.receivedAt)
    .run();
  const row = await env.DB.prepare(SELECT_PROCESSED).bind(input.id).first<{ processed_at: string | null }>();
  return row !== null && row.processed_at !== null ? "processed" : "pending";
}

export async function markWebhookEventProcessed(id: string, processedAt: string): Promise<void> {
  await env.DB.prepare(MARK_PROCESSED).bind(processedAt, id).run();
}
