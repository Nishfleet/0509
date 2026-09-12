// Self-serve account lifecycle: cancellation scheduling, account deletion with
// a 7-day grace window, in-app email change, and the retention-side sweep that
// hard-deletes a user whose grace window expired.
//
// Issue #3168: the /status weakness claimed cancellation, deletion, and
// email change still routed through the hosted portal or support path. This
// module is the in-app backend that removes that fallback. The UI side lives
// in app/routes/app.account.tsx and app/routes/app.billing.tsx; the data
// shape is migrations/0097_self_serve_account_changes.sql.
//
// Cross-cutting rules, enforced here so callers can't break them:
//   * Cancellation runs through Dodo's `cancel_at_next_billing_date` flag so
//     the webhook still reconciles `cancellation_scheduled` and the customer
//     keeps access until the end of the period they've paid for. The portal
//     link remains available for card / invoice work — this is an *extra*
//     path, never the only one.
//   * Account deletion is a deliberate two-step: request -> click confirm
//     link -> 7-day grace -> retention sweep hard-deletes. A 7-day cancel
//     link sits in the confirmation email so a regretful click is one tap.
//   * Email change verifies the NEW address before swapping, notifies the
//     OLD address afterwards, and invalidates the user's other sessions.
//     Passkeys stay bound to the user id and survive the swap.
//   * Org owners with other members are blocked with a transfer-ownership
//     message — the actual transfer UI lives in epic #2993.
//   * The hard delete rides the EXISTING retention sweep. No new wrangler
//     cron (rule). D1 cascades handle most tables; the explicit per-table
//     delete in runAccountDeletionSweep covers the rows that aren't
//     FK-cascaded on user.id (email_suppression is kept by design).

import type { AppEnv } from "./env.server";
import { sha256Hex } from "./browser-job-telemetry.server";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_GRACE_DAYS = 7;
const ACCOUNT_DELETION_GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * DAY_MS;
const ACCOUNT_DELETION_CANCEL_TOKEN_TTL_MS = ACCOUNT_DELETION_GRACE_MS;
const ACCOUNT_EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const ACCOUNT_DELETION_REQUEST_TTL_MS = 60 * 60 * 1000; // 1h to click confirm
const ACCOUNT_DELETION_SWEEP_BATCH_SIZE = 25;
const ACCOUNT_DELETION_SWEEP_HARD_BATCH_SIZE = 50;

// Tables whose rows MUST be hard-deleted by user_id during the sweep. Some
// already have ON DELETE CASCADE on their FK to user(id) — listing them is
// harmless (SQLite skips a missing ID) but keeps the cascade correct even if
// a future migration drops the FK on a single table. This list is the
// source of truth for tests/account-self-serve-cascade.test.ts — keep them
// in sync.
//
// Naming note: this codebase mixes `user_id` (snake), `userId` (camel, auth
// tables only), and `workspace_user_id` / `workspace_id` / `owner_user_id`
// for tenancy-scoped tables. The sweep binds every known spelling.
//
// collection_item / collection_item_tag do not appear here — they are
// CASCADE-deleted through `collection` (their FK target), and SQLite is
// strict about unknown columns.
export const ACCOUNT_DELETION_CASCADE_TABLES = [
  // snake-case user_id
  "agent_action_audit",
  "agent_memory",
  "client_room",
  "client_room_resource",
  "collection",
  "customer_api_key",
  "customer_meta_connection",
  "delivery_attempt",
  "delivery_target",
  "digest_run",
  "digest_schedule_job",
  "dodo_webhook_event",
  "proof_usage_credit",
  "proof_usage_credit_migration",
  "saved_query",
  "share_link",
  "source_connection",
  "source_target",
  "support_case",
  "support_case_event",
  "tag",
  "tracked_entity",
  "watchlist",
  "watchlist_delivery_config",
  "web_mention_observation",
  "web_mention_target",
  "presence_alert_cursor",
  "presence_domain_verification",
  "presence_entity_link",
  "presence_item",
  "presence_oauth_transaction",
  // workspace_user_id / workspace_id (tenancy-scoped)
  "evidence_top_up_adjustment",
  "evidence_top_up_grant",
  "evidence_top_up_ledger_entry",
  "evidence_usage_period",
  "evidence_usage_reservation",
  "website_page_observation",
  "website_site_scan",
  // owner_user_id
  "org",
  "workspace_member",
  // no FK to user (one row per workspace)
  "workspace_branding",
  "workspace_delivery_config",
  "user_plan",
  // camelCase userId (Better Auth tables)
  "account",
  "session",
  "passkey",
] as const;

