import { env } from "cloudflare:workers";

import { normalizeEmailAddress } from "../email-address";
import {
  decryptSlackWebhookWithKeys,
  encryptSlackWebhook,
  isEncryptedSlackTarget,
  parseSlackTargetKeys,
  slackTargetKeyId,
} from "../slack-target-crypto.server";
import { parseSlackWebhook } from "../slack-webhook";
import { sha256Hex } from "../sha256";

const WRITE_UNSUBSCRIBE_TOKEN = `UPDATE send_target SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL`;

const SELECT_EMAIL_TARGET = `SELECT st.target_value, st.is_verified FROM send_target st
JOIN channel c ON c.id = st.channel_id
WHERE st.workspace_id = ? AND c.key = 'email'
ORDER BY st.created_at ASC
LIMIT 1`;

const WRITE_VERIFY_TOKEN = `UPDATE send_target SET verify_token = ?, verify_token_expires_at = ?
WHERE id = (
  SELECT st.id FROM send_target st
  JOIN channel c ON c.id = st.channel_id
  WHERE st.workspace_id = ? AND c.key = 'email'
  ORDER BY st.created_at ASC
  LIMIT 1
)`;

const MARK_EMAIL_TARGET_VERIFIED = `UPDATE send_target SET is_verified = 1, verify_token = NULL, verify_token_expires_at = NULL
WHERE id = (
  SELECT st.id FROM send_target st
  JOIN channel c ON c.id = st.channel_id
  WHERE st.workspace_id = ? AND c.key = 'email'
  ORDER BY st.created_at ASC
  LIMIT 1
)`;

const CHANGE_EMAIL_TARGET = `UPDATE send_target
SET target_value = ?, is_verified = 0, unsubscribe_token = NULL, verify_token = NULL, verify_token_expires_at = NULL
WHERE workspace_id = ?
  AND channel_id = (SELECT id FROM channel WHERE key = 'email')
  AND lower(trim(target_value)) <> lower(trim(?))`;

const CONFIRM_EMAIL_TARGET_BY_TOKEN = `UPDATE send_target SET is_verified = 1, verify_token = NULL, verify_token_expires_at = NULL
WHERE verify_token = ? AND verify_token_expires_at > ?`;

const SELECT_EMAIL_TARGET_BY_TOKEN = `SELECT target_value FROM send_target
WHERE verify_token = ? AND verify_token_expires_at > ?`;

const INSERT_OWNER_EMAIL_TARGET = `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
SELECT 'st-email-' || w.id, w.id, c.id, lower(trim(u.email)), u.emailVerified, ?
  FROM workspace w
  JOIN "user" u ON u.id = w.owner_user_id
  JOIN channel c ON c.key = 'email'
 WHERE w.id = ?
   AND NOT EXISTS (
     SELECT 1 FROM send_target st WHERE st.workspace_id = w.id AND st.channel_id = c.id
   )`;

interface TargetDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export async function writeUnsubscribeToken(db: D1Database, input: { targetId: string; token: string }): Promise<void> {
  await db.prepare(WRITE_UNSUBSCRIBE_TOKEN).bind(input.token, input.targetId).run();
}

export async function ensureOwnerEmailTarget(db: TargetDb, input: { workspaceId: string; now: string }): Promise<void> {
  await db.prepare(INSERT_OWNER_EMAIL_TARGET).bind(input.now, input.workspaceId).run();
}

export async function readEmailTarget(
  db: TargetDb,
  workspaceId: string,
): Promise<{ target_value: string; is_verified: number } | null> {
  const row = await db
    .prepare(SELECT_EMAIL_TARGET)
    .bind(workspaceId)
    .first<{ target_value: string; is_verified: number }>();
  return row ?? null;
}

export async function writeVerifyToken(
  db: TargetDb,
  input: { workspaceId: string; token: string; expiresAt: string },
): Promise<void> {
  const tokenHash = await sha256Hex(input.token);
  await db.prepare(WRITE_VERIFY_TOKEN).bind(tokenHash, input.expiresAt, input.workspaceId).run();
}

export async function markEmailTargetVerified(db: TargetDb, input: { workspaceId: string }): Promise<void> {
  await db.prepare(MARK_EMAIL_TARGET_VERIFIED).bind(input.workspaceId).run();
}

export async function changeEmailTarget(db: TargetDb, input: { workspaceId: string; address: string }): Promise<void> {
  const address = normalizeEmailAddress(input.address);
  await db.prepare(CHANGE_EMAIL_TARGET).bind(address, input.workspaceId, address).run();
}

