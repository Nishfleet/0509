import { ensureDb, execute, queryAll, queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { sha256Hex } from "~/lib/browser-job-telemetry.server";
import { sha256Base64Url } from "~/lib/presence-hash";
import { PLAN_FAMILIES } from "~/lib/plan-entitlements";

/**
 * Self-serve GDPR/CCPA erasure (issue #2982).
 *
 * A signed-in user files an `account_erasure_request`; the row's
 * `execute_after` is the end of the grace window. The daily scheduled rail
 * (`runAccountErasureSweep`, wired in workers/app.ts) erases every row keyed
 * to that user once the window passes — no human step.
 *
 * Every user-keyed table gets an explicit DELETE, ordered children-first so
 * the audit counts are the rows each statement actually removed. The FK
 * CASCADE graph is the safety net for anything missed, not the mechanism —
 * the deletes work identically whether or not the engine enforces FKs.
 *
 * On completion an `account_erasure_audit` row lands in the same batch as
 * the request's own delete: the audit carries a one-way user-id hash and the
 * per-table counts, so erasure is provable without keeping a live key.
 */

export const ACCOUNT_ERASURE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
// Marketing/UI copy uses the whole-number form.
export const ACCOUNT_ERASURE_GRACE_DAYS = ACCOUNT_ERASURE_GRACE_MS / (24 * 60 * 60 * 1000);
export const ACCOUNT_ERASURE_SWEEP_LIMIT = 25;
const EXPORT_ROW_LIMIT = 5000;
const MAGIC_LINK_TICKET_SCAN_LIMIT = 200;

export interface AccountErasureRequest {
  id: string;
  user_id: string;
  user_email: string;
  status: "pending" | "cancelled" | "failed";
  requested_at: string;
  execute_after: string;
  attempt_count: number;
}

interface ErasureContext {
  userId: string;
  email: string;
  /** sha256Base64Url(userId) — the presence pilot allowlist key. */
  workspaceIdHash: string;
  /** sha256 hex of `0509:account-erasure:${userId}` — the audit row key. */
  auditUserHash: string;
  /** sha256 hex of each `<scope>|<seed>` rate-limit key the user can own. */
  rateLimitKeyHashes: string[];
  /** better_auth_magic_link_ticket ids whose encrypted payload names the email. */
  magicLinkTicketIds: string[];
}

interface ErasureStep {
  table: string;
  /**
   * WHERE fragment with `?` placeholders. A function returning null skips the
   * step entirely (nothing to bind).
   */
  where: string | ((ctx: ErasureContext) => string | null);
  binds: (ctx: ErasureContext) => readonly unknown[];
  /** "clear" releases a shared lease row instead of deleting it. */
  kind?: "delete" | "clear";
  /** Set false to keep the table out of the customer export. */
  export?: boolean;
}

const WATCHLIST_IDS = "(SELECT id FROM watchlist WHERE user_id = ?)";
const RUN_IDS = `(SELECT id FROM watchlist_run WHERE watchlist_id IN ${WATCHLIST_IDS})`;
const TRACKED_ENTITY_IDS = "(SELECT id FROM tracked_entity WHERE user_id = ?)";
const SOURCE_TARGET_IDS = "(SELECT id FROM source_target WHERE user_id = ?)";

function userBinds(count: number) {
  return (ctx: ErasureContext) => Array.from({ length: count }, () => ctx.userId);
}

/**
 * Every table keyed to the user, deepest children first so each statement's
 * subselects still see the parent rows they name. `binds` maps each `?` in
 * `where` to a context value, left to right.
 */
const ACCOUNT_ERASURE_STEPS: readonly ErasureStep[] = [
  // collection -> item -> tag
  {
    table: "collection_item_tag",
    where: `collection_item_id IN (SELECT ci.id FROM collection_item ci JOIN collection c ON ci.collection_id = c.id WHERE c.user_id = ?)`,
    binds: userBinds(1),
  },
  {
    table: "collection_item",
    where: `collection_id IN (SELECT id FROM collection WHERE user_id = ?)`,
    binds: userBinds(1),
  },
  // watchlist subtree (runs, events, candidates, proof, scans, snapshots)
  {
    table: "website_site_scan_page",
    where: `site_scan_id IN (SELECT id FROM website_site_scan WHERE workspace_id = ? OR watchlist_id IN ${WATCHLIST_IDS})`,
    binds: userBinds(2),
  },
  {
    table: "website_page_observation",
    where: `workspace_id = ? OR watchlist_id IN ${WATCHLIST_IDS} OR watchlist_run_id IN ${RUN_IDS}`,
    binds: userBinds(3),
  },
  {
    table: "website_site_scan",
    where: `workspace_id = ? OR watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(2),
  },
  {
    table: "ad_observation",
    where: `watchlist_run_id IN ${RUN_IDS}`,
    binds: userBinds(2),
  },
  {
    table: "watch_event",
    where: `watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(1),
  },
  {
    table: "event_candidate",
    where: `watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(1),
  },
  {
    table: "proof_capture",
    where: `proof_target_id IN (SELECT id FROM proof_target WHERE watchlist_id IN ${WATCHLIST_IDS})`,
    binds: userBinds(1),
  },
  {
    table: "proof_target",
    where: `watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(1),
  },
  {
    table: "source_snapshot",
    where: `watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(1),
  },
  {
    // Concurrency slots are a pre-seeded shared pool — release the lease,
    // never delete the slot row.
    table: "monitoring_concurrency_slot",
    kind: "clear",
    export: false,
    where: `holder_run_id IN ${RUN_IDS}`,
    binds: userBinds(2),
  },
  {
    table: "watchlist_run",
    where: `watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(1),
  },
  // digest subtree (items also hang off watchlist)
  {
    table: "digest_item",
    where: `digest_run_id IN (SELECT id FROM digest_run WHERE user_id = ?) OR watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(2),
  },
  {
    table: "digest_delivery",
    where: `digest_run_id IN (SELECT id FROM digest_run WHERE user_id = ?)`,
    binds: userBinds(1),
  },
  {
    table: "digest_run",
    where: "user_id = ?",
    binds: userBinds(1),
  },
  {
    table: "digest_schedule_job",
    where: "user_id = ?",
    binds: userBinds(1),
  },
  // presence subtree
  {
    table: "presence_item_revision",
    where: `presence_item_id IN (SELECT id FROM presence_item WHERE user_id = ? OR source_target_id IN ${SOURCE_TARGET_IDS} OR tracked_entity_id IN ${TRACKED_ENTITY_IDS})`,
    binds: userBinds(3),
  },
  {
    table: "presence_item",
    where: `user_id = ? OR source_target_id IN ${SOURCE_TARGET_IDS} OR tracked_entity_id IN ${TRACKED_ENTITY_IDS}`,
    binds: userBinds(3),
  },
  {
    table: "presence_poll_cursor",
    where: `source_target_id IN ${SOURCE_TARGET_IDS}`,
    binds: userBinds(1),
    export: false,
  },
  {
    table: "source_target",
    where: "user_id = ?",
    binds: userBinds(1),
  },
  {
    table: "source_connection",
    where: "user_id = ?",
    binds: userBinds(1),
  },
  {
    table: "presence_alert_cursor",
    where: `user_id = ? OR tracked_entity_id IN ${TRACKED_ENTITY_IDS}`,
    binds: userBinds(2),
    export: false,
  },
  {
    table: "presence_domain_verification",
    where: `user_id = ? OR tracked_entity_id IN ${TRACKED_ENTITY_IDS}`,
    binds: userBinds(2),
  },
  {
    table: "presence_entity_link",
    where: `user_id = ? OR from_entity_id IN ${TRACKED_ENTITY_IDS} OR to_entity_id IN ${TRACKED_ENTITY_IDS}`,
    binds: userBinds(3),
  },
  {
    table: "presence_oauth_transaction",
    where: "user_id = ? OR workspace_user_id = ?",
    binds: userBinds(2),
  },
  {
    table: "tracked_entity",
    where: "user_id = ?",
    binds: userBinds(1),
  },
  // web mentions hang off watchlist and user
  {
    table: "web_mention_observation",
    where: "user_id = ? OR target_id IN (SELECT id FROM web_mention_target WHERE user_id = ?)",
    binds: userBinds(2),
  },
  {
    table: "web_mention_target",
    where: `user_id = ? OR watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(2),
  },
  // remaining direct keys
  { table: "watchlist_delivery_config", where: "user_id = ?", binds: userBinds(1) },
  { table: "delivery_target", where: "user_id = ?", binds: userBinds(1) },
  { table: "delivery_attempt", where: "user_id = ?", binds: userBinds(1) },
  { table: "watchlist", where: "user_id = ?", binds: userBinds(1) },
  { table: "collection", where: "user_id = ?", binds: userBinds(1) },
  { table: "tag", where: "user_id = ?", binds: userBinds(1) },
  { table: "saved_query", where: "user_id = ?", binds: userBinds(1) },
  { table: "share_link", where: "user_id = ?", binds: userBinds(1) },
  {
    table: "support_case_event",
    where: "user_id = ? OR case_id IN (SELECT id FROM support_case WHERE user_id = ?)",
    binds: userBinds(2),
  },
  { table: "support_case", where: "user_id = ?", binds: userBinds(1) },
  {
    table: "client_room_resource",
    where: "user_id = ? OR room_id IN (SELECT id FROM client_room WHERE user_id = ?)",
    binds: userBinds(2),
  },
  {
    table: "client_room",
    where: "user_id = ? OR org_id IN (SELECT id FROM org WHERE owner_user_id = ?)",
    binds: userBinds(2),
  },
  {
    table: "agent_memory",
    where: `user_id = ? OR client_room_id IN (SELECT id FROM client_room WHERE user_id = ?) OR watchlist_id IN ${WATCHLIST_IDS}`,
    binds: userBinds(3),
  },
  {
    // Invites addressed to this email by other workspaces are the user's data
    // too — the email key is a user key.
    table: "workspace_member",
    where: "owner_user_id = ? OR member_user_id = ? OR invited_email = ?",
    binds: (ctx) => [ctx.userId, ctx.userId, ctx.email],
  },
  { table: "org", where: "owner_user_id = ?", binds: userBinds(1) },
  { table: "customer_api_key", where: "user_id = ?", binds: userBinds(1) },
  { table: "customer_meta_connection", where: "user_id = ?", binds: userBinds(1) },
  { table: "agent_action_audit", where: "user_id = ?", binds: userBinds(1) },
  { table: "workspace_branding", where: "user_id = ?", binds: userBinds(1) },
  { table: "workspace_delivery_config", where: "user_id = ?", binds: userBinds(1) },
  { table: "user_plan", where: "user_id = ?", binds: userBinds(1) },
  { table: "dodo_webhook_event", where: "user_id = ?", binds: userBinds(1) },
  // evidence/proof credit ledger rows key the workspace, not user_id
  { table: "evidence_usage_reservation", where: "workspace_user_id = ?", binds: userBinds(1), export: false },
  { table: "evidence_usage_period", where: "workspace_user_id = ?", binds: userBinds(1) },
  { table: "evidence_top_up_ledger_entry", where: "workspace_user_id = ?", binds: userBinds(1) },
  { table: "evidence_top_up_adjustment", where: "workspace_user_id = ?", binds: userBinds(1) },
  { table: "evidence_top_up_grant", where: "workspace_user_id = ?", binds: userBinds(1) },
  { table: "proof_usage_credit_migration", where: "workspace_user_id = ?", binds: userBinds(1), export: false },
  { table: "proof_usage_credit", where: "workspace_user_id = ?", binds: userBinds(1) },
  // hash- and email-keyed rows (no FK to user)
  {
    table: "rate_limit_events",
    export: false,
    where: (ctx) =>
      ctx.rateLimitKeyHashes.length > 0
        ? `key_hash IN (${ctx.rateLimitKeyHashes.map(() => "?").join(", ")})`
        : null,
    binds: (ctx) => ctx.rateLimitKeyHashes,
  },
  { table: "signup_source_pending", where: "email = ?", binds: (ctx) => [ctx.email], export: false },
  {
    table: "presence_pilot_workspace",
    where: "workspace_id_hash = ?",
    binds: (ctx) => [ctx.workspaceIdHash],
    export: false,
  },
  {
    table: "better_auth_magic_link_ticket",
    export: false,
    where: (ctx) =>
      ctx.magicLinkTicketIds.length > 0
        ? `id IN (${ctx.magicLinkTicketIds.map(() => "?").join(", ")})`
        : null,
    binds: (ctx) => ctx.magicLinkTicketIds,
  },
  // Better Auth core: verification keys on identifier (email or user id),
  // account/session/passkey on userId. The user row goes last.
  {
    table: "verification",
    where: "identifier IN (?, ?)",
    binds: (ctx) => [ctx.userId, ctx.email],
    export: false,
  },
  { table: "passkey", where: "userId = ?", binds: userBinds(1) },
  { table: "session", where: "userId = ?", binds: userBinds(1) },
  { table: "account", where: "userId = ?", binds: userBinds(1) },
  { table: "user", where: "id = ?", binds: userBinds(1) },
];

/** Columns never written into the customer export — credentials and token material. */
const EXPORT_REDACT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  account: ["accessToken", "refreshToken", "idToken", "password"],
  session: ["token"],
  passkey: ["publicKey", "credentialID"],
  customer_api_key: ["key_hash"],
  customer_meta_connection: ["encrypted_access_token"],
  source_connection: ["encrypted_credentials", "credential_fingerprint"],
  presence_oauth_transaction: ["pkce_verifier"],
  presence_domain_verification: ["token_hash"],
  workspace_member: ["token_hash"],
};