export type AccountDeletionCascadeTable = (typeof ACCOUNT_DELETION_CASCADE_TABLES)[number];

// Per-table user-reference columns, derived from migrations. The list below
// is the hard-coded complement of ACCOUNT_DELETION_CASCADE_TABLES — the
// cascade test pins both as a single source of truth. SQLite is strict
// about unknown columns, so the sweep must issue a per-table DELETE that
// only references columns that exist.
const CASCADE_TABLE_USER_COLUMNS: Record<AccountDeletionCascadeTable, readonly string[]> = {
  account: ["userId"],
  session: ["userId"],
  passkey: ["userId"],
  workspace_branding: ["user_id"],
  workspace_delivery_config: ["user_id"],
  workspace_member: ["owner_user_id"],
  user_plan: ["user_id"],
  customer_api_key: ["user_id"],
  customer_meta_connection: ["user_id"],
  agent_action_audit: ["user_id"],
  agent_memory: ["user_id"],
  client_room: ["user_id"],
  client_room_resource: ["user_id"],
  collection: ["user_id"],
  saved_query: ["user_id"],
  share_link: ["user_id"],
  source_connection: ["user_id"],
  source_target: ["user_id"],
  support_case: ["user_id"],
  support_case_event: ["user_id"],
  tag: ["user_id"],
  tracked_entity: ["user_id"],
  watchlist: ["user_id"],
  watchlist_delivery_config: ["user_id"],
  web_mention_observation: ["user_id"],
  web_mention_target: ["user_id"],
  presence_alert_cursor: ["user_id"],
  presence_domain_verification: ["user_id"],
  presence_entity_link: ["user_id"],
  presence_item: ["user_id"],
  presence_oauth_transaction: ["user_id", "workspace_user_id"],
  proof_usage_credit: ["user_id"],
  proof_usage_credit_migration: ["workspace_user_id"],
  delivery_attempt: ["user_id"],
  delivery_target: ["user_id"],
  digest_run: ["user_id"],
  digest_schedule_job: ["user_id"],
  dodo_webhook_event: ["user_id"],
  evidence_top_up_adjustment: ["workspace_user_id"],
  evidence_top_up_grant: ["workspace_user_id"],
  evidence_top_up_ledger_entry: ["workspace_user_id"],
  evidence_usage_period: ["workspace_user_id"],
  evidence_usage_reservation: ["workspace_user_id"],
  org: ["owner_user_id"],
  website_page_observation: ["workspace_id"],
  website_site_scan: ["workspace_id"],
};

export type AccountDeletionRequestRow = {
  cancel_token_expires_at: string | null;
  cancel_token_hash: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  email_at_request: string;
  id: string;
  requested_at: string;
  scheduled_for: string;
  status: "pending" | "cancelled" | "completed";
  user_id: string;
};

export type AccountEmailChangeRequestRow = {
  consumed_at: string | null;
  current_email: string;
  expires_at: string;
  id: string;
  new_email: string;
  requested_at: string;
  status: "pending" | "consumed" | "cancelled";
  token_hash: string;
  user_id: string;
};

export type AccountDeletionSweepOutcome = {
  hardDeleted: number;
  cancelled: number;
  scannedDue: number;
  scannedTotal: number;
};

