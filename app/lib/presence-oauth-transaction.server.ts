import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorId } from "~/lib/presence-types";

const encoder = new TextEncoder();
const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const PKCE_VERIFIER_BYTES = 32;

export interface PresenceOAuthTransaction {
  id: string;
  userId: string;
  workspaceUserId: string;
  connectorId: PresenceConnectorId;
  callbackUri: string;
  returnPath: string;
  pkceVerifier: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface CreatePresenceOAuthTransactionInput {
  userId: string;
  workspaceUserId: string;
  connectorId: PresenceConnectorId;
  callbackUri: string;
  returnPath: string;
}

export type PresenceOAuthTransactionErrorCode =
  | "secret_missing"
  | "invalid_state"
  | "transaction_not_found"
  | "transaction_expired"
  | "transaction_consumed"
  | "user_mismatch"
  | "workspace_mismatch"
  | "connector_mismatch"
  | "callback_mismatch";

function requireDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("D1 database is not configured.");
  }
  return env.DB;
}

function oauthStateSecret(env: AppEnv) {
  return env.PRESENCE_OAUTH_STATE_SECRET?.trim() ?? "";
}

export function presenceOAuthConfigured(env: AppEnv) {
  return oauthStateSecret(env).length >= 32;
}

async function importOAuthStateKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function randomBase64Url(bytes: number) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return btoa(String.fromCharCode(...buffer))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function generatePkcePair() {
  const verifier = randomBase64Url(PKCE_VERIFIER_BYTES);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

export async function signPresenceOAuthState(env: AppEnv, transactionId: string) {
  const secret = oauthStateSecret(env);
  if (!secret) {
    return null;
  }
  const key = await importOAuthStateKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(transactionId));
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${transactionId}.${hex}`;
}

export async function verifyPresenceOAuthState(env: AppEnv, state: string) {
  const secret = oauthStateSecret(env);
  if (!secret) {
    return { ok: false as const, code: "secret_missing" as const };
  }

  const separator = state.lastIndexOf(".");
  if (separator <= 0) {
    return { ok: false as const, code: "invalid_state" as const };
  }

  const transactionId = state.slice(0, separator);
  const signature = state.slice(separator + 1).trim().toLowerCase();
  if (!transactionId || !/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false as const, code: "invalid_state" as const };
  }

  const key = await importOAuthStateKey(secret);
  const signatureBytes = new Uint8Array(signature.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(transactionId),
  );
  if (!valid) {
    return { ok: false as const, code: "invalid_state" as const };
  }

  return { ok: true as const, transactionId };
}

export async function createPresenceOAuthTransaction(
  env: AppEnv,
  input: CreatePresenceOAuthTransactionInput,
) {
  if (!presenceOAuthConfigured(env)) {
    throw new Error("PRESENCE_OAUTH_STATE_SECRET is not configured.");
  }

  const db = requireDb(env);
  const id = crypto.randomUUID();
  const { verifier, challenge } = await generatePkcePair();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + OAUTH_TRANSACTION_TTL_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO presence_oauth_transaction (
        id, user_id, workspace_user_id, connector_id, callback_uri, return_path,
        pkce_verifier, expires_at, consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.workspaceUserId,
      input.connectorId,
      input.callbackUri,
      input.returnPath,
      verifier,
      expiresAt,
      createdAt,
    )
    .run();

  const state = await signPresenceOAuthState(env, id);
  if (!state) {
    throw new Error("PRESENCE_OAUTH_STATE_SECRET is not configured.");
  }

  return { transactionId: id, state, pkceChallenge: challenge, pkceVerifier: verifier };
}

function mapTransaction(row: Record<string, unknown>): PresenceOAuthTransaction {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    workspaceUserId: String(row.workspace_user_id),
    connectorId: row.connector_id as PresenceConnectorId,
    callbackUri: String(row.callback_uri),
    returnPath: String(row.return_path),
    pkceVerifier: String(row.pkce_verifier),
    expiresAt: String(row.expires_at),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null,
    createdAt: String(row.created_at),
  };
}

export async function getPresenceOAuthTransaction(env: AppEnv, transactionId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(`SELECT * FROM presence_oauth_transaction WHERE id = ?`)
    .bind(transactionId)
    .first<Record<string, unknown>>();
  return row ? mapTransaction(row) : null;
}

export async function consumePresenceOAuthTransaction(
  env: AppEnv,
  input: {
    transactionId: string;
    userId: string;
    workspaceUserId: string;
    connectorId: PresenceConnectorId;
    callbackUri: string;
  },
) {
  const transaction = await getPresenceOAuthTransaction(env, input.transactionId);
  if (!transaction) {
    return { ok: false as const, code: "transaction_not_found" as const };
  }
  if (transaction.consumedAt) {
    return { ok: false as const, code: "transaction_consumed" as const };
  }
  if (Date.parse(transaction.expiresAt) <= Date.now()) {
    return { ok: false as const, code: "transaction_expired" as const };
  }
  if (transaction.userId !== input.userId) {
    return { ok: false as const, code: "user_mismatch" as const };
  }
  if (transaction.workspaceUserId !== input.workspaceUserId) {
    return { ok: false as const, code: "workspace_mismatch" as const };
  }
  if (transaction.connectorId !== input.connectorId) {
    return { ok: false as const, code: "connector_mismatch" as const };
  }
  if (transaction.callbackUri !== input.callbackUri) {
    return { ok: false as const, code: "callback_mismatch" as const };
  }

  const db = requireDb(env);
  const consumedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE presence_oauth_transaction
       SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
    )
    .bind(consumedAt, input.transactionId, consumedAt)
    .run();

  if ((result.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, code: "transaction_consumed" as const };
  }

  return { ok: true as const, transaction };
}

export function redactOAuthStateForLogs(state: string | null | undefined) {
  if (!state) return "[redacted]";
  const separator = state.lastIndexOf(".");
  if (separator <= 8) return "[redacted]";
  return `${state.slice(0, 8)}…[redacted]`;
}
