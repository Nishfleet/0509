import type { AppEnv } from "~/lib/env.server";
import type { AgentActionAuditRecord } from "~/lib/types";

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
}

export interface AuditedAgentActionResult<T extends JsonRecord> {
  audit: AgentActionAuditRecord;
  replayed: boolean;
  result: T;
}

export interface AuditedAgentActionOptions<T extends JsonRecord> {
  replayCompleted?: (audit: AgentActionAuditRecord) => Promise<T | null> | T | null;
}

export async function runAuditedAgentAction<T extends JsonRecord>(
  env: AppEnv,
  context: AgentActionContext,
  action: () => Promise<AgentActionSuccess<T>>,
  options: AuditedAgentActionOptions<T> = {},
): Promise<AuditedAgentActionResult<T>> {
  const { findAgentActionAuditByIdempotencyKey, claimAgentActionAudit, finishAgentActionAudit } = await import(
    "~/lib/data.server"
  );
  const actionName = normalizeActionName(context.actionName);
  const idempotencyKey = normalizeOptionalString(context.idempotencyKey);

  if (idempotencyKey) {
    const existing = await findAgentActionAuditByIdempotencyKey(env, context.userId, idempotencyKey);
    if (existing) {
      if (existing.actionName !== actionName) {
        throw new AgentActionIdempotencyConflictError();
      }
      assertIdempotencyRequestMatches(existing, context.metadata ?? {});
      if (existing.status !== "succeeded" || !existing.result) {
        throw new AgentActionReplayUnavailableError();
      }
      return {
        audit: existing,
        replayed: true,
        result: (await options.replayCompleted?.(existing)) ?? existing.result as T,
      };
    }
  }

  const claim = await claimAgentActionAudit(env, {
    userId: context.userId,
    apiKeyId: normalizeOptionalString(context.apiKeyId),
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
    if (claim.audit.status !== "succeeded" || !claim.audit.result) {
      throw new AgentActionReplayUnavailableError();
    }
    return {
      audit: claim.audit,
      replayed: true,
      result: (await options.replayCompleted?.(claim.audit)) ?? claim.audit.result as T,
    };
  }

  const audit = claim.audit;

  try {
    const success = await action();
    const result = success.result;
    const completed = await finishAgentActionAudit(env, audit.id, {
      status: "succeeded",
      resourceType: normalizeOptionalString(success.resourceType ?? context.resourceType),
      resourceId: normalizeOptionalString(success.resourceId ?? context.resourceId),
      result: redactAgentActionResult(result, { actionName }),
      metadata: sanitizeAgentActionMetadata({
        ...(context.metadata ?? {}),
        ...(success.metadata ?? {}),
      }),
    });

    return {
      audit: completed ?? audit,
      replayed: false,
      result,
    };
  } catch (error) {
    await finishAgentActionAudit(env, audit.id, {
      status: "failed",
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

  return sanitizeObject(value as JsonRecord);
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
  const normalized = key.toLowerCase();
  return (
    normalized === "key" ||
    /(authorization|bearer|credential|encrypted|password|secret|token|webhook|api[_-]?key|privatekey|accesskey)/i.test(
      normalized,
    )
  );
}

function isSecretishString(value: string) {
  return /(?:^f9_live_|bearer\s+|xox[baprs]-|sk-[a-z0-9]|\/share\/[a-z0-9_-]{12,}|https:\/\/[^/\s]+\/share\/[a-z0-9_-]{12,})/i
    .test(value);
}