// --- Grace-period math -------------------------------------------------------

export function accountDeletionScheduledFor(now: Date = new Date()): string {
  return new Date(now.getTime() + ACCOUNT_DELETION_GRACE_MS).toISOString();
}

export function accountDeletionCancelTokenExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + ACCOUNT_DELETION_CANCEL_TOKEN_TTL_MS).toISOString();
}

export function accountEmailChangeTokenExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + ACCOUNT_EMAIL_CHANGE_TOKEN_TTL_MS).toISOString();
}

export function accountDeletionRequestExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + ACCOUNT_DELETION_REQUEST_TTL_MS).toISOString();
}

/**
 * True iff the deletion request is past its grace window AND still pending
 * (so the retention sweep can hard-delete it). Mirrors the partial index on
 * migrations/0097 so the test asserts the same predicate the sweep uses.
 */
export function accountDeletionIsDue(row: AccountDeletionRequestRow, now: Date = new Date()): boolean {
  if (row.status !== "pending") return false;
  const scheduledAt = Date.parse(row.scheduled_for);
  if (!Number.isFinite(scheduledAt)) return false;
  return scheduledAt <= now.getTime();
}

// --- Org-owner block (epic #2993 owns the transfer UI; we only guard) -------

export async function isUserOrgOwnerOfMultiMemberOrg(
  env: AppEnv,
  userId: string,
): Promise<{ ownerOfOrgsWithOtherMembers: number; orgIds: string[] }> {
  if (!env.DB) return { ownerOfOrgsWithOtherMembers: 0, orgIds: [] };
  const result = await env.DB.prepare(
    `
      SELECT COUNT(DISTINCT o.id) AS multi
      FROM org o
      WHERE o.owner_user_id = ?
        AND EXISTS (
          SELECT 1 FROM workspace_member wm
          WHERE wm.owner_user_id = o.owner_user_id
            AND wm.member_user_id IS NOT NULL
            AND wm.member_user_id != o.owner_user_id
        )
    `,
  )
    .bind(userId)
    .first<{ multi: number }>();
  const idsRow = await env.DB.prepare(
    `
      SELECT DISTINCT o.id AS id
      FROM org o
      WHERE o.owner_user_id = ?
        AND EXISTS (
          SELECT 1 FROM workspace_member wm
          WHERE wm.owner_user_id = o.owner_user_id
            AND wm.member_user_id IS NOT NULL
            AND wm.member_user_id != o.owner_user_id
        )
    `,
  )
    .bind(userId)
    .all<{ id: string }>();
  return {
    ownerOfOrgsWithOtherMembers: Number(result?.multi ?? 0),
    orgIds: (idsRow.results ?? []).map((row) => row.id),
  };
}

// --- Account deletion -------------------------------------------------------

export async function readPendingAccountDeletion(
  env: AppEnv,
  userId: string,
): Promise<AccountDeletionRequestRow | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, email_at_request, requested_at, scheduled_for,
             cancelled_at, completed_at, status, cancel_token_hash, cancel_token_expires_at
      FROM account_deletion_request
      WHERE user_id = ? AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 1
    `,
  )
    .bind(userId)
    .first<AccountDeletionRequestRow>();
  return row ?? null;
}

export async function readAccountDeletionById(
  env: AppEnv,
  id: string,
): Promise<AccountDeletionRequestRow | null> {
  if (!env.DB || !id.trim()) return null;
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, email_at_request, requested_at, scheduled_for,
             cancelled_at, completed_at, status, cancel_token_hash, cancel_token_expires_at
      FROM account_deletion_request
      WHERE id = ?
      LIMIT 1
    `,
  )
    .bind(id)
    .first<AccountDeletionRequestRow>();
  return row ?? null;
}

