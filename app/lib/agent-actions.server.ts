import type { AppEnv } from "~/lib/env.server";
import type { AgentActionAuditRecord } from "~/lib/types";

type JsonRecord = Record<string, unknown>;

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

export async function runAuditedAgentAction<T extends JsonRecord>(
  env: AppEnv,
  context: AgentActionContext,
  action: () => Promise<AgentActionSuccess<T>>,
): Promise<AuditedAgentActionResult<T>> {
  const { findAgentActionAuditByIdempotencyKey, createAgentActionAudit, finishAgentActionAudit } = await import(
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
      if (existing.status !== "succeeded" || !existing.result) {
        throw new AgentActionReplayUnavailableError();
      }
      return {
        audit: existing,
        replayed: true,
        result: existing.result as T,
      };
    }
  }

  const audit = await createAgentActionAudit(env, {
    userId: context.userId,
    apiKeyId: normalizeOptionalString(context.apiKeyId),
    actionName,
    resourceType: normalizeOptionalString(context.resourceType),
    resourceId: normalizeOptionalString(context.resourceId),
    idempotencyKey,
    status: "started",
    metadata: sanitizeAgentActionMetadata(context.metadata ?? {}),
  });

  if (!audit) {
    throw new Error("Could not create agent action audit.");
  }

  try {
    const success = await action();
    const result = success.result;
    const completed = await finishAgentActionAudit(env, audit.id, {
      status: "succeeded",
      resourceType: normalizeOptionalString(success.resourceType ?? context.resourceType),
      resourceId: normalizeOptionalString(success.resourceId ?? context.resourceId),
      result,
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

function sanitizeObject(value: JsonRecord): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSecretishKey(key)) {
      continue;
    }
    const sanitized = sanitizeValue(nestedValue);
    if (typeof sanitized !== "undefined") {
      output[key] = sanitized;
    }
  }
  return output;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((entry) => typeof entry !== "undefined");
  }
  if (typeof value === "object") {
    return sanitizeObject(value as JsonRecord);
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

function isSecretishKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized === "key" ||
    /(authorization|bearer|credential|encrypted|password|secret|token|webhook|api[_-]?key|privatekey|accesskey)/i.test(
      normalized,
    )
  );
}
