import type { AppEnv } from "~/lib/env.server";
import { isSecretishMemoryField, isSecretishMemoryString } from "~/lib/agent-redaction";
import type { AgentActionAuditRecord } from "~/lib/types";
import {
  AtomicCustomerAgentActionBatchUnavailableError,
  AtomicCustomerAgentActionConflictError,
  AtomicCustomerAgentActionReplayUnavailableError,
  AtomicCustomerAgentActionStaleWriteError,
  runAtomicCustomerAgentAction,
  type AtomicCustomerAgentActionName,
  type PreparedAtomicCustomerAgentEffect,
} from "~/lib/data/customer-api-agent.server";

type JsonRecord = Record<string, unknown>;
type SanitizeOptions = {
  actionName?: string | null;
  path?: string[];
  redactSecretScalars?: boolean;
  redactSecretKeys?: boolean;
};

export class AgentActionIdempotencyConflictError extends Error {
  constructor(message = "Idempotency key was already used for a different action.") {
    super(message);
    this.name = "AgentActionIdempotencyConflictError";
  }
}

export class AgentActionReplayUnavailableError extends Error {
  constructor(message = "Previous agent action has not completed successfully.") {
    super(message);
    this.name = "AgentActionReplayUnavailableError";
  }
}

export class AgentActionStaleWriteError extends Error {
  constructor(message = "This resource changed since it was read. Reload it and retry with a new idempotency key.") {
    super(message);
    this.name = "AgentActionStaleWriteError";
  }
}

export interface AgentActionContext {
  userId: string;
  apiKeyId?: string | null;
  actionName: string;
  resourceType?: string | null;
  resourceId?: string | null;
  idempotencyKey?: string | null;
  metadata?: JsonRecord | null;
}