export async function insertPendingAccountDeletion(env: AppEnv, row: {
  cancelTokenHash: string | null;
  cancelTokenExpiresAt: string | null;
  emailAtRequest: string;
  id: string;
  requestedAt: string;
  scheduledFor: string;
  userId: string;
}): Promise<AccountDeletionRequestRow> {
  if (!env.DB) {
    throw new Error("D1 binding is required to schedule an account deletion.");
  }
  // Reject if a pending request already exists — the form layer surfaces the
  // existing pending row instead of letting a fresh insert stack another
  // grace window on top of the first.
  const existing = await readPendingAccountDeletion(env, row.userId);
  if (existing) {
    return existing;
  }
  await env.DB.prepare(
    `
      INSERT INTO account_deletion_request (
        id, user_id, email_at_request, requested_at, scheduled_for,
        cancelled_at, completed_at, status, cancel_token_hash, cancel_token_expires_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?)
    `,
  )
    .bind(
      row.id,
      row.userId,
      row.emailAtRequest,
      row.requestedAt,
      row.scheduledFor,
      row.cancelTokenHash,
      row.cancelTokenExpiresAt,
    )
    .run();
  const inserted = await readAccountDeletionById(env, row.id);
  if (!inserted) {
    throw new Error("Account deletion insert did not persist.");
  }
  return inserted;
}

export async function markAccountDeletionCancelled(env: AppEnv, id: string): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `
      UPDATE account_deletion_request
      SET status = 'cancelled', cancelled_at = ?
      WHERE id = ? AND status = 'pending'
    `,
  )
    .bind(new Date().toISOString(), id)
    .run();
  return d1ChangedRows(result) > 0;
}

export async function markAccountDeletionCompleted(env: AppEnv, id: string): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `
      UPDATE account_deletion_request
      SET status = 'completed', completed_at = ?
      WHERE id = ? AND status = 'pending'
    `,
  )
    .bind(new Date().toISOString(), id)
    .run();
  return d1ChangedRows(result) > 0;
}

export async function readAccountDeletionByCancelToken(
  env: AppEnv,
  tokenHash: string,
): Promise<AccountDeletionRequestRow | null> {
  if (!env.DB || !tokenHash) return null;
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, email_at_request, requested_at, scheduled_for,
             cancelled_at, completed_at, status, cancel_token_hash, cancel_token_expires_at
      FROM account_deletion_request
      WHERE cancel_token_hash = ? AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 1
    `,
  )
    .bind(tokenHash)
    .first<AccountDeletionRequestRow>();
  return row ?? null;
}

// --- Account email change ---------------------------------------------------

export async function readPendingAccountEmailChange(
  env: AppEnv,
  userId: string,
): Promise<AccountEmailChangeRequestRow | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, current_email, new_email, requested_at, expires_at,
             consumed_at, status, token_hash
      FROM account_email_change_request
      WHERE user_id = ? AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 1
    `,
  )
    .bind(userId)
    .first<AccountEmailChangeRequestRow>();
  return row ?? null;
}

export async function readAccountEmailChangeByToken(
  env: AppEnv,
  tokenHash: string,
): Promise<AccountEmailChangeRequestRow | null> {
  if (!env.DB || !tokenHash) return null;
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, current_email, new_email, requested_at, expires_at,
             consumed_at, status, token_hash
      FROM account_email_change_request
      WHERE token_hash = ? AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 1
    `,
  )
    .bind(tokenHash)
    .first<AccountEmailChangeRequestRow>();
  return row ?? null;
}

export async function readAccountEmailChangeById(
  env: AppEnv,
  id: string,
): Promise<AccountEmailChangeRequestRow | null> {
  if (!env.DB || !id.trim()) return null;
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, current_email, new_email, requested_at, expires_at,
             consumed_at, status, token_hash
      FROM account_email_change_request
      WHERE id = ?
      LIMIT 1
    `,
  )
    .bind(id)
    .first<AccountEmailChangeRequestRow>();
  return row ?? null;
}

