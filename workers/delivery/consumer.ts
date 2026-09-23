import { markDigestSent } from "../../app/lib/data/digest.server";
import { claimSendAttempt, resolveSendAttempt } from "../../app/lib/data/send_attempt.server";

import { errorText, sendMessage } from "./send";

class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}

interface MessageRow {
  id: string;
  workspace_id: string;
  kind: string;
  subject: string | null;
  payload_json: string;
}

interface TargetRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  target_value: string;
}

export interface DeliveryMessage {
  digest_id: string;
}

type DeliveryOutcome =
  | "sent"
  | "failed"
  | "suppressed"
  | "duplicate"
  | "no_target"
  | "no_digest";

interface DeliveryResult {
  outcome: DeliveryOutcome;
  attempt_id: string | null;
  idempotency_key: string | null;
}

const EMAIL_CHANNEL_KEY = "email";

async function readDigest(env: Env, digestId: string): Promise<MessageRow | null> {
  return env.DB.prepare(
    `SELECT id, workspace_id, kind, subject, payload_json
       FROM digest
      WHERE id = ?`,
  )
    .bind(digestId)
    .first<MessageRow>();
}

async function readTarget(env: Env, workspaceId: string): Promise<TargetRow | null> {
  return env.DB.prepare(
    `SELECT st.id, st.workspace_id, st.channel_id, st.target_value
       FROM send_target st
       JOIN channel c ON c.id = st.channel_id
      WHERE st.workspace_id = ? AND c.key = ? AND c.is_enabled = 1
      ORDER BY st.created_at ASC
      LIMIT 1`,
  )
    .bind(workspaceId, EMAIL_CHANNEL_KEY)
    .first<TargetRow>();
}

async function isSuppressed(env: Env, address: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT address FROM email_suppression WHERE address = ?`,
  )
    .bind(address)
    .first<{ address: string }>();
  return row !== null;
}

function render(message: MessageRow, to: string): EmailMessageBuilder {
  let payload: { html?: string; text?: string };
  try {
    payload = JSON.parse(message.payload_json || "{}") as {
      html?: string;
      text?: string;
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new PayloadError(`payload_json for digest ${message.id} is not valid JSON: ${detail}`);
  }
  const subject = message.subject ?? `Your ${message.kind} brief`;
  const text = payload.text ?? "";
  const html = payload.html ?? "";
  return {
    to,
    from: "brief@0509.io",
    subject,
    html,
    text,
  };
}

export async function deliver(env: Env, message: DeliveryMessage): Promise<DeliveryResult> {
  const digest = await readDigest(env, message.digest_id);
  if (!digest) {
    return { outcome: "no_digest", attempt_id: null, idempotency_key: null };
  }

  const target = await readTarget(env, digest.workspace_id);
  if (!target) {
    return { outcome: "no_target", attempt_id: null, idempotency_key: null };
  }

  if (await isSuppressed(env, target.target_value)) {
    return { outcome: "suppressed", attempt_id: null, idempotency_key: null };
  }

  const idempotencyKey = `digest:${digest.id}:${target.id}`;
  const claim = await claimSendAttempt(env.DB, {
    idempotencyKey,
    workspaceId: digest.workspace_id,
    targetId: target.id,
    digestId: digest.id,
  });
  if (!claim) {
    return { outcome: "duplicate", attempt_id: null, idempotency_key: idempotencyKey };
  }

  let sent = false;
  try {
    const email = render(digest, target.target_value);
    const result = await sendMessage(env.EMAIL, email);
    sent = result.outcome === "sent";
    await resolveSendAttempt(env.DB, claim.id, result.outcome, result.error);
    if (result.outcome === "sent") {
      await markDigestSent(env.DB, digest.id);
    }
    return { outcome: result.outcome, attempt_id: claim.id, idempotency_key: idempotencyKey };
  } catch (cause) {
    if (sent) throw cause;
    await resolveSendAttempt(env.DB, claim.id, "failed", errorText(cause));
    return { outcome: "failed", attempt_id: claim.id, idempotency_key: idempotencyKey };
  }
}

export async function handleBatch(
  env: Env,
  batch: MessageBatch,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  for (const item of batch.messages) {
    const parsed = parseMessage(item.body);
    if (!parsed) {
      item.ack();
      results.push({ outcome: "no_digest", attempt_id: null, idempotency_key: null });
      continue;
    }
    const result = await deliver(env, parsed);
    if (result.outcome === "failed") {
      item.retry();
    } else {
      item.ack();
    }
    results.push(result);
  }
  return results;
}

export function parseMessage(body: unknown): DeliveryMessage | null {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as DeliveryMessage;
      return typeof parsed.digest_id === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (body !== null && typeof body === "object") {
    const candidate = body as DeliveryMessage;
    return typeof candidate.digest_id === "string" ? candidate : null;
  }
  return null;
}