export interface AgentActionSuccess<T extends JsonRecord> {
  resourceType?: string | null;
  resourceId?: string | null;
  result: T;
  metadata?: JsonRecord | null;
  auditStatus?: "succeeded" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface AuditedAgentActionResult<T extends JsonRecord> {
  audit: AgentActionAuditRecord;
  replayed: boolean;
  result: T;
}

export interface AuditedAgentActionOptions<T extends JsonRecord> {
  replayCompleted?: (audit: AgentActionAuditRecord) => Promise<T | null> | T | null;
  retryFailed?: boolean;
}

export interface AtomicAgentActionOptions<T extends JsonRecord> {
  requestFingerprint: string;
  prepare: (
    db: D1Database,
    auditId: string,
  ) => PreparedAtomicCustomerAgentEffect<T> | Promise<PreparedAtomicCustomerAgentEffect<T>>;
}

/**
 * Journey 4's resource effects use the D1 batch primitive. This wrapper
 * keeps the public error types and result redaction conventions alongside the
 * existing audited-action helper while leaving resource SQL in its owning
 * data module.
 */
export async function runAtomicAgentAction<T extends JsonRecord>(
  env: AppEnv,
  context: AgentActionContext & { actionName: AtomicCustomerAgentActionName },
  options: AtomicAgentActionOptions<T>,
): Promise<AuditedAgentActionResult<T>> {
  try {
    return await runAtomicCustomerAgentAction(env, {
      userId: context.userId,
      apiKeyId: normalizeOptionalString(context.apiKeyId),
      actionName: context.actionName,
      idempotencyKey: normalizeOptionalString(context.idempotencyKey) ?? "",
      requestFingerprint: options.requestFingerprint,
      metadata: sanitizeAgentActionMetadata(context.metadata ?? {}),
      prepare: async (db, auditId) => {
        const prepared = await options.prepare(db, auditId);
        return {
          ...prepared,
          // The share token is part of the customer-visible result and must be
          // retained verbatim so a retry can replay the original link.
          result: prepared.result,
          metadata: sanitizeAgentActionMetadata(prepared.metadata ?? {}),
        };
      },
    });
  } catch (error) {
    if (error instanceof AtomicCustomerAgentActionConflictError) {
      throw new AgentActionIdempotencyConflictError(error.message);
    }
    if (error instanceof AtomicCustomerAgentActionReplayUnavailableError) {
      throw new AgentActionReplayUnavailableError(error.message);
    }
    if (error instanceof AtomicCustomerAgentActionStaleWriteError) {
      throw new AgentActionStaleWriteError(error.message);
    }
    if (error instanceof AtomicCustomerAgentActionBatchUnavailableError) {
      throw error;
    }
    throw error;
  }
}

export async function runAuditedAgentAction<T extends JsonRecord>(
  env: AppEnv,
  context: AgentActionContext,
  action: () => Promise<AgentActionSuccess<T>>,
  options: AuditedAgentActionOptions<T> = {},
): Promise<AuditedAgentActionResult<T>> {
  const {
    findAgentActionAuditByIdempotencyKey,
    claimAgentActionAudit,
    reclaimRetryableAgentActionAudit,
  } = await import("~/lib/data.server");
  const actionName = normalizeActionName(context.actionName);
  const apiKeyId = normalizeOptionalString(context.apiKeyId);
  const idempotencyKey = normalizeOptionalString(context.idempotencyKey);

  if (idempotencyKey) {
    const existing = await findAgentActionAuditByIdempotencyKey(env, context.userId, idempotencyKey);
    if (existing) {
      if (existing.actionName !== actionName) {
        throw new AgentActionIdempotencyConflictError();
      }
      assertIdempotencyRequestMatches(existing, context.metadata ?? {});
      if (existing.status === "succeeded" && existing.result) {
        return {
          audit: existing,
          replayed: true,
          result: (await options.replayCompleted?.(existing)) ?? existing.result as T,
        };
      }
      if ((existing.status === "failed" || existing.status === "started") && options.retryFailed) {
        assertRetryApiKeyMatches(existing, apiKeyId);
        const reclaimed = await reclaimRetryableAgentActionAudit(env, {
          auditId: existing.id,
          apiKeyId,
        });
        if (!reclaimed) {
          throw new AgentActionReplayUnavailableError();
        }
        return executeAuditedAgentAction(env, context, actionName, reclaimed, action);
      }
      throw new AgentActionReplayUnavailableError();
    }
  }

  const claim = await claimAgentActionAudit(env, {
    userId: context.userId,
    apiKeyId,
    actionName,
    resourceType: normalizeOptionalString(context.resourceType),
    resourceId: normalizeOptionalString(context.resourceId),
    idempotencyKey,
    metadata: sanitizeAgentActionMetadata(context.metadata ?? {}),
  });

  if (!claim) {
    throw new Error("Could not create agent action audit.");
  }

  if (!claim.claimed) {
    if (claim.audit.actionName !== actionName) {
      throw new AgentActionIdempotencyConflictError();
    }
    assertIdempotencyRequestMatches(claim.audit, context.metadata ?? {});
    if (claim.audit.status === "succeeded" && claim.audit.result) {
      return {
        audit: claim.audit,
        replayed: true,
        result: (await options.replayCompleted?.(claim.audit)) ?? claim.audit.result as T,
      };
    }
    if ((claim.audit.status === "failed" || claim.audit.status === "started") && options.retryFailed) {
      assertRetryApiKeyMatches(claim.audit, apiKeyId);
      const reclaimed = await reclaimRetryableAgentActionAudit(env, {
        auditId: claim.audit.id,
        apiKeyId,
      });
      if (!reclaimed) {
        throw new AgentActionReplayUnavailableError();
      }
      return executeAuditedAgentAction(env, context, actionName, reclaimed, action);
    }
    throw new AgentActionReplayUnavailableError();
  }

  return executeAuditedAgentAction(env, context, actionName, claim.audit, action);
}

async function executeAuditedAgentAction<T extends JsonRecord>(
  env: AppEnv,
  context: AgentActionContext,
  actionName: string,
  audit: AgentActionAuditRecord,
  action: () => Promise<AgentActionSuccess<T>>,
): Promise<AuditedAgentActionResult<T>> {
  const { finishAgentActionAudit } = await import("~/lib/data.server");
  try {
    const success = await action();
    const result = success.result;
    const auditStatus = success.auditStatus ?? "succeeded";
    const completed = await finishAgentActionAudit(env, audit.id, {
      status: auditStatus,
      leaseToken: audit.updatedAt,
      resourceType: normalizeOptionalString(success.resourceType ?? context.resourceType),
      resourceId: normalizeOptionalString(success.resourceId ?? context.resourceId),
      result: redactAgentActionResult(result, { actionName }),
      errorCode: auditStatus === "failed"
        ? normalizeOptionalString(success.errorCode) ?? "action_incomplete"
        : null,
      errorMessage: auditStatus === "failed"
        ? normalizeOptionalString(success.errorMessage) ?? "Agent action did not complete."
        : null,
      metadata: sanitizeAgentActionMetadata({
        ...(context.metadata ?? {}),
        ...(success.metadata ?? {}),
      }),
    });

    if (!completed) {
      throw new AgentActionReplayUnavailableError(
        "This action lease was reclaimed before completion.",
      );
    }

    return {
      audit: completed,
      replayed: false,
      result,
    };
  } catch (error) {
    await finishAgentActionAudit(env, audit.id, {
      status: "failed",
      leaseToken: audit.updatedAt,
      resourceType: normalizeOptionalString(context.resourceType),
      resourceId: normalizeOptionalString(context.resourceId),
      errorCode: error instanceof AgentActionIdempotencyConflictError ? "idempotency_conflict" : "action_failed",
      errorMessage: error instanceof Error ? error.message : "Agent action failed.",
      metadata: sanitizeAgentActionMetadata(context.metadata ?? {}),
    });
    throw error;
  }
}

export function sanitizeAgentActionMetadata(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return sanitizeObject(value as JsonRecord, { redactSecretScalars: true });
}

export function redactAgentActionResult<T extends JsonRecord>(
  value: T,
  options: { actionName?: string | null } = {},
): T {
  return sanitizeObject(value, {
    actionName: normalizeOptionalString(options.actionName),
    redactSecretScalars: true,
    redactSecretKeys: true,
  }) as T;
}

function sanitizeObject(
  value: JsonRecord,
  options: SanitizeOptions = {},
): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const path = [...(options.path ?? []), key];
    if (isSecretishKey(key) && !isPublicActionSchemaKey(key, path, options.actionName)) {
      if (options.redactSecretKeys) {
        output[key] = "[redacted]";
      }
      continue;
    }
    const sanitized = sanitizeValue(nestedValue, { ...options, path });
    if (typeof sanitized !== "undefined") {
      output[key] = sanitized;
    }
  }
  return output;
}

