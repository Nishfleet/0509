/**
 * The send-email Queue consumer — the one lane every outbound message travels.
 *
 * 0509#3979 / docs/engines/delivery.md § P7.2. The order is the whole design and
 * is fixed by the packet:
 *
 *   1. read the work item (a digest with status='pending'),
 *   2. look up the target and check email_suppression BEFORE rendering,
 *   3. insert send_attempt with a deterministic idempotency_key and
 *      status='pending' — that insert is the claim,
 *   4. only then send, and resolve the attempt to 'sent' or 'failed'.
 *
 * Claim before send, never send before record. Send-then-record duplicates when
 * the queue redelivers; record-then-send loses silently when the Worker dies.
 * A pending row that outlives the sweeper's threshold is a known unknown
 * (`docs/engines/delivery.md` §4, §7), which is the failure the contract cares
 * about most.
 *
 * Nothing here renders HTML for a suppressed address and nothing here records
 * 'delivered', for the reasons recorded in `send.ts`.
 */

import { sendMessage } from "./send";

interface MessageRow {
  id: string;
  workspace_id: string;
  kind: string;
  status: string;
  subject: string | null;
  payload_json: string;
}

interface TargetRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  target_value: string;
}

export interface DeliveryEnv {
  DB: D1Database;
  EMAIL: SendEmail;
}

/**
 * The work item a producer puts on the queue. The weekly brief and the
 * incident email share this envelope, which is what lets one lane serve both.
 */
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

/** The queue redelivers a message that did not resolve, so a missing row is
 *  not an error — it is a work item that another consumer already finished. */
async function readDigest(env: DeliveryEnv, digestId: string): Promise<MessageRow | null> {
  return env.DB.prepare(
    `SELECT id, workspace_id, kind, status, subject, payload_json
       FROM digest
      WHERE id = ?`,
  )
    .bind(digestId)
    .first<MessageRow>();
}

async function readTarget(env: DeliveryEnv, workspaceId: string): Promise<TargetRow | null> {
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

async function isSuppressed(env: DeliveryEnv, address: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT address FROM email_suppression WHERE address = ?`,
  )
    .bind(address)
    .first<{ address: string }>();
  return row !== null;
}

/**
 * The claim, and the duplicate detector, in one statement.
 *
 * `idempotency_key` is UNIQUE, so a concurrent consumer's insert conflicts.
 * The DO UPDATE guarded by `WHERE status = 'failed'` lets a genuinely failed
 * attempt be reclaimed on redelivery while leaving a 'pending' or 'sent' row
 * untouched. RETURNING gives the row only when this delivery owns the claim;
 * an empty result means another delivery already holds it, which is the
 * expected outcome of an at-least-once queue and not an error.
 */
async function claimAttempt(
  env: DeliveryEnv,
  idempotencyKey: string,
  workspaceId: string,
  targetId: string,
  digestId: string,
): Promise<{ id: string } | null> {
  const now = new Date().toISOString();
  return env.DB.prepare(
    `INSERT INTO send_attempt
       (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(idempotency_key) DO UPDATE
       SET status = 'pending', error = NULL, attempted_at = excluded.attempted_at
       WHERE send_attempt.status = 'failed'
     RETURNING id`,
  )
    .bind(idempotencyKey, workspaceId, targetId, digestId, idempotencyKey, now)
    .first<{ id: string }>();
}

async function resolveAttempt(env: DeliveryEnv, attemptId: string, outcome: "sent" | "failed", error: string | null): Promise<void> {
  await env.DB.prepare(
    `UPDATE send_attempt SET status = ?, error = ? WHERE id = ?`,
  )
    .bind(outcome, error, attemptId)
    .run();
}

async function markDigestSent(env: DeliveryEnv, digestId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE digest SET status = 'sent', sent_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), digestId)
    .run();
}

function render(message: MessageRow, to: string): EmailMessageBuilder {
  const payload = JSON.parse(message.payload_json || "{}") as {
    html?: string;
    text?: string;
  };
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

/**
 * One delivery: read, suppress-check, claim, render, send, resolve.
 *
 * The suppression check sits before render() on purpose — an unsubscribed
 * address never has HTML built for it, so there is no path where a suppressed
 * address reaches EMAIL.send through a subsequent change that only renders.
 */
export async function deliver(env: DeliveryEnv, message: DeliveryMessage): Promise<DeliveryResult> {
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
  const claim = await claimAttempt(env, idempotencyKey, digest.workspace_id, target.id, digest.id);
  if (!claim) {
    // The claim row already exists and is not a 'failed' retry, so this
    // delivery owns no send. A re-enqueued message lands here on the UNIQUE
    // conflict, which is the only dedup this lane has — a hand-written
    // SELECT-before-INSERT would race two consumers and lose.
    return { outcome: "duplicate", attempt_id: null, idempotency_key: idempotencyKey };
  }

  const email = render(digest, target.target_value);
  const result = await sendMessage(env.EMAIL, email);
  await resolveAttempt(env, claim.id, result.outcome, result.error);
  if (result.outcome === "sent") {
    await markDigestSent(env, digest.id);
  }

  return {
    outcome: result.outcome,
    attempt_id: claim.id,
    idempotency_key: idempotencyKey,
  };
}

/**
 * The Queue consumer's batch handler: one message at a time (max_batch_size 1).
 *
 * A delivery that resolved 'failed' is retry()d so the queue's exponential
 * backoff applies and, past max_retries, the message lands in the dead letter
 * queue rather than being lost (`docs/engines/delivery.md` §7). The claim row
 * stays 'failed' and the redelivery reclaims it.
 *
 * Every other outcome is final: a duplicate, a suppressed address and a target
 * that does not exist have nothing for a retry to do, so they ack rather than
 * burning queue retries.
 */
export async function handleBatch(
  env: DeliveryEnv,
  batch: ReadonlyBatch,
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

/**
 * The subset of the runtime's MessageBatch this lane needs. The array is
 * readonly because workerd's is, and naming only these four members keeps the
 * handler testable with a plain object rather than a live queue.
 */
interface ReadonlyBatch {
  readonly messages: readonly { readonly body: unknown; ack(): void; retry(): void }[];
}

function parseMessage(body: unknown): DeliveryMessage | null {
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
