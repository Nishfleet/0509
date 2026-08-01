/**
 * Customer API agent-action audit persistence (D1).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` only
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
  AgentActionAuditRecord,
  AgentActionAuditStatus,
} from "~/lib/types";

interface AgentActionAuditRow {
  id: string;
  user_id: string;
  api_key_id: string | null;
  action_name: string;
  resource_type: string | null;
  resource_id: string | null;
  idempotency_key: string | null;
  status: AgentActionAuditStatus;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

/**
 * The Journey 4 writes are intentionally narrow.  Callers must prepare one
 * owner-scoped resource statement (including any ownership/precondition
 * predicates) and this primitive appends the guarded audit completion inside
 * the same D1 batch.  Keeping the effect as one statement is deliberate: D1
 * exposes batch transactions, not a portable transaction callback, and a
 * multi-statement resource writes may provide a bounded statement list; all
 * effect statements and the guarded audit completion still share one batch.
 */
export type AtomicCustomerAgentActionName =
  | "share.create"
  | "report.share"
  | "client_room.upsert";

export interface PreparedAtomicCustomerAgentEffect<T extends JsonRecord = JsonRecord> {
  statement: D1PreparedStatement | readonly D1PreparedStatement[];
  effectExpectations?: readonly ("one" | "delete")[];
  classifyBatchFailure?: () => "stale_write" | null | Promise<"stale_write" | null>;
  result: T;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: JsonRecord | null;
}

export class AtomicCustomerAgentActionConflictError extends Error {
  constructor(message = "Idempotency key was already used for different input.") {
    super(message);
    this.name = "AtomicCustomerAgentActionConflictError";
  }
}

export class AtomicCustomerAgentActionReplayUnavailableError extends Error {
  constructor(message = "Previous agent action has not completed successfully.") {
    super(message);
    this.name = "AtomicCustomerAgentActionReplayUnavailableError";
  }
}

export class AtomicCustomerAgentActionBatchUnavailableError extends Error {
  constructor() {
    super("D1 batch transactions are required for this agent action.");
    this.name = "AtomicCustomerAgentActionBatchUnavailableError";
  }
}

export class AtomicCustomerAgentActionStaleWriteError extends Error {
  constructor(message = "This resource changed since it was read. Reload it and retry with a new idempotency key.") {
    super(message);
    this.name = "AtomicCustomerAgentActionStaleWriteError";
  }
}

export interface AtomicCustomerAgentActionInput<T extends JsonRecord = JsonRecord> {
  userId: string;
  apiKeyId?: string | null;
  actionName: AtomicCustomerAgentActionName;
  idempotencyKey: string;
  requestFingerprint: string;
  metadata?: JsonRecord | null;
  prepare: (
    db: D1Database,
    auditId: string,
  ) => PreparedAtomicCustomerAgentEffect<T> | Promise<PreparedAtomicCustomerAgentEffect<T>>;
}

export interface AtomicCustomerAgentActionResult<T extends JsonRecord = JsonRecord> {
  audit: AgentActionAuditRecord;
  replayed: boolean;
  result: T;
}

const ATOMIC_ACTION_STARTED_STALE_AFTER_MS = 15 * 60 * 1_000;
const ATOMIC_ACTION_TERMINALIZE_ATTEMPTS = 3;
const AGENT_ACTION_RETRY_LEASE_MS = 15 * 60 * 1_000;

type AtomicCustomerAgentActionFailureCode =
  | "atomic_prepare_failed"
  | "atomic_batch_failed"
  | "atomic_stale_started"
  | "stale_write";