export async function readEmailTargetByToken(
  db: TargetDb,
  input: { token: string; now: string },
): Promise<string | null> {
  const tokenHash = await sha256Hex(input.token);
  const row = await db
    .prepare(SELECT_EMAIL_TARGET_BY_TOKEN)
    .bind(tokenHash, input.now)
    .first<{ target_value: string }>();
  return row?.target_value ?? null;
}

export async function confirmEmailTargetByToken(db: TargetDb, input: { token: string; now: string }): Promise<void> {
  const tokenHash = await sha256Hex(input.token);
  await db.prepare(CONFIRM_EMAIL_TARGET_BY_TOKEN).bind(tokenHash, input.now).run();
}

const SELECT_SLACK_TARGET = `SELECT st.id, st.target_value FROM send_target st
JOIN channel c ON c.id = st.channel_id
WHERE st.workspace_id = ? AND c.key = 'slack' AND c.is_enabled = 1 AND st.is_verified = 1
ORDER BY st.created_at ASC
LIMIT 1`;

const DELETE_SLACK_TARGET = `DELETE FROM send_target
WHERE workspace_id = ? AND channel_id = (SELECT id FROM channel WHERE key = 'slack')`;

const INSERT_SLACK_TARGET = `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
SELECT ?, ?, id, ?, 1, ? FROM channel WHERE key = 'slack'`;

const SELECT_UNSEALED_SLACK_TARGETS = `SELECT st.id, st.workspace_id, st.target_value FROM send_target st
JOIN channel c ON c.id = st.channel_id
WHERE c.key = 'slack' AND st.id > ? AND st.seal_attempts < ? AND st.target_value NOT LIKE 'enc:v2:' || ? || ':%'
ORDER BY st.id ASC
LIMIT ?`;

const SEAL_SLACK_TARGET = `UPDATE send_target SET target_value = ? WHERE id = ? AND target_value = ?`;

const RECORD_FAILED_SEAL = `UPDATE send_target SET seal_attempts = seal_attempts + 1 WHERE id = ?`;

const COUNT_UNSEALED_SLACK_TARGETS = `SELECT COUNT(*) AS remaining FROM send_target st
JOIN channel c ON c.id = st.channel_id
WHERE c.key = 'slack' AND st.seal_attempts < ? AND st.target_value NOT LIKE 'enc:v2:' || ? || ':%'`;

const COUNT_STUCK_SLACK_TARGETS = `SELECT COUNT(*) AS stuck FROM send_target st
JOIN channel c ON c.id = st.channel_id
WHERE c.key = 'slack' AND st.seal_attempts >= ? AND st.target_value NOT LIKE 'enc:v2:' || ? || ':%'`;

const DEFAULT_BACKFILL_BATCH = 50;
const NIGHTLY_SLACK_BACKFILL_CAP = 500;
const MAX_SEAL_ATTEMPTS = 3;

interface SlackTargetRow {
  id: string;
  workspace_id: string;
  target_value: string;
}

export interface SlackBackfillResult {
  readonly sealed: number;
  readonly skipped: number;
  readonly failed: number;
}

type SlackBackfillOutcome = keyof SlackBackfillResult;

function slackTargetKeys(): Promise<readonly string[]> {
  return parseSlackTargetKeys(env.SLACK_TARGET_SECRET);
}

async function slackTargetWriteSecret(): Promise<string> {
  const [current] = await slackTargetKeys();
  if (current === undefined) throw new Error("SLACK_TARGET_SECRET is not configured");
  return current;
}

export async function readSlackTarget(
  db: TargetDb,
  workspaceId: string,
): Promise<{ id: string; target_value: string } | null> {
  const row = await db.prepare(SELECT_SLACK_TARGET).bind(workspaceId).first<{ id: string; target_value: string }>();
  if (row === null) return null;
  if (isEncryptedSlackTarget(row.target_value)) {
    const webhook = await decryptSlackWebhookWithKeys(row.target_value, await slackTargetKeys(), workspaceId);
    return { id: row.id, target_value: webhook };
  }
  const webhook = parseSlackWebhook(row.target_value);
  if (webhook === null) throw new Error("Slack target is not a webhook address");
  return { id: row.id, target_value: webhook };
}

