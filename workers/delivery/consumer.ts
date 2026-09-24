import { markDigestSent } from "../../app/lib/data/digest.server";
import { claimIncidentNotice } from "../../app/lib/data/incident_notice.server";
import { claimSendAttempt, resolveSendAttempt } from "../../app/lib/data/send_attempt.server";
import { writeUnsubscribeToken } from "../../app/lib/data/send_target.server";
import type { BriefPayload } from "../../app/lib/brief-payload";
import { parseBriefPayload } from "../../app/lib/brief-payload";

import { renderBrief } from "./brief-template";
import { renderIncidentFixed, renderIncidentOpen } from "./incident-template";
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
  unsubscribe_token: string | null;
}

export interface DigestMessage {
  digest_id: string;
}

export interface IncidentMessage {
  incident_id: string;
}

export type DeliveryMessage = DigestMessage | IncidentMessage;

type DeliveryOutcome =
  | "sent"
  | "failed"
  | "suppressed"
  | "duplicate"
  | "no_target"
  | "no_digest"
  | "no_incident"
  | "not_self";

interface DeliveryResult {
  outcome: DeliveryOutcome;
  attempt_id: string | null;
  idempotency_key: string | null;
}

const EMAIL_CHANNEL_KEY = "email";
const INCIDENT_LINK = "https://0509.io/app/alerts";
const RECHECK_AFTER_MS = 3_600_000;

async function readDigest(env: Env, digestId: string): Promise<MessageRow | null> {
  return env.DB.prepare(
    `SELECT id, workspace_id, kind, subject, payload_json
       FROM digest
      WHERE id = ?`,
  )
    .bind(digestId)
    .first<MessageRow>();
}

interface IncidentRow {
  id: string;
  workspace_id: string;
  page_id: string;
  kind: string;
  opened_at: string;
  closed_at: string | null;
  domain: string;
  role: string;
  mark: string | null;
}

async function readIncident(env: Env, incidentId: string): Promise<IncidentRow | null> {
  return env.DB.prepare(
    `SELECT i.id,
            i.workspace_id,
            i.page_id,
            i.kind,
            i.opened_at,
            i.closed_at,
            e.domain,
            e.role,
            (SELECT a.body FROM alert a WHERE a.incident_id = i.id ORDER BY a.created_at ASC LIMIT 1) AS mark
       FROM incident i
       JOIN entity e ON e.id = i.entity_id
      WHERE i.id = ?`,
  )
    .bind(incidentId)
    .first<IncidentRow>();
}

async function readTarget(env: Env, workspaceId: string): Promise<TargetRow | null> {
  return env.DB.prepare(
    `SELECT st.id, st.workspace_id, st.channel_id, st.target_value, st.unsubscribe_token
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

function newUnsubscribeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureUnsubscribeToken(env: Env, target: TargetRow): Promise<string> {
  if (target.unsubscribe_token !== null) return target.unsubscribe_token;
  await writeUnsubscribeToken(env.DB, { targetId: target.id, token: newUnsubscribeToken() });
  const row = await env.DB.prepare(
    `SELECT unsubscribe_token FROM send_target WHERE id = ?`,
  )
    .bind(target.id)
    .first<{ unsubscribe_token: string | null }>();
  if (row?.unsubscribe_token == null) {
    throw new Error("send_target has no unsubscribe token");
  }
  return row.unsubscribe_token;
}

const UNSUBSCRIBE_BASE_URL = "https://0509.io/u/";

function briefOf(message: MessageRow): BriefPayload {
  try {
    return parseBriefPayload(message.payload_json);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new PayloadError(`payload_json for digest ${message.id} is not a brief: ${detail}`);
  }
}

function render(message: MessageRow, to: string, token: string): EmailMessageBuilder {
  const payload = briefOf(message);
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}${token}`;
  const rendered = renderBrief(payload, { unsubscribe_url: unsubscribeUrl, asset_base_url: null });
  return {
    to,
    from: "brief@0509.io",
    subject: message.subject ?? rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export async function deliver(env: Env, message: DigestMessage): Promise<DeliveryResult> {
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
    const token = await ensureUnsubscribeToken(env, target);
    const email = render(digest, target.target_value, token);
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

export async function deliverIncident(
  env: Env,
  message: IncidentMessage,
): Promise<DeliveryResult> {
  const incident = await readIncident(env, message.incident_id);
  if (!incident) {
    return { outcome: "no_incident", attempt_id: null, idempotency_key: null };
  }
  if (incident.role !== "self") {
    return { outcome: "not_self", attempt_id: null, idempotency_key: null };
  }

  const target = await readTarget(env, incident.workspace_id);
  if (!target) {
    return { outcome: "no_target", attempt_id: null, idempotency_key: null };
  }

  if (await isSuppressed(env, target.target_value)) {
    return { outcome: "suppressed", attempt_id: null, idempotency_key: null };
  }

  const isResolution = incident.closed_at === null ? 0 : 1;
  const idempotencyKey = `incident:${incident.id}:${isResolution ? "fixed" : "open"}`;

  const notice = await claimIncidentNotice(env.DB, {
    incidentId: incident.id,
    pageId: incident.page_id,
    now: new Date(),
    isResolution,
  });
  if (!notice) {
    return { outcome: "duplicate", attempt_id: null, idempotency_key: idempotencyKey };
  }

  const claim = await claimSendAttempt(env.DB, {
    idempotencyKey,
    workspaceId: incident.workspace_id,
    targetId: target.id,
    digestId: null,
  });
  if (!claim) {
    return { outcome: "duplicate", attempt_id: null, idempotency_key: idempotencyKey };
  }

  let sent = false;
  try {
    const rendered =
      incident.closed_at === null
        ? renderIncidentOpen({
            site: incident.domain,
            kind: incident.kind,
            opened_at: incident.opened_at,
            recheck_at: new Date(Date.parse(incident.opened_at) + RECHECK_AFTER_MS).toISOString(),
            mark: incident.mark,
            link: INCIDENT_LINK,
          })
        : renderIncidentFixed({
            site: incident.domain,
            kind: incident.kind,
            closed_at: incident.closed_at,
            link: INCIDENT_LINK,
          });
    const result = await sendMessage(env.EMAIL, {
      to: target.target_value,
      from: "brief@0509.io",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    sent = result.outcome === "sent";
    await resolveSendAttempt(env.DB, claim.id, result.outcome, result.error);
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
    const result =
      "incident_id" in parsed ? await deliverIncident(env, parsed) : await deliver(env, parsed);
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
      return toDeliveryMessage(JSON.parse(body) as unknown);
    } catch {
      return null;
    }
  }
  if (body !== null && typeof body === "object") {
    return toDeliveryMessage(body);
  }
  return null;
}

function toDeliveryMessage(parsed: unknown): DeliveryMessage | null {
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const candidate = parsed as { digest_id?: unknown; incident_id?: unknown };
  if (typeof candidate.digest_id === "string") {
    return { digest_id: candidate.digest_id };
  }
  if (typeof candidate.incident_id === "string") {
    return { incident_id: candidate.incident_id };
  }
  return null;
}