function nowIso() {
  return new Date().toISOString();
}

export async function getPendingAccountErasure(env: AppEnv, userId: string) {
  return queryOne<AccountErasureRequest>(
    env,
    `SELECT id, user_id, user_email, status, requested_at, execute_after, attempt_count
     FROM account_erasure_request
     WHERE user_id = ? AND status = 'pending'
     LIMIT 1`,
    userId,
  );
}

/**
 * File (or return the existing) pending erasure request. The partial unique
 * index on (user_id) WHERE status='pending' makes the insert atomic; a repeat
 * request returns the live row instead of stacking a second clock.
 */
export async function requestAccountErasure(
  env: AppEnv,
  input: { userId: string; email: string; requestedVia?: string },
) {
  const db = ensureDb(env);
  const now = nowIso();
  const executeAfter = new Date(Date.now() + ACCOUNT_ERASURE_GRACE_MS).toISOString();
  const id = `aer_${crypto.randomUUID()}`;
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO account_erasure_request (
         id, user_id, user_email, status, requested_at, execute_after,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(id, input.userId, input.email, now, executeAfter, now, now)
    .run();
  const request = await getPendingAccountErasure(env, input.userId);
  return { request, created: (inserted.meta?.changes ?? 0) > 0 };
}

export async function cancelPendingAccountErasure(env: AppEnv, userId: string) {
  const result = await execute(
    env,
    `UPDATE account_erasure_request
     SET status = 'cancelled', cancelled_at = ?, updated_at = ?
     WHERE user_id = ? AND status = 'pending'`,
    nowIso(),
    nowIso(),
    userId,
  );
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Rate-limit buckets are keyed by sha256 of `<scope>|<seed>`; the seeds that
 * embed a user id are enumerable, so the rows stay erasable. The share-PDF
 * single-flight scope folds the user id into a composite with the resource id
 * and content fingerprint — those rows are one-way-keyed ephemera the
 * retention cleanup already prunes.
 */
async function rateLimitKeyHashesForUser(userId: string) {
  const seeds = [
    `account-search|${userId}`,
    `search-selection|${userId}`,
    `billing-provider-pricing|${userId}`,
    `billing-provider-mutation|${userId}`,
    `share-pdf-daily|${userId}`,
    ...PLAN_FAMILIES.map((plan) => `account-search-daily|${userId}:${plan}`),
  ];
  return Promise.all(seeds.map((seed) => sha256Hex(seed)));
}

/**
 * Magic-link tickets are AES-GCM encrypted rows with no user-keyed column.
 * The table is transient (15-minute TTL), so a bounded decrypt-and-match scan
 * over the newest rows finds any live ticket issued to this email.
 */
async function magicLinkTicketIdsForEmail(env: AppEnv, email: string) {
  const { findBetterAuthMagicLinkTicketIdsForEmail } = await import("~/lib/better-auth.server");
  return findBetterAuthMagicLinkTicketIdsForEmail(env, email, {
    limit: MAGIC_LINK_TICKET_SCAN_LIMIT,
  });
}

function erasureStatementForStep(
  db: D1Database,
  step: ErasureStep,
  ctx: ErasureContext,
) {
  const where = typeof step.where === "function" ? step.where(ctx) : step.where;
  if (!where) {
    return null;
  }
  const sql =
    step.kind === "clear"
      ? `UPDATE ${step.table} SET holder_run_id = NULL, holder_token = NULL, leased_at = NULL WHERE ${where}`
      : `DELETE FROM ${step.table} WHERE ${where}`;
  return db.prepare(sql).bind(...step.binds(ctx));
}

/**
 * Erase every row keyed to the user and write the audit row. Two atomic
 * batches: all deletes first, then audit-insert + request-delete together.
 * A crash between them leaves the request pending, and the next daily tick
 * retries — every delete is idempotent, so a retried run converges.
 */
export async function executeAccountErasure(
  env: AppEnv,
  request: Pick<AccountErasureRequest, "id" | "user_id" | "user_email" | "requested_at" | "execute_after"> & {
    requested_via?: string | null;
  },
) {
  const db = ensureDb(env);
  const userId = request.user_id;
  const email = request.user_email;
  const [workspaceIdHash, auditUserHash, rateLimitKeyHashes, magicLinkTicketIds] =
    await Promise.all([
      sha256Base64Url(userId.trim()),
      sha256Hex(`0509:account-erasure:${userId}`),
      rateLimitKeyHashesForUser(userId),
      magicLinkTicketIdsForEmail(env, email).catch((error) => {
        console.warn("[account-erasure] magic-link ticket scan failed", error);
        return [] as string[];
      }),
    ]);
  const ctx: ErasureContext = {
    userId,
    email,
    workspaceIdHash,
    auditUserHash,
    rateLimitKeyHashes,
    magicLinkTicketIds,
  };

  const deleteStatements = ACCOUNT_ERASURE_STEPS.map((step) =>
    erasureStatementForStep(db, step, ctx),
  ).filter((statement): statement is D1PreparedStatement => Boolean(statement));
  const deleteResults = await db.batch(deleteStatements);

  const deletedCounts: Record<string, number> = {};
  let stepIndex = 0;
  for (const step of ACCOUNT_ERASURE_STEPS) {
    const statement = erasureStatementForStep(db, step, ctx);
    if (!statement) {
      continue;
    }
    const changes = deleteResults[stepIndex]?.meta?.changes;
    if (typeof changes === "number") {
      deletedCounts[step.table] = changes;
    }
    stepIndex += 1;
  }

  const completedAt = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO account_erasure_audit (
           id, user_id_hash, request_id, requested_at, execute_after,
           completed_at, requested_via, deleted_counts_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `aea_${crypto.randomUUID()}`,
        auditUserHash,
        request.id,
        request.requested_at,
        request.execute_after,
        completedAt,
        request.requested_via ?? null,
        JSON.stringify(deletedCounts),
        completedAt,
      ),
    db
      .prepare(`DELETE FROM account_erasure_request WHERE id = ?`)
      .bind(request.id),
  ]);

  return { completedAt, deletedCounts };
}