function toAgentActionAuditRecord(row: AgentActionAuditRow): AgentActionAuditRecord {
  return {
    id: row.id,
    userId: row.user_id,
    apiKeyId: row.api_key_id ?? null,
    actionName: row.action_name,
    resourceType: row.resource_type ?? null,
    resourceId: row.resource_id ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    status: row.status,
    result: parseJson<Record<string, unknown> | null>(row.result_json, null),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findAgentActionAuditByIdempotencyKey(
  env: AppEnv,
  userId: string,
  idempotencyKey: string,
) {
  const row = await one<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE user_id = ?
        AND idempotency_key = ?
      LIMIT 1
    `,
    userId,
    idempotencyKey,
  );

  return row ? toAgentActionAuditRecord(row) : null;
}

export async function listRecentAgentActionAudits(
  env: AppEnv,
  userId: string,
  options: {
    actionName?: string | null;
    status?: AgentActionAuditStatus | null;
    resourceType?: string | null;
    limit?: number;
    offset?: number;
  } = {},
) {
  const actionName = options.actionName ?? null;
  const status = options.status ?? null;
  const resourceType = options.resourceType ?? null;
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const rows = await many<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE user_id = ?
        AND (? IS NULL OR action_name = ?)
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR resource_type = ?)
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `,
    userId,
    actionName,
    actionName,
    status,
    status,
    resourceType,
    resourceType,
    limit,
    offset,
  );

  return rows.map(toAgentActionAuditRecord);
}

export async function createAgentActionAudit(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId?: string | null;
    actionName: string;
    resourceType?: string | null;
    resourceId?: string | null;
    idempotencyKey?: string | null;
    status?: AgentActionAuditStatus;
    result?: JsonRecord | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO agent_action_audit (
        id,
        user_id,
        api_key_id,
        action_name,
        resource_type,
        resource_id,
        idempotency_key,
        status,
        result_json,
        error_code,
        error_message,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.userId,
    input.apiKeyId ?? null,
    input.actionName,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.idempotencyKey ?? null,
    input.status ?? "started",
    input.result ? jsonValue(input.result) : null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    timestamp,
  );

  const row = await one<AgentActionAuditRow>(env, "SELECT * FROM agent_action_audit WHERE id = ?", id);
  return row ? toAgentActionAuditRecord(row) : null;
}

export async function claimAgentActionAudit(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId?: string | null;
    actionName: string;
    resourceType?: string | null;
    resourceId?: string | null;
    idempotencyKey?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO agent_action_audit (
        id,
        user_id,
        api_key_id,
        action_name,
        resource_type,
        resource_id,
        idempotency_key,
        status,
        result_json,
        error_code,
        error_message,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'started', NULL, NULL, NULL, ?, ?, ?)
    `,
    id,
    input.userId,
    input.apiKeyId ?? null,
    input.actionName,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.idempotencyKey ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    timestamp,
  );

  const claimed = await one<AgentActionAuditRow>(
    env,
    "SELECT * FROM agent_action_audit WHERE id = ?",
    id,
  );
  if (claimed) {
    return {
      audit: toAgentActionAuditRecord(claimed),
      claimed: true,
    };
  }

  const existing = input.idempotencyKey
    ? await findAgentActionAuditByIdempotencyKey(env, input.userId, input.idempotencyKey)
    : null;
  return existing
    ? { audit: existing, claimed: false }
    : null;
}

export async function reclaimRetryableAgentActionAudit(
  env: AppEnv,
  input: {
    auditId: string;
    apiKeyId: string | null;
  },
) {
  const timestamp = nowIso();
  const staleBefore = new Date(Date.parse(timestamp) - AGENT_ACTION_RETRY_LEASE_MS).toISOString();
  const result = await run(
    env,
    `
      UPDATE agent_action_audit
      SET status = 'started',
          result_json = NULL,
          error_code = NULL,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
        AND (
          status = 'failed'
          OR (status = 'started' AND updated_at <= ?)
        )
        AND (
          api_key_id = ?
          OR (api_key_id IS NULL AND ? IS NULL)
        )
    `,
    timestamp,
    input.auditId,
    staleBefore,
    input.apiKeyId,
    input.apiKeyId,
  );

  if (Number(result.meta?.changes ?? 0) !== 1) {
    return null;
  }

  const row = await one<AgentActionAuditRow>(
    env,
    "SELECT * FROM agent_action_audit WHERE id = ?",
    input.auditId,
  );
  return row ? toAgentActionAuditRecord(row) : null;
}

type AgentActionAuditCompletion = {
  status: Exclude<AgentActionAuditStatus, "started">;
  resourceType?: string | null;
  resourceId?: string | null;
  result?: JsonRecord | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: JsonRecord | null;
};

export async function finishAgentActionAudit(
  env: AppEnv,
  auditId: string,
  input: AgentActionAuditCompletion & {
    /** Exact updated_at value captured when this execution acquired its lease. */
    leaseToken: string;
  },
) {
  const { leaseToken, ...completion } = input;
  return persistAgentActionAuditCompletion(env, auditId, completion, leaseToken);
}

async function persistAgentActionAuditCompletion(
  env: AppEnv,
  auditId: string,
  input: AgentActionAuditCompletion,
  leaseToken: string | null,
) {
  const timestamp = nowIso();
  const result = await run(
    env,
    `
      UPDATE agent_action_audit
      SET status = ?,
          resource_type = COALESCE(?, resource_type),
          resource_id = COALESCE(?, resource_id),
          result_json = ?,
          error_code = ?,
          error_message = ?,
          metadata_json = ?,
          updated_at = ?
      WHERE id = ?
        AND (
          ? IS NULL
          OR (status = 'started' AND updated_at = ?)
        )
    `,
    input.status,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.result ? jsonValue(input.result) : null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    auditId,
    leaseToken,
    leaseToken,
  );

  if (
    typeof result.meta?.changes === "number" &&
    result.meta.changes !== 1
  ) {
    return null;
  }

  const row = await one<AgentActionAuditRow>(env, "SELECT * FROM agent_action_audit WHERE id = ?", auditId);
  return row ? toAgentActionAuditRecord(row) : null;
}

function assertAtomicRequestMatches(
  existing: AgentActionAuditRecord,
  actionName: AtomicCustomerAgentActionName,
  requestFingerprint: string,
  apiKeyId: string | null,
) {
  if (
    existing.actionName !== actionName ||
    (existing.apiKeyId ?? null) !== apiKeyId
  ) {
    throw new AtomicCustomerAgentActionConflictError();
  }

  const existingFingerprint = existing.metadata?.requestFingerprint;
  if (
    typeof existingFingerprint !== "string" ||
    existingFingerprint.trim() !== requestFingerprint
  ) {
    throw new AtomicCustomerAgentActionConflictError();
  }
}

function isStartedAtomicActionStale(audit: AgentActionAuditRecord, now = Date.now()) {
  if (audit.status !== "started") {
    return false;
  }
  const updatedAt = Date.parse(audit.updatedAt);
  return Number.isFinite(updatedAt) && now - updatedAt >= ATOMIC_ACTION_STARTED_STALE_AFTER_MS;
}

async function terminalizeStartedAtomicActionAudit(
  env: AppEnv,
  input: {
    auditId: string;
    userId: string;
    apiKeyId: string | null;
    actionName: AtomicCustomerAgentActionName;
    idempotencyKey: string;
    requestFingerprint: string;
    errorCode: AtomicCustomerAgentActionFailureCode;
  },
) {
  const result = await run(
    env,
    `
      UPDATE agent_action_audit
      SET status = 'failed',
          result_json = NULL,
          error_code = ?,
          error_message = 'The action did not complete. Use a new idempotency key to retry.',
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND (
          api_key_id = ?
          OR (api_key_id IS NULL AND ? IS NULL)
          OR (
            -- customer_api_key deletion sets the audit FK to NULL. Permit
            -- only that missing-key caller to close its own stranded audit;
            -- an active or mismatched key still cannot claim a NULL-key row.
            api_key_id IS NULL
            AND ? IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM customer_api_key deleted_api_key WHERE deleted_api_key.id = ?
            )
          )
        )
        AND action_name = ?
        AND idempotency_key = ?
        AND status = 'started'
        AND json_extract(metadata_json, '$.requestFingerprint') = ?
    `,
    input.errorCode,
    nowIso(),
    input.auditId,
    input.userId,
    input.apiKeyId,
    input.apiKeyId,
    input.apiKeyId,
    input.apiKeyId,
    input.actionName,
    input.idempotencyKey,
    input.requestFingerprint,
  );
  return Number(result.meta?.changes ?? 0) === 1;
}

async function terminalizeStartedAtomicActionAuditWithRetry(
  env: AppEnv,
  input: Parameters<typeof terminalizeStartedAtomicActionAudit>[1],
) {
  for (let attempt = 1; attempt <= ATOMIC_ACTION_TERMINALIZE_ATTEMPTS; attempt += 1) {
    try {
      return await terminalizeStartedAtomicActionAudit(env, input);
    } catch {
      if (attempt === ATOMIC_ACTION_TERMINALIZE_ATTEMPTS) {
        throw new AtomicCustomerAgentActionReplayUnavailableError(
          "Action recovery is temporarily unavailable. Retry with the same idempotency key.",
        );
      }
    }
  }
  return false;
}

async function replayExistingAtomicAction<T extends JsonRecord>(
  env: AppEnv,
  existing: AgentActionAuditRecord,
  input: AtomicCustomerAgentActionInput<T>,
  idempotencyKey: string,
  requestFingerprint: string,
): Promise<AtomicCustomerAgentActionResult<T>> {
  const apiKeyId = input.apiKeyId ?? null;
  assertAtomicRequestMatches(
    existing,
    input.actionName,
    requestFingerprint,
    apiKeyId,
  );
  let current = existing;
  if (current.status === "started" && isStartedAtomicActionStale(current)) {
    const terminalized = await terminalizeStartedAtomicActionAuditWithRetry(env, {
      auditId: existing.id,
      userId: input.userId,
      apiKeyId,
      actionName: input.actionName,
      idempotencyKey,
      requestFingerprint,
      errorCode: "atomic_stale_started",
    });
    if (terminalized) {
      current = {
        ...existing,
        status: "failed",
        result: null,
        errorCode: "atomic_stale_started",
      };
    } else {
      const refreshed = await findAgentActionAuditByIdempotencyKey(
        env,
        input.userId,
        idempotencyKey,
      );
      if (!refreshed) {
        throw new AtomicCustomerAgentActionReplayUnavailableError();
      }
      assertAtomicRequestMatches(
        refreshed,
        input.actionName,
        requestFingerprint,
        apiKeyId,
      );
      current = refreshed;
    }
  }
  if (current.status === "failed" && current.errorCode === "stale_write") {
    throw new AtomicCustomerAgentActionStaleWriteError();
  }
  if (current.status !== "succeeded" || !current.result) {
    throw new AtomicCustomerAgentActionReplayUnavailableError(
      current.status === "started"
        ? "Action recovery is still in progress. Retry with the same idempotency key."
        : "Previous agent action did not complete. Use a new idempotency key to retry.",
    );
  }
  return {
    audit: current,
    replayed: true,
    result: current.result as T,
  };
}

/**
 * Executes a Journey 4 customer-agent effect and its successful audit as one
 * D1 batch.  The effect is prepared before the batch, but it is never run by
 * a sequential fallback.  A zero-change effect or an audit predicate miss
 * deliberately aborts the batch; the resource stays unchanged and the exact
 * started audit is then terminalized as failed for deterministic recovery.
 */
export async function runAtomicCustomerAgentAction<T extends JsonRecord = JsonRecord>(
  env: AppEnv,
  input: AtomicCustomerAgentActionInput<T>,
): Promise<AtomicCustomerAgentActionResult<T>> {
  const idempotencyKey = input.idempotencyKey.trim();
  const requestFingerprint = input.requestFingerprint.trim();
  if (!idempotencyKey) {
    throw new TypeError("An idempotency key is required for atomic customer actions.");
  }
  if (!requestFingerprint) {
    throw new TypeError("A request fingerprint is required for atomic customer actions.");
  }

  const db = ensureDb(env);
  const existing = await findAgentActionAuditByIdempotencyKey(env, input.userId, idempotencyKey);
  if (existing) {
    return replayExistingAtomicAction(
      env,
      existing,
      input,
      idempotencyKey,
      requestFingerprint,
    );
  }

  // Check the transaction capability before claiming a started audit. This
  // keeps an unsupported runtime retryable and guarantees no effect fallback.
  if (typeof db.batch !== "function") {
    throw new AtomicCustomerAgentActionBatchUnavailableError();
  }

  const metadata = {
    ...(input.metadata ?? {}),
    requestFingerprint,
  } satisfies JsonRecord;
  const claim = await claimAgentActionAudit(env, {
    userId: input.userId,
    apiKeyId: input.apiKeyId ?? null,
    actionName: input.actionName,
    idempotencyKey,
    metadata,
  });
  if (!claim) {
    throw new Error("Could not create agent action audit.");
  }
  if (!claim.claimed) {
    return replayExistingAtomicAction(
      env,
      claim.audit,
      input,
      idempotencyKey,
      requestFingerprint,
    );
  }

  // The callback only prepares SQL and the deterministic response. No effect
  // is executed until the batch below has been assembled.
  let prepared: PreparedAtomicCustomerAgentEffect<T>;
  try {
    prepared = await input.prepare(db, claim.audit.id);
  } catch (error) {
    await terminalizeStartedAtomicActionAuditWithRetry(env, {
      auditId: claim.audit.id,
      userId: input.userId,
      apiKeyId: input.apiKeyId ?? null,
      actionName: input.actionName,
      idempotencyKey,
      requestFingerprint,
      errorCode: "atomic_prepare_failed",
    });
    throw error;
  }
  let timestamp: string;
  let atomicBatch: D1PreparedStatement[];
  try {
    timestamp = nowIso();
    const auditMetadata = jsonValue({
      ...metadata,
      ...(prepared.metadata ?? {}),
      // Prepared metadata may add safe resource context, but it must never
      // replace the fingerprint that guarded the started audit and effect SQL.
      requestFingerprint,
    });
    const auditResult = jsonValue(prepared.result);
    const completeAudit = db
      .prepare(
        `
          UPDATE agent_action_audit
          SET status = 'succeeded',
              resource_type = ?,
              resource_id = ?,
              result_json = ?,
              error_code = NULL,
              error_message = NULL,
              metadata_json = ?,
              updated_at = ?
          WHERE id = ?
            AND user_id = ?
            AND ((api_key_id = ?) OR (api_key_id IS NULL AND ? IS NULL))
            AND action_name = ?
            AND idempotency_key = ?
            AND status = 'started'
            AND json_extract(metadata_json, '$.requestFingerprint') = ?
        `,
      )
      .bind(
        prepared.resourceType ?? null,
        prepared.resourceId ?? null,
        auditResult,
        auditMetadata,
        timestamp,
        claim.audit.id,
        input.userId,
        input.apiKeyId ?? null,
        input.apiKeyId ?? null,
        input.actionName,
        idempotencyKey,
        requestFingerprint,
      );

    const effectStatements = Array.isArray(prepared.statement)
      ? [...prepared.statement]
      : [prepared.statement];
    const effectExpectations = prepared.effectExpectations
      ? [...prepared.effectExpectations]
      : effectStatements.map(() => "one" as const);
    if (
      effectStatements.length === 0 ||
      effectStatements.length > 64 ||
      effectExpectations.length !== effectStatements.length
    ) {
      throw new TypeError("Atomic customer action effects must be a bounded non-empty statement list.");
    }

    // SQLite has no portable RAISE() outside triggers. A malformed JSON
    // expression deterministically aborts the transaction when an effect that
    // must mutate one row reports zero/multiple changes. Explicit delete steps
    // are allowed to report zero when the resource set is already empty.
    const effectBatchStatements: D1PreparedStatement[] = [];
    effectStatements.forEach((statement, index) => {
      effectBatchStatements.push(statement);
      effectBatchStatements.push(
        db.prepare(
          effectExpectations[index] === "one"
            ? `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('{', '$') END AS effect_committed`
            : `SELECT 1 AS delete_committed`,
        ).bind(),
      );
    });
    const requireAuditCompletion = db.prepare(
      `SELECT CASE WHEN changes() > 0 THEN 1 ELSE json_extract('{', '$') END AS committed`,
    ).bind();
    atomicBatch = [
      ...effectBatchStatements,
      completeAudit,
      requireAuditCompletion,
    ];
  } catch (error) {
    await terminalizeStartedAtomicActionAuditWithRetry(env, {
      auditId: claim.audit.id,
      userId: input.userId,
      apiKeyId: input.apiKeyId ?? null,
      actionName: input.actionName,
      idempotencyKey,
      requestFingerprint,
      errorCode: "atomic_prepare_failed",
    });
    throw error;
  }

  try {
    await db.batch(atomicBatch);
  } catch (error) {
    let refreshed: AgentActionAuditRecord | null;
    try {
      refreshed = await findAgentActionAuditByIdempotencyKey(env, input.userId, idempotencyKey);
    } catch {
      throw new AtomicCustomerAgentActionReplayUnavailableError(
        "Action commit status is temporarily unavailable. Retry with the same idempotency key.",
      );
    }
    if (!refreshed) {
      throw new AtomicCustomerAgentActionReplayUnavailableError(
        "Action commit status is temporarily unavailable. Retry with the same idempotency key.",
      );
    }
    if (refreshed.status !== "started") {
      return replayExistingAtomicAction(
        env,
        refreshed,
        input,
        idempotencyKey,
        requestFingerprint,
      );
    }

    let errorCode: AtomicCustomerAgentActionFailureCode = "atomic_batch_failed";
    try {
      if (await prepared.classifyBatchFailure?.() === "stale_write") {
        errorCode = "stale_write";
      }
    } catch {
      // A classification read must never hide the original batch failure.
    }
    const terminalized = await terminalizeStartedAtomicActionAuditWithRetry(env, {
      auditId: claim.audit.id,
      userId: input.userId,
      apiKeyId: input.apiKeyId ?? null,
      actionName: input.actionName,
      idempotencyKey,
      requestFingerprint,
      errorCode,
    });
    if (!terminalized) {
      let latest: AgentActionAuditRecord | null;
      try {
        latest = await findAgentActionAuditByIdempotencyKey(env, input.userId, idempotencyKey);
      } catch {
        throw new AtomicCustomerAgentActionReplayUnavailableError(
          "Action recovery is temporarily unavailable. Retry with the same idempotency key.",
        );
      }
      if (!latest) {
        throw new AtomicCustomerAgentActionReplayUnavailableError();
      }
      return replayExistingAtomicAction(
        env,
        latest,
        input,
        idempotencyKey,
        requestFingerprint,
      );
    }
    if (errorCode === "stale_write") {
      throw new AtomicCustomerAgentActionStaleWriteError();
    }
    throw error;
  }
  // The final changes() guard is inside the same batch, so a resolved batch is
  // already the commit proof. A read after commit can fail independently and
  // must not turn a durable customer effect into a false-negative response.
  const completed: AgentActionAuditRecord = {
    ...claim.audit,
    resourceType: prepared.resourceType ?? null,
    resourceId: prepared.resourceId ?? null,
    status: "succeeded",
    result: prepared.result,
    errorCode: null,
    errorMessage: null,
    metadata: {
      ...metadata,
      ...(prepared.metadata ?? {}),
      requestFingerprint,
    },
    updatedAt: timestamp,
  };

  return {
    audit: completed,
    replayed: false,
    result: prepared.result,
  };
}

export async function closeCounterMoveFollowUp(
  env: AppEnv,
  input: {
    auditId: string;
    userId: string;
    eventId: string;
  },
) {
  const audit = await one<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE id = ?
        AND user_id = ?
        AND action_name = 'counter_move_brief.create'
        AND status = 'succeeded'
    `,
    input.auditId,
    input.userId,
  );
  if (!audit) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const result = parseJson<Record<string, unknown>>(audit.result_json, {});
  const brief =
    result.brief && typeof result.brief === "object" && !Array.isArray(result.brief)
      ? (result.brief as Record<string, unknown>)
      : {};
  const workflow =
    brief.workflow && typeof brief.workflow === "object" && !Array.isArray(brief.workflow)
      ? (brief.workflow as Record<string, unknown>)
      : {};
  const followUps = Array.isArray(workflow.followUps) ? workflow.followUps : [];
  let matched = false;
  const nextFollowUps = followUps.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const followUp = entry as Record<string, unknown>;
    if (followUp.eventId !== input.eventId || followUp.status === "closed") {
      return followUp;
    }
    matched = true;
    return {
      ...followUp,
      status: "closed",
    };
  });

  if (!matched) {
    return { ok: false as const, reason: "follow_up_not_found" as const };
  }

  const openCount = nextFollowUps.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).status !== "closed",
  ).length;

  const nextWorkflow = {
    ...workflow,
    followUps: nextFollowUps,
    openCount,
    status: openCount > 0 ? workflow.status ?? "needs_review" : "quiet",
  };
  const nextBrief = {
    ...brief,
    workflow: nextWorkflow,
  };
  const nextResult = {
    ...result,
    brief: nextBrief,
  };

  // This helper intentionally edits an already-terminal audit rather than
  // completing a running lease, so it uses the private persistence path.
  const updated = await persistAgentActionAuditCompletion(
    env,
    audit.id,
    { status: "succeeded", result: nextResult },
    null,
  );

  return updated ? { ok: true as const, audit: updated } : { ok: false as const, reason: "update_failed" as const };
}