async function openSlackTarget(row: SlackTargetRow, keys: readonly string[]): Promise<string | null> {
  if (!isEncryptedSlackTarget(row.target_value)) return parseSlackWebhook(row.target_value);
  return decryptSlackWebhookWithKeys(row.target_value, keys, row.workspace_id).catch(() => null);
}

async function recordFailedSeal(db: D1Database, id: string): Promise<"failed"> {
  await db.prepare(RECORD_FAILED_SEAL).bind(id).run();
  return "failed";
}

async function sealSlackTargetRow(
  db: D1Database,
  row: SlackTargetRow,
  keys: readonly string[],
): Promise<SlackBackfillOutcome> {
  const webhook = await openSlackTarget(row, keys);
  const [current] = keys;
  if (webhook === null || current === undefined) return recordFailedSeal(db, row.id);
  const sealed = await encryptSlackWebhook(webhook, current, row.workspace_id);
  const result = await db.prepare(SEAL_SLACK_TARGET).bind(sealed, row.id, row.target_value).run();
  return result.meta.changes === 1 ? "sealed" : "skipped";
}

function addOutcome(total: SlackBackfillResult, outcome: SlackBackfillOutcome): SlackBackfillResult {
  return { ...total, [outcome]: total[outcome] + 1 };
}

function cappedCount(total: SlackBackfillResult): number {
  return total.sealed + total.skipped;
}

export async function backfillSlackTargets(
  db: D1Database,
  options: { batchSize?: number; maxRows?: number } = {},
): Promise<SlackBackfillResult> {
  const keys = await slackTargetKeys();
  const [current] = keys;
  if (current === undefined) throw new Error("SLACK_TARGET_SECRET is not configured");
  const currentId = await slackTargetKeyId(current);
  const batchSize = options.batchSize ?? DEFAULT_BACKFILL_BATCH;
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  let total: SlackBackfillResult = { sealed: 0, skipped: 0, failed: 0 };
  let cursor = "";
  while (cappedCount(total) < maxRows) {
    const limit = Math.min(batchSize, maxRows - cappedCount(total));
    const page = await db
      .prepare(SELECT_UNSEALED_SLACK_TARGETS)
      .bind(cursor, MAX_SEAL_ATTEMPTS, currentId, limit)
      .all<SlackTargetRow>();
    for (const row of page.results) total = addOutcome(total, await sealSlackTargetRow(db, row, keys));
    const last = page.results.at(-1);
    if (last === undefined || page.results.length < limit) break;
    cursor = last.id;
  }
  return total;
}

async function currentKeyId(): Promise<string> {
  const [current] = await slackTargetKeys();
  if (current === undefined) throw new Error("SLACK_TARGET_SECRET is not configured");
  return slackTargetKeyId(current);
}

export async function countUnsealedSlackTargets(db: D1Database): Promise<number> {
  const row = await db
    .prepare(COUNT_UNSEALED_SLACK_TARGETS)
    .bind(MAX_SEAL_ATTEMPTS, await currentKeyId())
    .first<{ remaining: number }>();
  return row?.remaining ?? 0;
}

async function countStuckSlackTargets(db: D1Database): Promise<number> {
  const row = await db
    .prepare(COUNT_STUCK_SLACK_TARGETS)
    .bind(MAX_SEAL_ATTEMPTS, await currentKeyId())
    .first<{ stuck: number }>();
  return row?.stuck ?? 0;
}

export async function runNightlySlackBackfill(db: D1Database, options: { maxRows?: number } = {}): Promise<number> {
  const result = await backfillSlackTargets(db, { maxRows: options.maxRows ?? NIGHTLY_SLACK_BACKFILL_CAP });
  const remaining = await countUnsealedSlackTargets(db);
  const stuck = await countStuckSlackTargets(db);
  if (remaining > 0 || stuck > 0) {
    console.info(JSON.stringify({ event: "slack_backfill.remaining", remaining, stuck, ...result }));
  }
  return remaining;
}

export async function removeSlackTarget(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(DELETE_SLACK_TARGET).bind(workspaceId).run();
}

export async function saveSlackTarget(
  db: D1Database,
  input: { workspaceId: string; webhookUrl: string; now: string },
): Promise<void> {
  const sealed = await encryptSlackWebhook(input.webhookUrl, await slackTargetWriteSecret(), input.workspaceId);
  await db.batch([
    db.prepare(DELETE_SLACK_TARGET).bind(input.workspaceId),
    db.prepare(INSERT_SLACK_TARGET).bind(crypto.randomUUID(), input.workspaceId, sealed, input.now),
  ]);
}