/**
 * Daily-rail sweep: erase every request whose grace window has passed. Failed
 * requests stay pending (attempt_count + last_error recorded) so the next
 * tick retries and the caller's failure reporter keeps paging.
 */
export async function runAccountErasureSweep(
  env: AppEnv,
  options: { now?: Date; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? ACCOUNT_ERASURE_SWEEP_LIMIT;
  const due = await queryAll<AccountErasureRequest>(
    env,
    `SELECT id, user_id, user_email, status, requested_at, execute_after, attempt_count
     FROM account_erasure_request
     WHERE status = 'pending' AND execute_after <= ?
     ORDER BY execute_after ASC
     LIMIT ?`,
    now.toISOString(),
    limit,
  );

  let completed = 0;
  const failures: Array<{ requestId: string; error: string }> = [];
  for (const request of due) {
    await execute(
      env,
      `UPDATE account_erasure_request
       SET attempt_count = attempt_count + 1, updated_at = ?
       WHERE id = ?`,
      nowIso(),
      request.id,
    );
    try {
      await executeAccountErasure(env, request);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await execute(
        env,
        `UPDATE account_erasure_request
         SET last_error = ?, updated_at = ?
         WHERE id = ?`,
        message.slice(0, 500),
        nowIso(),
        request.id,
      ).catch((updateError) => {
        console.error("[account-erasure] failed to record sweep error", updateError);
      });
      failures.push({ requestId: request.id, error: message });
    }
  }

  return { due: due.length, completed, failed: failures.length, failures };
}

/**
 * GDPR/CCPA data-portability export: every row keyed to the user, grouped by
 * table, with credential columns stripped. Bounded per table — a table past
 * EXPORT_ROW_LIMIT lands in `truncatedTables` instead of silently dropping.
 */
export async function exportAccountData(
  env: AppEnv,
  input: { userId: string; email: string },
) {
  const db = ensureDb(env);
  const { userId, email } = input;
  const [workspaceIdHash, auditUserHash, rateLimitKeyHashes, magicLinkTicketIds] =
    await Promise.all([
      sha256Base64Url(userId.trim()),
      sha256Hex(`0509:account-erasure:${userId}`),
      rateLimitKeyHashesForUser(userId),
      magicLinkTicketIdsForEmail(env, email).catch(() => [] as string[]),
    ]);
  const ctx: ErasureContext = {
    userId,
    email,
    workspaceIdHash,
    auditUserHash,
    rateLimitKeyHashes,
    magicLinkTicketIds,
  };

  const tables: Record<string, Record<string, unknown>[]> = {};
  const truncatedTables: string[] = [];
  for (const step of ACCOUNT_ERASURE_STEPS) {
    if (step.export === false || step.kind === "clear") {
      continue;
    }
    const where = typeof step.where === "function" ? step.where(ctx) : step.where;
    if (!where) {
      continue;
    }
    const rows = await db
      .prepare(`SELECT * FROM ${step.table} WHERE ${where} LIMIT ?`)
      .bind(...step.binds(ctx), EXPORT_ROW_LIMIT + 1)
      .all<Record<string, unknown>>();
    const results = rows.results ?? [];
    const truncated = results.length > EXPORT_ROW_LIMIT;
    const visible = truncated ? results.slice(0, EXPORT_ROW_LIMIT) : results;
    if (truncated) {
      truncatedTables.push(step.table);
    }
    const redact = EXPORT_REDACT_COLUMNS[step.table] ?? [];
    tables[step.table] = visible.map((row) => {
      if (redact.length === 0) {
        return row;
      }
      const clean = { ...row };
      for (const column of redact) {
        delete clean[column];
      }
      return clean;
    });
  }

  const pending = await getPendingAccountErasure(env, userId);
  return {
    exportedAt: nowIso(),
    account: { userId, email },
    pendingErasure: pending
      ? { requestedAt: pending.requested_at, executeAfter: pending.execute_after }
      : null,
    tables,
    truncatedTables,
  };
}
