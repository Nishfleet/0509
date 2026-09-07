/**
 * Share-link D1 persistence (create / resolve / list / revoke).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` directly
 * (no `~/lib/data.server` cycle).
 */

import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  parseJson,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  AppSession,
  ShareLinkRecord,
  ShareResourceType,
} from "~/lib/types";

interface ShareLinkRow {
  id: string;
  token: string;
  user_id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  is_snapshot: number;
  snapshot_payload_json: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export const SHARE_LINK_DEFAULT_TTL_DAYS = 90;

export interface AtomicShareLinkInsertInput {
  auditId: string;
  /** The actor owns the audit record; userId remains the workspace owner. */
  auditUserId?: string;
  /** Null is reserved for trusted in-process actions without an API key. */
  apiKeyId?: string | null;
  userId: string;
  actionName: "share.create" | "report.share";
  idempotencyKey: string;
  requestFingerprint: string;
  resourceType: ShareResourceType;
  resourceId: string;
  ownerResourceType: "collection" | "watchlist" | "digest";
  isSnapshot: boolean;
  snapshotPayload?: JsonRecord | null;
  shareId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Prepare the single share-link INSERT used by atomic customer-agent actions.
 * The audit claim and live owner row are both predicates on the INSERT so a
 * stale/member claim cannot create a bearer link.
 */
export function prepareAtomicShareLinkInsert(
  db: D1Database,
  input: AtomicShareLinkInsertInput,
) {
  const auditUserId = input.auditUserId ?? input.userId;
  const apiKeyId = input.apiKeyId ?? null;
  const ownerTable =
    input.ownerResourceType === "collection"
      ? "collection"
      : input.ownerResourceType === "watchlist"
        ? "watchlist"
        : "digest_run";
  return db
    .prepare(
      `
      INSERT INTO share_link (
        id,
        token,
        user_id,
        resource_type,
        resource_id,
        is_snapshot,
        snapshot_payload_json,
        created_at,
        expires_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM agent_action_audit
        WHERE id = ?
          AND user_id = ?
          AND action_name = ?
          AND idempotency_key = ?
          AND status = 'started'
          AND json_extract(metadata_json, '$.requestFingerprint') = ?
          AND (
            (? IS NULL AND api_key_id IS NULL)
            OR EXISTS (
              SELECT 1
              FROM customer_api_key live_api_key
              WHERE live_api_key.id = ?
                AND live_api_key.id = agent_action_audit.api_key_id
                AND live_api_key.user_id = agent_action_audit.user_id
                AND live_api_key.revoked_at IS NULL
            )
          )
      )
        AND (
          ? = ?
          OR EXISTS (
            SELECT 1
            FROM workspace_member live_membership
            WHERE live_membership.owner_user_id = ?
              AND live_membership.member_user_id = ?
              AND live_membership.status = 'active'
          )
        )
        AND EXISTS (
          SELECT 1
          FROM ${ownerTable}
          WHERE id = ?
            AND user_id = ?
        )
    `,
    )
    .bind(
      input.shareId,
      input.token,
      input.userId,
      input.resourceType,
      input.resourceId,
      input.isSnapshot ? 1 : 0,
      input.snapshotPayload ? jsonValue(input.snapshotPayload) : null,
      input.createdAt,
      input.expiresAt,
      input.auditId,
      auditUserId,
      input.actionName,
      input.idempotencyKey,
      input.requestFingerprint,
      apiKeyId,
      apiKeyId,
      auditUserId,
      input.userId,
      input.userId,
      auditUserId,
      input.resourceType === "report"
        ? input.resourceId.slice(input.resourceId.indexOf(":") + 1)
        : input.resourceId,
      input.userId,
    );
}

function toShareLinkRecord(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    token: row.token,
    userId: row.user_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    isSnapshot: row.is_snapshot === 1,
    snapshotPayload: parseJson<JsonRecord | null>(
      row.snapshot_payload_json,
      null,
    ),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
  } satisfies ShareLinkRecord;
}

export async function createShareLink(
  env: AppEnv,
  session: AppSession,
  input: {
    id?: string;
    resourceType: ShareResourceType;
    resourceId: string;
    isSnapshot: boolean;
    snapshotPayload?: JsonRecord | null;
    expiresAt?: string | null;
  },
) {
  const id = input.id ?? createId();
  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt =
    input.expiresAt !== undefined
      ? input.expiresAt
      : new Date(
          Date.now() + SHARE_LINK_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
  await run(
    env,
    `
      ${input.id ? "INSERT OR IGNORE INTO" : "INSERT INTO"} share_link (
        id,
        token,
        user_id,
        resource_type,
        resource_id,
        is_snapshot,
        snapshot_payload_json,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    token,
    session.user.id,
    input.resourceType,
    input.resourceId,
    input.isSnapshot ? 1 : 0,
    input.snapshotPayload ? jsonValue(input.snapshotPayload) : null,
    nowIso(),
    expiresAt,
  );

  if (input.id) {
    const active = await getShareLinkById(env, session.user.id, id);
    if (!active) {
      throw new Error("share_link_inactive");
    }
    return {
      id: active.id,
      token: active.token,
      expiresAt: active.expiresAt,
    };
  }

  return { id, token, expiresAt };
}

export async function getShareLink(env: AppEnv, token: string) {
  // Share tokens are bearer credentials; expired or revoked links must
  // behave exactly like links that never existed. expires_at NULL is legacy
  // (pre-expiry links customers already sent out).
  // Deliberate anti-enumeration choice (W2-C, 2026-07-25): never-existed,
  // expired, and revoked tokens all collapse to `null` here via the WHERE
  // clause so a holder can't distinguish "wrong token" from "was valid, now
  // gone". Kinder per-state copy ("this link expired" vs "was revoked") would
  // require the query layer to fetch the row unfiltered and return the reason —
  // a deliberate leak we are not making. Do not split these states in copy
  // without changing this query and accepting the enumeration trade-off.
  const row = await one<ShareLinkRow>(
    env,
    `
      SELECT *
      FROM share_link
      WHERE token = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `,
    token,
    nowIso(),
  );

  if (!row) {
    return null;
  }

  return toShareLinkRecord(row);
}

export async function getShareLinkById(
  env: AppEnv,
  userId: string,
  shareLinkId: string,
) {
  const row = await one<ShareLinkRow>(
    env,
    `
      SELECT *
      FROM share_link
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `,
    shareLinkId,
    userId,
    nowIso(),
  );

  return row ? toShareLinkRecord(row) : null;
}

export async function listActiveShareLinks(
  env: AppEnv,
  userId: string,
  limit = 50,
) {
  const rows = await many<ShareLinkRow>(
    env,
    `
      SELECT *
      FROM share_link
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
      LIMIT ?
    `,
    userId,
    nowIso(),
    limit,
  );

  return rows.map(toShareLinkRecord);
}

export async function revokeShareLink(
  env: AppEnv,
  userId: string,
  shareLinkId: string,
) {
  const db = ensureDb(env);
  const result = await db
    .prepare(
      `
        UPDATE share_link
        SET revoked_at = ?
        WHERE id = ?
          AND user_id = ?
          AND revoked_at IS NULL
      `,
    )
    .bind(nowIso(), shareLinkId, userId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}
