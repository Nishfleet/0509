import { markDigestSentStatement } from "../../app/lib/data/digest.server";
import { claimIncidentNotice } from "../../app/lib/data/incident_notice.server";
import { claimChangeSlot, claimSendAttempt, resolveSendAttempt } from "../../app/lib/data/send_attempt.server";
import { readSlackTarget, writeUnsubscribeToken } from "../../app/lib/data/send_target.server";
import { insertSignalDeliveries } from "../../app/lib/data/signal_delivery.server";
import type { BriefPayload } from "../../app/lib/brief-payload";
import { parseBriefPayload } from "../../app/lib/brief-payload";
import { nextHour } from "../../app/lib/home-standing";
import { slackEscape } from "../../app/lib/slack-webhook";
import { postToSlack } from "../../app/lib/slack.server";
import {
  changeHeadline,
  markFromHunks,
  parseDiffHunks,
  parseSiteChangePayload,
  type SiteChangePayload,
} from "../../app/lib/site-change";
import { pageHost } from "../../app/lib/site/own-site.server";

import { renderBrief } from "./brief-template";
import { SETTINGS_LINK, unsubscribeHeaders, type AlertFooterContext } from "./alert-footer";
import { renderChange, renderChangeOverflow } from "./change-template";
import { renderIncidentFixed, renderIncidentOpen } from "./incident-template";
import { errorText, sendMessage, type SendResult } from "./send";

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

export interface ChangeMessage {
  signal_id: string;
}

export type DeliveryMessage = DigestMessage | IncidentMessage | ChangeMessage;

type DeliveryOutcome =
  | "sent"
  | "failed"
  | "suppressed"
  | "duplicate"
  | "no_target"
  | "no_digest"
  | "no_incident"
  | "not_self"
  | "muted"
  | "no_signal"
  | "capped";

interface DeliveryResult {
  outcome: DeliveryOutcome;
  attempt_id: string | null;
  idempotency_key: string | null;
}

const EMAIL_CHANNEL_KEY = "email";
const INCIDENT_LINK = "https://0509.io/app/alerts";
const CHANGE_LINK = "https://0509.io/app/alerts";
export const CHANGE_DAILY_CAP = 5;