function sanitizeValue(
  value: unknown,
  options: SanitizeOptions = {},
): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return options.redactSecretScalars && isSecretishString(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, options)).filter((entry) => typeof entry !== "undefined");
  }
  if (typeof value === "object") {
    return sanitizeObject(value as JsonRecord, options);
  }
  return undefined;
}

function normalizeActionName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.:-]{1,96}$/.test(normalized)) {
    throw new Error("Agent action name is invalid.");
  }
  return normalized;
}

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function assertIdempotencyRequestMatches(existing: AgentActionAuditRecord, metadata: JsonRecord) {
  const expectedFingerprint = readRequestFingerprint(metadata);
  const actualFingerprint = readRequestFingerprint(existing.metadata);
  if (expectedFingerprint && actualFingerprint && expectedFingerprint !== actualFingerprint) {
    throw new AgentActionIdempotencyConflictError("Idempotency key was already used for different input.");
  }
}

function assertRetryApiKeyMatches(existing: AgentActionAuditRecord, apiKeyId: string | null) {
  if ((existing.apiKeyId ?? null) !== apiKeyId) {
    throw new AgentActionIdempotencyConflictError(
      "Idempotency key was already used by a different API key.",
    );
  }
}

function readRequestFingerprint(metadata: JsonRecord | null | undefined) {
  const value = metadata?.requestFingerprint;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPublicActionSchemaKey(key: string, path: string[], actionName: string | null | undefined) {
  if (key !== "key" || (actionName !== "memory.upsert" && actionName !== "memory.list")) {
    return false;
  }
  const parent = path[path.length - 2];
  return parent === "memory" || parent === "memories";
}

function isSecretishKey(key: string) {
  return isSecretishMemoryField(key);
}

function isSecretishString(value: string) {
  return isSecretishMemoryString(value);
}
