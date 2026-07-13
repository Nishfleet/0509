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

function toShareLinkRecord(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    token: row.token,
    userId: row.user_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    isSnapshot: row.is_snapshot === 1,
    snapshotPayload: parseJson<JsonRecord | null>(row.snapshot_payload_json, null),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
  } satisfies ShareLinkRecord;
}

export async function createShareLink(
  env: AppEnv,
  session: AppSession,
  input: {
    resourceType: ShareResourceType;
    resourceId: string;
    isSnapshot: boolean;
    snapshotPayload?: JsonRecord | null;
    expiresAt?: string | null;
  },
) {
  const id = createId();
  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt =
    input.expiresAt !== undefined
      ? input.expiresAt
      : new Date(Date.now() + SHARE_LINK_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await run(
    env,
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

  return { id, token, expiresAt };
}

export async function getShareLink(env: AppEnv, token: string) {
  // Share tokens are bearer credentials; expired or revoked links must
  // behave exactly like links that never existed. expires_at NULL is legacy
  // (pre-expiry links customers already sent out).
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

export async function getShareLinkById(env: AppEnv, userId: string, shareLinkId: string) {
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

export async function listActiveShareLinks(env: AppEnv, userId: string, limit = 50) {
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

export async function revokeShareLink(env: AppEnv, userId: string, shareLinkId: string) {
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