async function readDigest(env: Env, digestId: string): Promise<MessageRow | null> {
  return env.DB.prepare(
    `SELECT id, workspace_id, kind, subject, payload_json
       FROM digest
      WHERE id = ? AND status <> 'failed'`,
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
  page_url: string;
  role: string;
  mark: string | null;
  own_site_alerts: number;
  timezone: string;
}

async function readIncident(env: Env, incidentId: string): Promise<IncidentRow | null> {
  return env.DB.prepare(
    `SELECT i.id,
            i.workspace_id,
            i.page_id,
            i.kind,
            i.opened_at,
            i.closed_at,
            p.url AS page_url,
            e.role,
            w.own_site_alerts,
            w.timezone,
            (SELECT a.body FROM alert a WHERE a.incident_id = i.id ORDER BY a.created_at ASC LIMIT 1) AS mark
       FROM incident i
       JOIN entity e ON e.id = i.entity_id
       JOIN page p ON p.id = i.page_id
       JOIN workspace w ON w.id = i.workspace_id
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
      WHERE st.workspace_id = ? AND c.key = ? AND c.is_enabled = 1 AND st.is_verified = 1
      ORDER BY st.created_at ASC
      LIMIT 1`,
  )
    .bind(workspaceId, EMAIL_CHANNEL_KEY)
    .first<TargetRow>();
}

type NoTargetReason = "no_row" | "channel_disabled" | "unverified";

async function noTarget(
  env: Env,
  workspaceId: string,
  item: { digest_id: string } | { incident_id: string } | { signal_id: string },
): Promise<DeliveryResult> {
  const row = await env.DB.prepare(
    `SELECT st.is_verified, c.is_enabled
       FROM send_target st
       JOIN channel c ON c.id = st.channel_id
      WHERE st.workspace_id = ? AND c.key = ?
      ORDER BY st.created_at ASC
      LIMIT 1`,
  )
    .bind(workspaceId, EMAIL_CHANNEL_KEY)
    .first<{ is_verified: number; is_enabled: number }>();
  const reason: NoTargetReason = row === null ? "no_row" : row.is_enabled === 0 ? "channel_disabled" : "unverified";
  console.log(JSON.stringify({ event: "delivery.no_target", ...item, workspace_id: workspaceId, reason }));
  return { outcome: "no_target", attempt_id: null, idempotency_key: null };
}

async function isSuppressed(env: Env, address: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT address FROM email_suppression WHERE address = ?`)
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
  const row = await env.DB.prepare(`SELECT unsubscribe_token FROM send_target WHERE id = ?`)
    .bind(target.id)
    .first<{ unsubscribe_token: string | null }>();
  if (row?.unsubscribe_token == null) {
    throw new Error("send_target has no unsubscribe token");
  }
  return row.unsubscribe_token;
}

const UNSUBSCRIBE_BASE_URL = "https://0509.io/u/";

const BRIEF_SENDER = { email: "brief@0509.io", name: "Five to Nine" };

function briefOf(message: MessageRow): BriefPayload {
  try {
    return parseBriefPayload(message.payload_json);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new PayloadError(`digest ${message.id}: ${detail}`);
  }
}

function render(message: MessageRow, to: string, token: string): EmailMessageBuilder {
  const payload = briefOf(message);
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}${token}`;
  const rendered = renderBrief(payload, { unsubscribe_url: unsubscribeUrl, asset_base_url: null });
  return {
    to,
    from: BRIEF_SENDER,
    subject: message.subject ?? rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: unsubscribeHeaders(unsubscribeUrl),
  };
}

interface SendAndResolveInput {
  claimId: string;
  idempotencyKey: string;
  send: () => Promise<SendResult>;
  onSent?: () => Promise<void>;
}

async function sendAndResolve(env: Env, input: SendAndResolveInput): Promise<DeliveryResult> {
  const { claimId, idempotencyKey, send, onSent } = input;
  let sent = false;
  try {
    const result = await send();
    sent = result.outcome === "sent";
    await resolveSendAttempt(env.DB, { attemptId: claimId, outcome: result.outcome, error: result.error });
    if (onSent !== undefined && result.outcome === "sent") {
      await onSent();
    }
    return { outcome: result.outcome, attempt_id: claimId, idempotency_key: idempotencyKey };
  } catch (cause) {
    if (sent) throw cause;
    await resolveSendAttempt(env.DB, { attemptId: claimId, outcome: "failed", error: errorText(cause) });
    return { outcome: "failed", attempt_id: claimId, idempotency_key: idempotencyKey };
  }
}

export async function deliver(env: Env, message: DigestMessage): Promise<DeliveryResult> {
  const digest = await readDigest(env, message.digest_id);
  if (!digest) {
    return { outcome: "no_digest", attempt_id: null, idempotency_key: null };
  }

  const target = await readTarget(env, digest.workspace_id);
  if (!target) {
    return noTarget(env, digest.workspace_id, { digest_id: digest.id });
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

  return sendAndResolve(env, {
    claimId: claim.id,
    idempotencyKey,
    send: async () => {
      const token = await ensureUnsubscribeToken(env, target);
      const email = render(digest, target.target_value, token);
      return sendMessage(env.EMAIL, email);
    },
    onSent: () => recordBriefSent(env, { digest, target, attemptId: claim.id }),
  });
}

interface BriefSent {
  digest: MessageRow;
  target: TargetRow;
  attemptId: string;
}

async function recordBriefSent(env: Env, input: BriefSent): Promise<void> {
  const { digest, target, attemptId } = input;
  const now = new Date().toISOString();
  await env.DB.batch([
    markDigestSentStatement(env.DB, digest.id, now),
    insertSignalDeliveries(env.DB, {
      workspaceId: digest.workspace_id,
      channelId: target.channel_id,
      sendAttemptId: attemptId,
      deliveredAt: now,
      signalIds: briefOf(digest).read_this_first.map((mark) => mark.signal_id),
    }),
  ]);
}

function renderIncidentEmail(incident: IncidentRow, to: string, token: string) {
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}${token}`;
  const site = pageHost(incident.page_url);
  const rendered =
    incident.closed_at === null
      ? renderIncidentOpen({
          site,
          kind: incident.kind,
          opened_at: incident.opened_at,
          recheck_at: nextHour(new Date(incident.opened_at)).toISOString(),
          mark: incident.mark,
          link: INCIDENT_LINK,
          timezone: incident.timezone,
          unsubscribe_url: unsubscribeUrl,
          settings_link: SETTINGS_LINK,
        })
      : renderIncidentFixed({
          site,
          kind: incident.kind,
          closed_at: incident.closed_at,
          link: INCIDENT_LINK,
          timezone: incident.timezone,
          unsubscribe_url: unsubscribeUrl,
          settings_link: SETTINGS_LINK,
        });
  return {
    to,
    from: BRIEF_SENDER,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: unsubscribeHeaders(unsubscribeUrl),
  };
}

export async function deliverIncident(env: Env, message: IncidentMessage): Promise<DeliveryResult> {
  const incident = await readIncident(env, message.incident_id);
  if (!incident) {
    return { outcome: "no_incident", attempt_id: null, idempotency_key: null };
  }
  if (incident.role !== "self") {
    return { outcome: "not_self", attempt_id: null, idempotency_key: null };
  }

  if (incident.own_site_alerts === 0) {
    return { outcome: "muted", attempt_id: null, idempotency_key: null };
  }

  const target = await readTarget(env, incident.workspace_id);
  if (!target) {
    return noTarget(env, incident.workspace_id, { incident_id: incident.id });
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

  return sendAndResolve(env, {
    claimId: claim.id,
    idempotencyKey,
    send: async () => {
      const token = await ensureUnsubscribeToken(env, target);
      return sendMessage(env.EMAIL, renderIncidentEmail(incident, target.target_value, token));
    },
  });
}

interface ChangeRow {
  id: string;
  workspace_id: string;
  payload_json: string;
  observed_at: string;
  name: string | null;
  domain: string;
  change_alerts: number;
  timezone: string;
}

async function readChange(env: Env, signalId: string): Promise<ChangeRow | null> {
  return env.DB.prepare(
    `SELECT s.id, s.workspace_id, s.payload_json, s.observed_at, e.name, e.domain, w.change_alerts, w.timezone
       FROM signal s
       JOIN entity e ON e.id = s.entity_id
       JOIN workspace w ON w.id = s.workspace_id
      WHERE s.id = ? AND e.role = 'competitor' AND s.is_tombstoned = 0`,
  )
    .bind(signalId)
    .first<ChangeRow>();
}

async function readChangeMark(env: Env, diffKey: string | null) {
  if (diffKey === null) return null;
  const stored = await env.SNAPSHOTS.get(diffKey);
  const hunks = stored === null ? null : parseDiffHunks(await stored.text());
  return hunks === null ? null : markFromHunks(hunks);
}

async function renderChangeEmail(
  env: Env,
  input: { change: ChangeRow; payload: SiteChangePayload; capped: boolean; footer: AlertFooterContext },
) {
  const { change, payload, capped, footer } = input;
  if (capped) return renderChangeOverflow({ ...footer, cap: CHANGE_DAILY_CAP, link: CHANGE_LINK });
  return renderChange({
    ...footer,
    headline: changeHeadline({ name: change.name ?? change.domain, isSelf: false, role: payload.page.role }),
    observed_at: change.observed_at,
    mark: await readChangeMark(env, payload.diffKey),
    link: CHANGE_LINK,
    timezone: change.timezone,
  });
}

async function claimChange(
  env: Env,
  input: { change: ChangeRow; target: TargetRow },
): Promise<{ claim: { id: string } | null; capped: boolean; idempotencyKey: string }> {
  const { change, target } = input;
  const day = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `change:${change.id}:${target.id}`;
  const slot = await claimChangeSlot(env.DB, {
    idempotencyKey,
    workspaceId: change.workspace_id,
    targetId: target.id,
    since: `${day}T00:00:00.000Z`,
    cap: CHANGE_DAILY_CAP,
  });
  if (slot.kind === "claimed") return { claim: { id: slot.id }, capped: false, idempotencyKey };
  if (slot.kind === "duplicate") return { claim: null, capped: false, idempotencyKey };
  const overflowKey = `change-overflow:${change.workspace_id}:${day}`;
  const overflow = await claimSendAttempt(env.DB, {
    idempotencyKey: overflowKey,
    workspaceId: change.workspace_id,
    targetId: target.id,
    digestId: null,
  });
  return { claim: overflow, capped: true, idempotencyKey: overflowKey };
}

async function sendChange(
  env: Env,
  input: { change: ChangeRow; payload: SiteChangePayload; target: TargetRow },
): Promise<DeliveryResult> {
  const { change, payload, target } = input;
  const { claim, capped, idempotencyKey } = await claimChange(env, { change, target });
  if (claim === null) {
    return { outcome: capped ? "capped" : "duplicate", attempt_id: null, idempotency_key: idempotencyKey };
  }

  const result = await sendAndResolve(env, {
    claimId: claim.id,
    idempotencyKey,
    send: async () => {
      const token = await ensureUnsubscribeToken(env, target);
      const footer = { unsubscribe_url: `${UNSUBSCRIBE_BASE_URL}${token}`, settings_link: SETTINGS_LINK };
      const rendered = await renderChangeEmail(env, { change, payload, capped, footer });
      return sendMessage(env.EMAIL, {
        to: target.target_value,
        from: BRIEF_SENDER,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: unsubscribeHeaders(footer.unsubscribe_url),
      });
    },
  });
  return capped && result.outcome === "sent" ? { ...result, outcome: "capped" } : result;
}

function slackText(change: ChangeRow, payload: SiteChangePayload, mark: Awaited<ReturnType<typeof readChangeMark>>) {
  const headline = changeHeadline({ name: change.name ?? change.domain, isSelf: false, role: payload.page.role });
  return [
    `*${slackEscape(headline)}*`,
    ...(mark?.removed == null ? [] : [`Before: ${slackEscape(mark.removed)}`]),
    ...(mark?.added == null ? [] : [`After: ${slackEscape(mark.added)}`]),
    `<${CHANGE_LINK}|See the before and after in Five to Nine>`,
  ].join("\n");
}

async function postChangeToSlack(
  env: Env,
  input: { change: ChangeRow; payload: SiteChangePayload },
): Promise<DeliveryResult | null> {
  const { change, payload } = input;
  const target = await readSlackTarget(env.DB, change.workspace_id);
  if (target === null) return null;
  const idempotencyKey = `change-slack:${change.id}:${target.id}`;
  const claim = await claimSendAttempt(env.DB, {
    idempotencyKey,
    workspaceId: change.workspace_id,
    targetId: target.id,
    digestId: null,
  });
  if (!claim) return { outcome: "duplicate", attempt_id: null, idempotency_key: idempotencyKey };
  return sendAndResolve(env, {
    claimId: claim.id,
    idempotencyKey,
    send: async () => {
      const text = slackText(change, payload, await readChangeMark(env, payload.diffKey));
      const posted = await postToSlack(target.target_value, text);
      return posted ? { outcome: "sent", error: null } : { outcome: "failed", error: "slack did not accept the post" };
    },
  });
}

async function emailChange(
  env: Env,
  input: { change: ChangeRow; payload: SiteChangePayload },
): Promise<DeliveryResult> {
  const { change, payload } = input;
  const target = await readTarget(env, change.workspace_id);
  if (!target) {
    return noTarget(env, change.workspace_id, { signal_id: change.id });
  }
  if (await isSuppressed(env, target.target_value)) {
    return { outcome: "suppressed", attempt_id: null, idempotency_key: null };
  }
  return sendChange(env, { change, payload, target });
}

export async function deliverChange(env: Env, message: ChangeMessage): Promise<DeliveryResult> {
  const change = await readChange(env, message.signal_id);
  const payload = change === null ? null : parseSiteChangePayload(change.payload_json);
  if (change === null || payload === null) {
    return { outcome: "no_signal", attempt_id: null, idempotency_key: null };
  }
  if (change.change_alerts === 0) {
    return { outcome: "muted", attempt_id: null, idempotency_key: null };
  }
  const slack = await postChangeToSlack(env, { change, payload });
  const email = await emailChange(env, { change, payload });
  return slack?.outcome === "failed" ? slack : email;
}

function route(env: Env, parsed: DeliveryMessage): Promise<DeliveryResult> {
  if ("incident_id" in parsed) return deliverIncident(env, parsed);
  if ("signal_id" in parsed) return deliverChange(env, parsed);
  return deliver(env, parsed);
}

export async function handleBatch(env: Env, batch: MessageBatch): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  for (const item of batch.messages) {
    const parsed = parseMessage(item.body);
    if (!parsed) {
      item.ack();
      results.push({ outcome: "no_digest", attempt_id: null, idempotency_key: null });
      continue;
    }
    const result = await route(env, parsed);
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
    } catch (error) {
      console.error(JSON.stringify({ event: "delivery.message_unparseable", error: String(error) }));
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
  const candidate = parsed as { digest_id?: unknown; incident_id?: unknown; signal_id?: unknown };
  if (typeof candidate.digest_id === "string") {
    return { digest_id: candidate.digest_id };
  }
  if (typeof candidate.incident_id === "string") {
    return { incident_id: candidate.incident_id };
  }
  if (typeof candidate.signal_id === "string") {
    return { signal_id: candidate.signal_id };
  }
  return null;
}
