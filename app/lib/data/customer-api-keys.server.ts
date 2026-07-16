/**
 * Customer API key + Meta connection persistence (D1).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` only
 * (no `~/lib/data.server` cycle).
 */

import {
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  boolToInt,
  createId,
  nowIso,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  CustomerApiKeyRecord,
  CustomerMetaConnectionRecord,
} from "~/lib/types";

interface CustomerApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  actions_write_enabled: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CustomerMetaConnectionRow {
  user_id: string;
  encrypted_access_token: string;
  token_last_four: string;
  token_fingerprint: string;
  status: CustomerMetaConnectionRecord["status"];
  summary: string;
  last_checked_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

function toCustomerApiKeyRecord(row: CustomerApiKeyRow): CustomerApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    actionsWriteEnabled: row.actions_write_enabled === 1,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCustomerMetaConnectionRecord(
  row: CustomerMetaConnectionRow,
): CustomerMetaConnectionRecord {
  return {
    userId: row.user_id,
    encryptedAccessToken: row.encrypted_access_token,
    tokenLastFour: row.token_last_four,
    tokenFingerprint: row.token_fingerprint,
    status: row.status,
    summary: row.summary,
    lastCheckedAt: row.last_checked_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomerApiKeys(env: AppEnv, userId: string) {
  const rows = await many<CustomerApiKeyRow>(
    env,
    `
      SELECT *
      FROM customer_api_key
      WHERE user_id = ?
      ORDER BY revoked_at ASC, created_at DESC
    `,
    userId,
  );

  return rows.map(toCustomerApiKeyRecord);
}

export async function insertCustomerApiKey(
  env: AppEnv,
  input: {
    userId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    actionsWriteEnabled?: boolean;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO customer_api_key (
        id,
        user_id,
        name,
        key_prefix,
        key_hash,
        actions_write_enabled,
        last_used_at,
        revoked_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `,
    id,
    input.userId,
    input.name,
    input.keyPrefix,
    input.keyHash,
    boolToInt(Boolean(input.actionsWriteEnabled)),
    timestamp,
    timestamp,
  );

  const row = await one<CustomerApiKeyRow>(
    env,
    "SELECT * FROM customer_api_key WHERE id = ?",
    id,
  );

  if (!row) {
    throw new Error("Created API key could not be loaded.");
  }

  return toCustomerApiKeyRecord(row);
}

export async function getActiveCustomerApiKeyByHash(env: AppEnv, keyHash: string) {
  const row = await one<CustomerApiKeyRow>(
    env,
    `
      SELECT *
      FROM customer_api_key
      WHERE key_hash = ?
        AND revoked_at IS NULL
      LIMIT 1
    `,
    keyHash,
  );

  return row ? toCustomerApiKeyRecord(row) : null;
}

export async function isActiveCustomerApiKey(
  env: AppEnv,
  input: { apiKeyId: string; userId: string },
) {
  const row = await one<{ active: number }>(
    env,
    `
      SELECT 1 AS active
      FROM customer_api_key
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
      LIMIT 1
    `,
    input.apiKeyId,
    input.userId,
  );

  return row?.active === 1;
}

export async function recordCustomerApiKeyUsed(env: AppEnv, apiKeyId: string) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE customer_api_key
      SET last_used_at = ?,
          updated_at = ?
      WHERE id = ?
        AND revoked_at IS NULL
    `,
    timestamp,
    timestamp,
    apiKeyId,
  );
}

export async function revokeCustomerApiKey(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId: string;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE customer_api_key
      SET revoked_at = ?,
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
    `,
    timestamp,
    timestamp,
    input.apiKeyId,
    input.userId,
  );
}

export async function getCustomerMetaConnection(env: AppEnv, userId: string) {
  const row = await one<CustomerMetaConnectionRow>(
    env,
    `
      SELECT *
      FROM customer_meta_connection
      WHERE user_id = ?
      LIMIT 1
    `,
    userId,
  );

  return row ? toCustomerMetaConnectionRecord(row) : null;
}

export async function upsertCustomerMetaConnection(
  env: AppEnv,
  input: {
    userId: string;
    encryptedAccessToken: string;
    tokenLastFour: string;
    tokenFingerprint: string;
    status: CustomerMetaConnectionRecord["status"];
    summary: string;
    lastCheckedAt?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO customer_meta_connection (
        user_id,
        encrypted_access_token,
        token_last_four,
        token_fingerprint,
        status,
        summary,
        last_checked_at,
        last_error_code,
        last_error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET encrypted_access_token = excluded.encrypted_access_token,
                    token_last_four = excluded.token_last_four,
                    token_fingerprint = excluded.token_fingerprint,
                    status = excluded.status,
                    summary = excluded.summary,
                    last_checked_at = excluded.last_checked_at,
                    last_error_code = excluded.last_error_code,
                    last_error_message = excluded.last_error_message,
                    updated_at = excluded.updated_at
    `,
    input.userId,
    input.encryptedAccessToken,
    input.tokenLastFour,
    input.tokenFingerprint,
    input.status,
    input.summary,
    input.lastCheckedAt ?? timestamp,
    input.lastErrorCode ?? null,
    input.lastErrorMessage ?? null,
    timestamp,
    timestamp,
  );

  return getCustomerMetaConnection(env, input.userId);
}

export async function updateCustomerMetaConnectionStatus(
  env: AppEnv,
  input: {
    userId: string;
    status: CustomerMetaConnectionRecord["status"];
    summary: string;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE customer_meta_connection
      SET status = ?,
          summary = ?,
          last_checked_at = ?,
          last_error_code = ?,
          last_error_message = ?,
          updated_at = ?
      WHERE user_id = ?
    `,
    input.status,
    input.summary,
    timestamp,
    input.lastErrorCode ?? null,
    input.lastErrorMessage ?? null,
    timestamp,
    input.userId,
  );

  return getCustomerMetaConnection(env, input.userId);
}

export async function deleteCustomerMetaConnection(env: AppEnv, userId: string) {
  await run(
    env,
    "DELETE FROM customer_meta_connection WHERE user_id = ?",
    userId,
  );
}