export async function insertPendingAccountEmailChange(env: AppEnv, row: {
  currentEmail: string;
  expiresAt: string;
  id: string;
  newEmail: string;
  requestedAt: string;
  tokenHash: string;
  userId: string;
}): Promise<AccountEmailChangeRequestRow> {
  if (!env.DB) {
    throw new Error("D1 binding is required to request an email change.");
  }
  await cancelPendingAccountEmailChange(env, row.userId);
  await env.DB.prepare(
    `
      INSERT INTO account_email_change_request (
        id, user_id, current_email, new_email, requested_at, expires_at,
        consumed_at, status, token_hash
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?)
    `,
  )
    .bind(
      row.id,
      row.userId,
      row.currentEmail,
      row.newEmail,
      row.requestedAt,
      row.expiresAt,
      row.tokenHash,
    )
    .run();
  const inserted = await readAccountEmailChangeById(env, row.id);
  if (!inserted) {
    throw new Error("Account email-change insert did not persist.");
  }
  return inserted;
}

export async function cancelPendingAccountEmailChange(
  env: AppEnv,
  userId: string,
): Promise<number> {
  if (!env.DB) return 0;
  const result = await env.DB.prepare(
    `
      UPDATE account_email_change_request
      SET status = 'cancelled'
      WHERE user_id = ? AND status = 'pending'
    `,
  )
    .bind(userId)
    .run();
  return d1ChangedRows(result);
}

export async function consumePendingAccountEmailChange(env: AppEnv, id: string): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `
      UPDATE account_email_change_request
      SET status = 'consumed', consumed_at = ?
      WHERE id = ? AND status = 'pending'
    `,
  )
    .bind(new Date().toISOString(), id)
    .run();
  return d1ChangedRows(result) > 0;
}

// --- Hard delete (retention-side) ------------------------------------------

/**
 * Returns up to N pending deletion requests whose scheduled_for has elapsed.
 * The retention sweep iterates over batches of this size and hard-deletes
 * one at a time so a single failure does not stall the queue.
 */
export async function listDueAccountDeletionRequests(
  env: AppEnv,
  now: Date = new Date(),
  limit = ACCOUNT_DELETION_SWEEP_BATCH_SIZE,
): Promise<AccountDeletionRequestRow[]> {
  if (!env.DB) return [];
  const result = await env.DB.prepare(
    `
      SELECT id, user_id, email_at_request, requested_at, scheduled_for,
             cancelled_at, completed_at, status, cancel_token_hash, cancel_token_expires_at
      FROM account_deletion_request
      WHERE status = 'pending' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC
      LIMIT ?
    `,
  )
    .bind(now.toISOString(), limit)
    .all<AccountDeletionRequestRow>();
  return result.results ?? [];
}

/**
 * Hard-deletes one user and every row that cascades from it. Returns the
 * tables that were swept and the row counts. The sweep runs inside a D1
 * batch so a single failure rolls the whole thing back — D1 batches are
 * atomic per call. If the batch throws, the deletion row stays 'pending'
 * and the sweep retries on the next run.
 */
