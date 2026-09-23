import { parseMessage } from "./consumer";

export const DELIVERY_FAILED_KIND = "delivery_failed";
export const DLQ_ALERT_PREFIX = "dlq:";
export const DELIVERY_FAILED_TITLE = "We could not send your brief — here it is in the app";

export interface DeliveryFailedAlert {
  id: string;
  workspace_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

export function deliveryFailedAlert(input: {
  digest_id: string;
  workspace_id: string;
  reason: string | null;
  now: string;
}): DeliveryFailedAlert {
  const reason = input.reason ?? "unknown error";
  return {
    id: `${DLQ_ALERT_PREFIX}${input.digest_id}`,
    workspace_id: input.workspace_id,
    kind: DELIVERY_FAILED_KIND,
    severity: "high",
    title: DELIVERY_FAILED_TITLE,
    body: `Reason: ${reason}. We tried 6 times and stopped at ${input.now}. We will not resend this brief; your next one goes out on its usual day.`,
    status: "unread",
    created_at: input.now,
  };
}

export async function handleDlqBatch(env: Env, batch: MessageBatch): Promise<string[]> {
  let ids: string[] = [];
  for (const item of batch.messages) {
    const parsed = parseMessage(item.body);
    if (!parsed) {
      console.error("send-email-dlq: unparseable message", item.id);
      item.ack();
      continue;
    }

    const digest = await env.DB.prepare(
      `SELECT workspace_id FROM digest WHERE id = ?`,
    )
      .bind(parsed.digest_id)
      .first<{ workspace_id: string }>();
    if (!digest) {
      console.error("send-email-dlq: digest not found", parsed.digest_id);
      item.ack();
      continue;
    }

    const attempt = await env.DB.prepare(
      `SELECT error FROM send_attempt WHERE digest_id = ? ORDER BY attempted_at DESC LIMIT 1`,
    )
      .bind(parsed.digest_id)
      .first<{ error: string | null }>();
    const reason = attempt?.error ?? null;

    const alert = deliveryFailedAlert({
      digest_id: parsed.digest_id,
      workspace_id: digest.workspace_id,
      reason,
      now: new Date().toISOString(),
    });
    await env.DB.prepare(
      `INSERT INTO alert (id, workspace_id, kind, severity, title, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
      .bind(
        alert.id,
        alert.workspace_id,
        alert.kind,
        alert.severity,
        alert.title,
        alert.body,
        alert.status,
        alert.created_at,
      )
      .run();
    item.ack();
    ids = [...ids, alert.id];
  }
  return ids;
}
