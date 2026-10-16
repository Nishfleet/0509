import { env } from "cloudflare:workers";
import { z } from "zod";

export const STALE_CLAIM_MS = 60 * 60 * 1000;
const SENT_MARKER_TTL_SECONDS = 8 * 24 * 60 * 60;

const sentMarkerKey = (idempotencyKey: string): string => `send-sent:${idempotencyKey}`;

const KEY_KINDS: readonly (readonly [string, string])[] = [
  ["digest:", "brief"],
  ["brief-slack:", "brief_slack"],
  ["incident:", "incident"],
  ["change-overflow:", "change_overflow"],
  ["change-slack:", "change_slack"],
  ["change:", "change"],
  ["welcome:", "welcome"],
  ["trial-ending:", "trial_ending"],
  ["rivalnudge:", "rival_nudge"],
  ["winback:", "winback"],
  ["recap:", "recap"],
  ["monthly:", "monthly"],
];

export type AccountMailKind =
  "sign_in" | "change_email_approve" | "change_email_confirm" | "address_verify" | "teammate_invite";

function kindOfKey(idempotencyKey: string): string {
  return KEY_KINDS.find(([prefix]) => idempotencyKey.startsWith(prefix))?.[1] ?? "unknown";
}

const MARK_SENT = `UPDATE send_attempt SET status = 'sent', error = NULL WHERE idempotency_key = ? AND status = 'pending'`;

const CLAIM_ATTEMPT = `INSERT INTO send_attempt
  (id, workspace_id, send_target_id, digest_id, idempotency_key, kind, status, attempted_at)
VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
ON CONFLICT(idempotency_key) DO UPDATE
  SET status = 'pending', error = NULL, attempted_at = excluded.attempted_at
  WHERE send_attempt.status = 'failed' OR (send_attempt.status = 'pending' AND send_attempt.attempted_at < ?)
RETURNING id`;

const RESOLVE_ATTEMPT = `UPDATE send_attempt SET status = ?, error = ?, subject = ?, provider_message = ? WHERE id = ?`;

const SENT_UNRECORDED = `SELECT a.id FROM send_attempt a
  JOIN digest d ON d.id = a.digest_id
 WHERE a.idempotency_key = ? AND a.status = 'sent' AND d.status <> 'sent'`;

const readUnrecordedSendRow = z.object({ id: z.string() });

export async function readUnrecordedSend(db: D1Database, idempotencyKey: string): Promise<{ id: string } | null> {
  return readUnrecordedSendRow.nullable().parse(await db.prepare(SENT_UNRECORDED).bind(idempotencyKey).first());
}

const SELECT_ATTEMPT = `SELECT 1 AS present FROM send_attempt WHERE idempotency_key = ?`;

const attemptPresentRow = z.object({ present: z.number() });

export async function hasSendAttempt(db: D1Database, idempotencyKey: string): Promise<boolean> {
  return attemptPresentRow.nullable().parse(await db.prepare(SELECT_ATTEMPT).bind(idempotencyKey).first()) !== null;
}

const claimSendAttemptRow = z.object({ id: z.string() });

async function healUnrecordedSend(db: D1Database, idempotencyKey: string): Promise<boolean> {
  const marker = await env.IDENTITY_CACHE.get(sentMarkerKey(idempotencyKey)).catch(() => null);
  if (marker === null) return false;
  await db.prepare(MARK_SENT).bind(idempotencyKey).run();
  return true;
}

export async function claimSendAttempt(
  db: D1Database,
  input: {
    idempotencyKey: string;
    workspaceId: string;
    targetId: string;
    digestId: string | null;
  },
): Promise<{ id: string } | null> {
  if (await healUnrecordedSend(db, input.idempotencyKey)) return null;
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  return claimSendAttemptRow
    .nullable()
    .parse(
      await db
        .prepare(CLAIM_ATTEMPT)
        .bind(
          input.idempotencyKey,
          input.workspaceId,
          input.targetId,
          input.digestId,
          input.idempotencyKey,
          kindOfKey(input.idempotencyKey),
          now,
          staleBefore,
        )
        .first(),
    );
}

