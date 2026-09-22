import { applyDeliveryRules, parseBriefPayload } from "./brief-data";
import { renderBrief } from "./brief-template";
import { renderIncident } from "./incident-template";
import {
  assertSingleRecipient,
  digestIdempotencyKey,
  incidentIdempotencyKey,
  isStalePending,
  jobFromIdempotencyKey,
  quotedSignalIds,
} from "./record";
import { listUnsubscribeHeaders, sendMail } from "./send";

import type { MailBinding } from "./send";

const BRIEF_FROM = "brief@0509.io";
const INCIDENT_FROM = "incident@0509.io";
const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;

export type SendJob = { digest_id: string } | { incident_id: string; resolution?: boolean };

export type DeliverResult =
  | { outcome: "sent"; attemptId: string; messageId: string }
  | { outcome: "duplicate" }
  | { outcome: "suppressed" }
  | { outcome: "dropped" };

export interface SendMessage {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(): void;
}

export interface SendQueue {
  send(message: SendJob): Promise<unknown>;
}

type Claim = { proceed: true; id: string } | { proceed: false; id: string; status: string };

interface TargetRow { id: string; target_value: string; unsubscribe_token: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "send failed";
}

function isConstraint(error: unknown, kind: "UNIQUE" | "FOREIGN KEY"): boolean {
  return error instanceof Error && error.message.includes(`${kind} constraint failed`);
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function newUnsubscribeToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseSendJob(body: unknown): SendJob {
  if (!isRecord(body)) throw new Error("send job is missing");
  const digestId = body.digest_id;
  const incidentId = body.incident_id;
  if (typeof digestId === "string" && typeof incidentId === "string") {
    throw new Error("send job names both a digest and an incident");
  }
  if (typeof digestId === "string" && digestId.length > 0) return { digest_id: digestId };
  if (typeof incidentId === "string" && incidentId.length > 0) {
    return { incident_id: incidentId, resolution: body.resolution === true };
  }
  throw new Error("send job is missing a digest_id or incident_id");
}

async function emailChannel(db: D1Database): Promise<{ id: string }> {
  const row = await db
    .prepare(`SELECT id FROM channel WHERE key = 'email' AND is_enabled = 1`)
    .first<{ id: string }>();
  if (!row) throw new Error("email channel is missing");
  return row;
}

async function loadTargets(db: D1Database, workspaceId: string, channelId: string): Promise<TargetRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, target_value, unsubscribe_token FROM send_target WHERE workspace_id = ? AND channel_id = ?`,
    )
    .bind(workspaceId, channelId)
    .all<TargetRow>();
  return rows.results ?? [];
}

async function isSuppressed(db: D1Database, address: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT address FROM email_suppression WHERE lower(address) = lower(?)`)
    .bind(address)
    .first<{ address: string }>();
  return row !== null;
}

async function ensureToken(db: D1Database, target: TargetRow): Promise<string> {
  if (target.unsubscribe_token) return target.unsubscribe_token;
  const token = newUnsubscribeToken();
  const updated = await db
    .prepare(`UPDATE send_target SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL`)
    .bind(token, target.id)
    .run();
  if ((updated.meta.changes ?? 0) > 0) return token;
  const row = await db
    .prepare(`SELECT unsubscribe_token FROM send_target WHERE id = ?`)
    .bind(target.id)
    .first<{ unsubscribe_token: string | null }>();
  if (!row?.unsubscribe_token) throw new Error("unsubscribe token was not stored");
  return row.unsubscribe_token;
}

async function claimAttempt(
  db: D1Database,
  input: { workspaceId: string; sendTargetId: string; digestId: string | null; idempotencyKey: string },
  now: Date,
): Promise<Claim> {
  const id = crypto.randomUUID();
  const attemptedAt = now.toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO send_attempt (
           id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at
         ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(id, input.workspaceId, input.sendTargetId, input.digestId, input.idempotencyKey, attemptedAt)
      .run();
    return { proceed: true, id };
  } catch (error) {
    if (!isConstraint(error, "UNIQUE")) throw error;
  }
  const existing = await db
    .prepare(`SELECT id, status, attempted_at FROM send_attempt WHERE idempotency_key = ?`)
    .bind(input.idempotencyKey)
    .first<{ id: string; status: string; attempted_at: string }>();
  if (!existing) throw new Error("send_attempt vanished after a unique conflict");
  if (existing.status === "sent") return { proceed: false, id: existing.id, status: existing.status };
  if (existing.status === "pending" && !isStalePending(existing.attempted_at, now)) {
    return { proceed: false, id: existing.id, status: existing.status };
  }
  if (existing.status !== "pending" && existing.status !== "failed") {
    return { proceed: false, id: existing.id, status: existing.status };
  }
  const updated =
    existing.status === "failed"
      ? await db
          .prepare(
            `UPDATE send_attempt SET status = 'pending', error = NULL, attempted_at = ? WHERE id = ? AND status = 'failed'`,
          )
          .bind(attemptedAt, existing.id)
          .run()
      : await db
          .prepare(
            `UPDATE send_attempt SET error = NULL, attempted_at = ? WHERE id = ? AND status = 'pending' AND attempted_at = ?`,
          )
          .bind(attemptedAt, existing.id, existing.attempted_at)
          .run();
  if ((updated.meta.changes ?? 0) < 1) return { proceed: false, id: existing.id, status: existing.status };
  return { proceed: true, id: existing.id };
}