export async function hardDeleteAccount(
  env: AppEnv,
  request: AccountDeletionRequestRow,
): Promise<{ rowsDeleted: number; tableCounts: Record<string, number> }> {
  if (!env.DB) {
    throw new Error("D1 binding is required to hard-delete an account.");
  }
  const tableCounts: Record<string, number> = {};
  const statements: ReturnType<D1Database["prepare"]>[] = [];

  // Per-table DELETE — SQLite is strict about unknown columns, so the
  // sweep must only reference columns that actually exist on each table.
  // The CASCADE_TABLE_USER_COLUMNS map is the source of truth, kept in
  // sync with migrations via tests/account-self-serve-cascade.test.ts.
  for (const table of ACCOUNT_DELETION_CASCADE_TABLES) {
    const columns = CASCADE_TABLE_USER_COLUMNS[table];
    if (!columns || columns.length === 0) {
      // No user-reference column found — the cascade test would have
      // flagged this. Skip rather than risk a SQL error.
      continue;
    }
    const whereClause = columns.map((column) => `${column} = ?`).join(" OR ");
    const stmt = env.DB.prepare(`DELETE FROM ${table} WHERE ${whereClause}`);
    statements.push(stmt.bind(...columns.map(() => request.user_id)));
    tableCounts[table] = 0;
  }
  // The user row itself — last because the FK-cascaded deletes above leave
  // this row as the only one with no dependents.
  const userDelete = env.DB.prepare(`DELETE FROM user WHERE id = ?`);
  statements.push(userDelete.bind(request.user_id));
  const auditUpdate = env.DB.prepare(
    `UPDATE account_deletion_request SET status = 'completed', completed_at = ? WHERE id = ?`,
  );
  statements.push(auditUpdate.bind(new Date().toISOString(), request.id));

  // D1 batches accept up to 100000 statements; the cascade list is well
  // under that, so a single batch covers the whole sweep.
  let result: unknown[];
  try {
    result = await env.DB.batch(statements);
  } catch (error) {
    console.error("[account-self-serve] hard delete batch failed", {
      userId: request.user_id,
      tableCount: statements.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  let rowsDeleted = 0;
  // The order of `statements` matches the loop above: per-table DELETE
  // for every table in CASCADE_TABLE_USER_COLUMNS, then user row, then
  // audit update.
  let resultIndex = 0;
  for (const table of ACCOUNT_DELETION_CASCADE_TABLES) {
    const columns = CASCADE_TABLE_USER_COLUMNS[table];
    if (!columns || columns.length === 0) continue;
    const res = result[resultIndex++];
    const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
    tableCounts[table] = changes;
    rowsDeleted += changes;
  }
  // result[resultIndex] = user row delete; result[resultIndex+1] = audit update.
  const userChanges = Number(
    (result[resultIndex] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0,
  );
  rowsDeleted += userChanges;
  return { rowsDeleted, tableCounts };
}

/**
 * Top-level sweep that the retention cron calls. Idempotent: marking a
 * request 'completed' is part of the same batch as the user delete, so
 * re-running this on an already-completed user is a no-op (the partial
 * index excludes completed rows from the SELECT).
 */
export async function runAccountDeletionSweep(
  env: AppEnv,
  options: { now?: Date; maxRows?: number } = {},
): Promise<AccountDeletionSweepOutcome> {
  const now = options.now ?? new Date();
  const maxRows = options.maxRows ?? ACCOUNT_DELETION_SWEEP_HARD_BATCH_SIZE;
  let hardDeleted = 0;
  let cancelled = 0;
  let scannedDue = 0;
  let scannedTotal = 0;
  const due = await listDueAccountDeletionRequests(env, now, maxRows);
  for (const row of due) {
    scannedTotal += 1;
    if (accountDeletionIsDue(row, now)) {
      scannedDue += 1;
      try {
        await hardDeleteAccount(env, row);
        hardDeleted += 1;
      } catch (error) {
        // Log + keep going — the partial-sweep contract is "process as many
        // as you can this tick, leave the rest for next time". A failing
        // row is logged here so the cron-failure alerter can flag it.
        console.error("[account-self-serve] hard delete failed", {
          requestId: row.id,
          userId: row.user_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      cancelled += 1;
    }
  }
  return { hardDeleted, cancelled, scannedDue, scannedTotal };
}

// --- Token helpers ----------------------------------------------------------

export async function hashAccountSelfServeToken(token: string): Promise<string> {
  return sha256Hex(`account-self-serve:v1:${token}`);
}

export function generateAccountSelfServeToken(): string {
  return crypto.randomUUID().split("-").join("");
}

// --- Misc -------------------------------------------------------------------

function d1ChangedRows(result: unknown) {
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}