export async function resolveSendAttempt(
  db: D1Database,
  input: {
    attemptId: string;
    idempotencyKey: string;
    outcome: "sent" | "failed" | "unconfirmed" | "skipped_revoked";
    error: string | null;
    subject?: string | null;
    providerId?: string | null;
  },
): Promise<void> {
  try {
    await db
      .prepare(RESOLVE_ATTEMPT)
      .bind(input.outcome, input.error, input.subject ?? null, input.providerId ?? null, input.attemptId)
      .run();
  } catch (cause) {
    if (input.outcome === "sent") {
      await env.IDENTITY_CACHE.put(sentMarkerKey(input.idempotencyKey), "1", {
        expirationTtl: SENT_MARKER_TTL_SECONDS,
      }).catch(() => undefined);
    }
    throw cause;
  }
}

const CLAIM_CHANGE_SLOT = `INSERT INTO send_attempt
  (id, workspace_id, send_target_id, digest_id, idempotency_key, kind, status, attempted_at)
SELECT ?, ?, ?, NULL, ?, 'change', 'pending', ?
WHERE (SELECT COUNT(*) FROM send_attempt
        WHERE workspace_id = ? AND idempotency_key LIKE 'change:%' AND status <> 'failed' AND attempted_at >= ?) < ?
ON CONFLICT(idempotency_key) DO UPDATE
  SET status = 'pending', error = NULL, attempted_at = excluded.attempted_at
  WHERE send_attempt.status = 'failed' OR (send_attempt.status = 'pending' AND send_attempt.attempted_at < ?)
RETURNING id`;

const SELECT_ATTEMPT_KEY = `SELECT 1 AS found FROM send_attempt WHERE idempotency_key = ?`;

export const CHANGE_DEAD_LETTER_STATUS = "dropped";

const DROP_DEAD_LETTERED_CHANGE = `UPDATE send_attempt
  SET status = 'dropped'
  WHERE idempotency_key LIKE ? AND status IN ('pending', 'failed')`;

export async function dropDeadLetteredChange(db: D1Database, signalId: string): Promise<void> {
  await db.prepare(DROP_DEAD_LETTERED_CHANGE).bind(`change:${signalId}:%`).run();
}

export type ChangeSlot = { kind: "claimed"; id: string } | { kind: "duplicate" } | { kind: "capped" };

const claimChangeSlotRow = z.object({ id: z.string() });
const claimChangeSlotExistingRow = z.object({ found: z.number() });

export async function claimChangeSlot(
  db: D1Database,
  input: { idempotencyKey: string; workspaceId: string; targetId: string; since: string; cap: number },
): Promise<ChangeSlot> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const claimed = claimChangeSlotRow
    .nullable()
    .parse(
      await db
        .prepare(CLAIM_CHANGE_SLOT)
        .bind(
          crypto.randomUUID(),
          input.workspaceId,
          input.targetId,
          input.idempotencyKey,
          now,
          input.workspaceId,
          input.since,
          input.cap,
          staleBefore,
        )
        .first(),
    );
  if (claimed !== null) return { kind: "claimed", id: claimed.id };
  const existing = claimChangeSlotExistingRow
    .nullable()
    .parse(await db.prepare(SELECT_ATTEMPT_KEY).bind(input.idempotencyKey).first());
  return existing === null ? { kind: "capped" } : { kind: "duplicate" };
}

const INSERT_ACCOUNT_ATTEMPT = `INSERT INTO send_attempt
  (id, workspace_id, idempotency_key, kind, status, attempted_at)
VALUES (?, ?, ?, ?, 'pending', ?)`;

export async function openAccountAttempt(
  db: D1Database,
  input: { kind: AccountMailKind; workspaceId: string | null },
): Promise<{ id: string; idempotencyKey: string }> {
  const id = crypto.randomUUID();
  const idempotencyKey = `${input.kind}:${id}`;
  await db
    .prepare(INSERT_ACCOUNT_ATTEMPT)
    .bind(id, input.workspaceId, idempotencyKey, input.kind, new Date().toISOString())
    .run();
  return { id, idempotencyKey };
}