async function markFailed(db: D1Database, attemptId: string, error: unknown): Promise<void> {
  await db
    .prepare(`UPDATE send_attempt SET status = 'failed', error = ? WHERE id = ?`)
    .bind(errorText(error).slice(0, 500), attemptId)
    .run();
}

async function recordSignals(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  attemptId: string,
  signalIds: readonly string[],
  now: Date,
): Promise<void> {
  for (const signalId of signalIds) {
    try {
      await db
        .prepare(
          `INSERT INTO signal_delivery (
             id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), workspaceId, signalId, channelId, attemptId, now.toISOString())
        .run();
    } catch (error) {
      if (isConstraint(error, "UNIQUE") || isConstraint(error, "FOREIGN KEY")) continue;
      throw error;
    }
  }
}

async function deliverDigest(db: D1Database, email: MailBinding, digestId: string, now: Date): Promise<DeliverResult> {
  const digest = await db
    .prepare(
      `SELECT d.id, d.workspace_id, d.status, d.subject, d.payload_json, w.timezone
       FROM digest d JOIN workspace w ON w.id = d.workspace_id WHERE d.id = ?`,
    )
    .bind(digestId)
    .first<{
      id: string;
      workspace_id: string;
      status: string;
      subject: string | null;
      payload_json: string;
      timezone: string;
    }>();
  if (!digest) throw new Error("digest is missing");
  if (digest.status === "sent") return { outcome: "duplicate" };
  if (digest.status === "suppressed") return { outcome: "suppressed" };

  const channel = await emailChannel(db);
  const targets = await loadTargets(db, digest.workspace_id, channel.id);
  assertSingleRecipient(targets);
  const target = targets[0];
  if (!target) throw new Error("no email send_target for this workspace");
  if (await isSuppressed(db, target.target_value)) {
    await db
      .prepare(`UPDATE digest SET status = 'suppressed' WHERE id = ? AND status = 'pending'`)
      .bind(digest.id)
      .run();
    return { outcome: "suppressed" };
  }

  const token = await ensureToken(db, target);
  const claim = await claimAttempt(
    db,
    {
      workspaceId: digest.workspace_id,
      sendTargetId: target.id,
      digestId: digest.id,
      idempotencyKey: digestIdempotencyKey(digest.id, target.id),
    },
    now,
  );
  if (!claim.proceed) {
    if (claim.status === "sent") {
      await db
        .prepare(
          `UPDATE digest SET status = 'sent', sent_at = COALESCE(sent_at, ?) WHERE id = ? AND status != 'sent'`,
        )
        .bind(now.toISOString(), digest.id)
        .run();
    }
    return { outcome: "duplicate" };
  }

  const entities = await db
    .prepare(`SELECT id, state FROM entity WHERE workspace_id = ?`)
    .bind(digest.workspace_id)
    .all<{ id: string; state: string }>();
  const delivered = await db
    .prepare(`SELECT signal_id FROM signal_delivery WHERE workspace_id = ? AND channel_id = ?`)
    .bind(digest.workspace_id, channel.id)
    .all<{ signal_id: string }>();
  const payload = applyDeliveryRules(
    parseBriefPayload(digest.payload_json),
    entities.results ?? [],
    new Set((delivered.results ?? []).map((row) => row.signal_id)),
  );
  const rendered = renderBrief({
    payload,
    timezone: digest.timezone,
    unsubscribeToken: token,
    subjectOverride: digest.subject,
  });

  try {
    const messageId = await sendMail(email, {
      to: target.target_value,
      from: BRIEF_FROM,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: listUnsubscribeHeaders(token),
    });
    await db.prepare(`UPDATE send_attempt SET status = 'sent', error = NULL WHERE id = ?`).bind(claim.id).run();
    await db
      .prepare(`UPDATE digest SET status = 'sent', sent_at = ?, subject = COALESCE(subject, ?) WHERE id = ?`)
      .bind(now.toISOString(), rendered.subject, digest.id)
      .run();
    await recordSignals(
      db,
      digest.workspace_id,
      channel.id,
      claim.id,
      quotedSignalIds(payload.read_this_first),
      now,
    );
    return { outcome: "sent", attemptId: claim.id, messageId };
  } catch (error) {
    try {
      await markFailed(db, claim.id, error);
    } catch (markError) {
      console.error(errorText(markError));
    }
    throw error;
  }
}

async function deliverIncident(
  db: D1Database,
  email: MailBinding,
  incidentId: string,
  resolution: boolean,
  now: Date,
): Promise<DeliverResult> {
  const incident = await db
    .prepare(
      `SELECT i.id, i.workspace_id, i.entity_id, i.page_id, i.kind, i.opened_at, i.closed_at,
              e.role, e.name AS entity_name, e.domain, p.url AS page_url, w.timezone
       FROM incident i
       JOIN entity e ON e.id = i.entity_id
       JOIN page p ON p.id = i.page_id
       JOIN workspace w ON w.id = i.workspace_id
       WHERE i.id = ?`,
    )
    .bind(incidentId)
    .first<{
      id: string;
      workspace_id: string;
      entity_id: string;
      page_id: string;
      kind: string;
      opened_at: string;
      closed_at: string | null;
      role: string;
      entity_name: string | null;
      domain: string;
      page_url: string;
      timezone: string;
    }>();
  if (!incident) throw new Error("incident is missing");
  if (incident.role !== "self") return { outcome: "dropped" };

  const channel = await emailChannel(db);
  const targets = await loadTargets(db, incident.workspace_id, channel.id);
  assertSingleRecipient(targets);
  const target = targets[0];
  if (!target) throw new Error("no email send_target for this workspace");
  if (await isSuppressed(db, target.target_value)) return { outcome: "suppressed" };

  const token = await ensureToken(db, target);
  const sentOn = utcDate(now);
  const notice = await claimNotice(db, {
    incidentId: incident.id,
    pageId: incident.page_id,
    sentOn,
    sentAt: now.toISOString(),
    resolution,
  });
  if (!notice) return { outcome: "dropped" };

  const noticeKind = resolution ? "fixed" : "open";
  const claim = await claimAttempt(
    db,
    {
      workspaceId: incident.workspace_id,
      sendTargetId: target.id,
      digestId: null,
      idempotencyKey: incidentIdempotencyKey(incident.id, noticeKind),
    },
    now,
  );
  if (!claim.proceed) return { outcome: "duplicate" };

  const change = await db
    .prepare(
      `SELECT title, summary, evidence_url, observed_at
       FROM signal
       WHERE entity_id = ? AND kind = 'change' AND is_tombstoned = 0
       ORDER BY observed_at DESC LIMIT 1`,
    )
    .bind(incident.entity_id)
    .first<{ title: string | null; summary: string | null; evidence_url: string | null; observed_at: string }>();
  const site = incident.entity_name && incident.entity_name.length > 0 ? incident.entity_name : incident.domain;
  const rendered = renderIncident({
    site,
    kind: incident.kind,
    mark: change?.summary ?? change?.title ?? incident.kind,
    seenAt: change?.observed_at ?? incident.opened_at,
    timezone: incident.timezone,
    link: change?.evidence_url ?? incident.page_url,
    unsubscribeToken: token,
    resolution,
  });

  try {
    const messageId = await sendMail(email, {
      to: target.target_value,
      from: INCIDENT_FROM,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: listUnsubscribeHeaders(token),
    });
    await db.prepare(`UPDATE send_attempt SET status = 'sent', error = NULL WHERE id = ?`).bind(claim.id).run();
    await db
      .prepare(
        `UPDATE incident_notice SET sent_at = ? WHERE incident_id = ? AND page_id = ? AND sent_on = ? AND is_resolution = ?`,
      )
      .bind(now.toISOString(), incident.id, incident.page_id, sentOn, resolution ? 1 : 0)
      .run();
    if (resolution) {
      await db
        .prepare(`UPDATE incident SET closed_at = ? WHERE id = ? AND closed_at IS NULL`)
        .bind(now.toISOString(), incident.id)
        .run();
    }
    return { outcome: "sent", attemptId: claim.id, messageId };
  } catch (error) {
    try {
      await markFailed(db, claim.id, error);
    } catch (markError) {
      console.error(errorText(markError));
    }
    throw error;
  }
}

async function claimNotice(
  db: D1Database,
  input: { incidentId: string; pageId: string; sentOn: string; sentAt: string; resolution: boolean },
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT INTO incident_notice (id, incident_id, page_id, sent_on, sent_at, is_resolution)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), input.incidentId, input.pageId, input.sentOn, input.sentAt, input.resolution ? 1 : 0)
      .run();
    return true;
  } catch (error) {
    if (!isConstraint(error, "UNIQUE")) throw error;
  }
  const existing = await db
    .prepare(
      `SELECT incident_id FROM incident_notice WHERE page_id = ? AND sent_on = ? AND is_resolution = ?`,
    )
    .bind(input.pageId, input.sentOn, input.resolution ? 1 : 0)
    .first<{ incident_id: string }>();
  if (!existing) throw new Error("incident_notice vanished after a unique conflict");
  return existing.incident_id === input.incidentId;
}

export async function deliver(
  db: D1Database,
  email: MailBinding,
  job: SendJob,
  now = new Date(),
): Promise<DeliverResult> {
  if ("digest_id" in job) return deliverDigest(db, email, job.digest_id, now);
  return deliverIncident(db, email, job.incident_id, job.resolution === true, now);
}

async function surfaceFailure(db: D1Database, job: SendJob, error: unknown, now: Date): Promise<void> {
  const reason = errorText(error).slice(0, 500);
  if ("digest_id" in job) {
    const row = await db
      .prepare(`SELECT workspace_id FROM digest WHERE id = ?`)
      .bind(job.digest_id)
      .first<{ workspace_id: string }>();
    if (!row) return;
    await db.prepare(`UPDATE digest SET status = 'failed' WHERE id = ? AND status = 'pending'`).bind(job.digest_id).run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO alert (id, workspace_id, kind, title, body, created_at)
         VALUES (?, ?, 'brief_failed', 'We could not send your brief', ?, ?)`,
      )
      .bind(`undelivered:${job.digest_id}`, row.workspace_id, `We could not send your brief. ${reason}`, now.toISOString())
      .run();
    return;
  }
  const row = await db
    .prepare(`SELECT workspace_id FROM incident WHERE id = ?`)
    .bind(job.incident_id)
    .first<{ workspace_id: string }>();
  if (!row) return;
  const kind = job.resolution === true ? "fixed" : "open";
  await db
    .prepare(
      `INSERT OR IGNORE INTO alert (id, workspace_id, incident_id, kind, title, body, created_at)
       VALUES (?, ?, ?, 'incident_failed', 'We could not send the incident email', ?, ?)`,
    )
    .bind(
      `undelivered:${job.incident_id}:${kind}`,
      row.workspace_id,
      job.incident_id,
      `We could not send the incident email. ${reason}`,
      now.toISOString(),
    )
    .run();
}

export async function handleSendQueue(
  batch: { messages: readonly SendMessage[] },
  env: { DB: D1Database; EMAIL: MailBinding },
  now = new Date(),
): Promise<void> {
  for (const message of batch.messages) {
    let job: SendJob;
    try {
      job = parseSendJob(message.body);
    } catch (error) {
      console.error(errorText(error));
      message.retry();
      continue;
    }
    try {
      await deliver(env.DB, env.EMAIL, job, now);
      message.ack();
    } catch (error) {
      if (message.attempts >= 5) {
        try {
          await surfaceFailure(env.DB, job, error, now);
        } catch (surfaceError) {
          console.error(errorText(surfaceError));
        }
      }
      message.retry();
    }
  }
}

export async function sweepStuckSends(db: D1Database, queue: SendQueue, now = new Date()): Promise<number> {
  const digestCutoff = new Date(now.getTime() - SIX_HOURS_MS).toISOString();
  const attemptCutoff = new Date(now.getTime() - HOUR_MS).toISOString();
  const digests = await db
    .prepare(
      `SELECT d.id FROM digest d
       WHERE d.status = 'pending' AND d.period_end < ?
         AND NOT EXISTS (
           SELECT 1 FROM send_attempt a WHERE a.digest_id = d.id AND a.status = 'sent'
         )
         AND NOT EXISTS (
           SELECT 1 FROM send_attempt a
           WHERE a.digest_id = d.id AND a.status = 'pending' AND a.attempted_at >= ?
         )`,
    )
    .bind(digestCutoff, attemptCutoff)
    .all<{ id: string }>();
  const attempts = await db
    .prepare(`SELECT idempotency_key FROM send_attempt WHERE status = 'pending' AND attempted_at < ?`)
    .bind(attemptCutoff)
    .all<{ idempotency_key: string }>();
  let enqueued = 0;
  for (const row of digests.results ?? []) {
    await queue.send({ digest_id: row.id });
    enqueued += 1;
  }
  for (const row of attempts.results ?? []) {
    const job = jobFromIdempotencyKey(row.idempotency_key);
    if (!job) continue;
    await queue.send(job);
    enqueued += 1;
  }
  return enqueued;
}
