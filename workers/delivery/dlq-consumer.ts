import { captureException } from "@sentry/cloudflare";

import {
  insertDeliveryFailedAlert,
  type DeliveryFailedAlert,
} from "../../app/lib/data/alert.server";
import { markDigestFailed } from "../../app/lib/data/digest.server";
import { parseMessage } from "./consumer";

export const DELIVERY_FAILED_KIND = "delivery_failed";
export const DLQ_ALERT_PREFIX = "dlq:";
export const DLQ_INCIDENT_PREFIX = "dlq-incident:";
export const DELIVERY_FAILED_TITLE = "We could not send your brief — here it is in the app";

export const DELIVERY_FAILED_BODY =
  "We tried several times and could not deliver this brief by email, so we have stopped trying. Everything in it is below. Your next brief goes out on its usual day.";

export const INCIDENT_UNDELIVERED_TITLE = "We could not email you about your site";

export const INCIDENT_UNDELIVERED_BODY =
  "Your site broke and we tried several times to email you about it, so we have stopped trying. The breakage and every check that followed are on your Alerts page.";

export function deliveryFailedAlert(input: {
  digest_id: string;
  workspace_id: string;
  now: string;
}): DeliveryFailedAlert {
  return {
    id: `${DLQ_ALERT_PREFIX}${input.digest_id}`,
    workspace_id: input.workspace_id,
    kind: DELIVERY_FAILED_KIND,
    severity: "high",
    title: DELIVERY_FAILED_TITLE,
    body: DELIVERY_FAILED_BODY,
    status: "unread",
    created_at: input.now,
  };
}

/**
 * The own-site lane's counterpart to `deliveryFailedAlert`. Same `alert.kind`,
 * so `/app/alerts` renders it through the path brief failures already use,
 * with the incident on the row so the customer can see which breakage never
 * reached their inbox. Keyed on the incident, so a message that dead-letters
 * twice writes one row.
 */
export function incidentUndeliveredAlert(input: {
  incident_id: string;
  workspace_id: string;
  now: string;
}): DeliveryFailedAlert {
  return {
    id: `${DLQ_INCIDENT_PREFIX}${input.incident_id}`,
    workspace_id: input.workspace_id,
    kind: DELIVERY_FAILED_KIND,
    severity: "high",
    title: INCIDENT_UNDELIVERED_TITLE,
    body: INCIDENT_UNDELIVERED_BODY,
    status: "unread",
    created_at: input.now,
  };
}

export function incidentDeadLetterError(input: {
  message_id: string;
  incident_id: string;
  reason: string;
}): Error {
  return new Error(
    JSON.stringify({
      event: "send-email-dlq.dead_lettered",
      queue: "send-email-dlq",
      message_id: input.message_id,
      incident_id: input.incident_id,
      reason: input.reason,
    }),
  );
}

export async function handleDlqBatch(env: Env, batch: MessageBatch): Promise<string[]> {
  let ids: string[] = [];
  for (const item of batch.messages) {
    const parsed = parseMessage(item.body);
    if (parsed === null) {
      console.error("send-email-dlq: unparseable message", item.id);
      item.ack();
      continue;
    }

    if ("incident_id" in parsed) {
      const deadLettered = await deadLetteredIncident(env, item.id, parsed.incident_id);
      item.ack();
      if (deadLettered !== null) ids = [...ids, deadLettered];
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
    console.error(
      JSON.stringify({
        event: "delivery.dead_lettered",
        digest_id: parsed.digest_id,
        reason: attempt?.error ?? null,
      }),
    );

    const alert = deliveryFailedAlert({
      digest_id: parsed.digest_id,
      workspace_id: digest.workspace_id,
      now: new Date().toISOString(),
    });
    await markDigestFailed(env.DB, parsed.digest_id);
    await insertDeliveryFailedAlert(env.DB, alert);
    item.ack();
    ids = [...ids, alert.id];
  }
  return ids;
}

/**
 * An own-site alert that exhausts `send-email` reaches this queue as
 * `{ incident_id }`. Before this branch existed the message was logged as
 * "unparseable" and acked, so the outage the product is sold around produced
 * nothing the customer could see and nothing Sentry could page on (0509#5761).
 *
 * Sentry is captured before the row is written: if D1 is the thing that is
 * broken, the signal must not depend on D1.
 */
async function deadLetteredIncident(
  env: Env,
  messageId: string,
  incidentId: string,
): Promise<string | null> {
  const incident = await env.DB.prepare(`SELECT workspace_id FROM incident WHERE id = ?`)
    .bind(incidentId)
    .first<{ workspace_id: string }>();
  if (!incident) {
    captureException(
      incidentDeadLetterError({ message_id: messageId, incident_id: incidentId, reason: "incident not found" }),
      { tags: { queue: "send-email-dlq", incident_id: incidentId } },
    );
    console.error("send-email-dlq: incident not found", incidentId);
    return null;
  }

  const attempt = await env.DB.prepare(
    `SELECT error FROM send_attempt
      WHERE idempotency_key IN (?, ?)
      ORDER BY attempted_at DESC LIMIT 1`,
  )
    .bind(`incident:${incidentId}:open`, `incident:${incidentId}:fixed`)
    .first<{ error: string | null }>();
  const reason = attempt?.error ?? "no send attempt recorded";

  captureException(
    incidentDeadLetterError({ message_id: messageId, incident_id: incidentId, reason }),
    { tags: { queue: "send-email-dlq", incident_id: incidentId } },
  );
  console.error(
    JSON.stringify({
      event: "delivery.dead_lettered",
      incident_id: incidentId,
      reason: attempt?.error ?? null,
    }),
  );

  const alert = incidentUndeliveredAlert({
    incident_id: incidentId,
    workspace_id: incident.workspace_id,
    now: new Date().toISOString(),
  });
  await insertDeliveryFailedAlert(env.DB, alert);
  return alert.id;
}
