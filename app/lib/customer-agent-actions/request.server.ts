import {
  AgentActionIdempotencyConflictError,
  AgentActionReplayUnavailableError,
} from "~/lib/agent-actions.server";
import {
  isSecretishMemoryField,
  isSecretishMemoryString,
} from "~/lib/agent-memory.server";
import {
  isCustomerAgentActionName,
  type CustomerAgentActionName,
} from "~/lib/agent-action-catalog";

const IDEMPOTENCY_REQUIRED_ACTIONS = new Set<CustomerAgentActionName>([
  "counter_move_brief.create",
  "source.meta.retest",
  "watchlist.create",
  "watchlist.update",
  "watchlist.refresh",
  "watchlist.pause",
  "watchlist.resume",
  "collection.create",
  "proof.add_external",
  "share.create",
  "report.share",
  "memory.upsert",
  "client_room.upsert",
  "support_case.create",
  "delivery_settings.update",
  "delivery_target.update",
]);

const IDEMPOTENCY_IGNORED_ACTIONS = new Set<CustomerAgentActionName>([
  "delivery_targets.list",
  "web_mentions.list",
  "memory.list",
  "client_room.list",
  "support_case.list",
]);

export interface CustomerAgentActionContext {
  userId: string;
  apiKeyId: string | null;
  idempotencyKey?: string | null;
  source: "mcp" | "api_v1";
  executionContext?: ExecutionContext | null;
  origin?: string | null;
  authorizeExternalEffect?: () => void | Promise<void>;
}

export class CustomerAgentActionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      status?: number;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "CustomerAgentActionError";
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details ?? {};
  }
}

export function customerAgentActionErrorPayload(error: unknown) {
  if (error instanceof CustomerAgentActionError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: error.code,
        message: error.message,
        ...error.details,
      },
    };
  }

  if (error instanceof AgentActionIdempotencyConflictError) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "idempotency_conflict",
        message: error.message,
      },
    };
  }

  if (error instanceof AgentActionReplayUnavailableError) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "idempotency_replay_unavailable",
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: "agent_action_failed",
      message: "Agent action failed.",
    },
  };
}

export function normalizeCustomerAgentActionName(value: string | null | undefined): CustomerAgentActionName | null {
  const normalized = value?.trim().toLowerCase();
  return isCustomerAgentActionName(normalized) ? normalized : null;
}

export function customerAgentActionRequiresIdempotency(actionName: CustomerAgentActionName) {
  return IDEMPOTENCY_REQUIRED_ACTIONS.has(actionName);
}

export function customerAgentActionSupportsIdempotency(actionName: CustomerAgentActionName) {
  return !IDEMPOTENCY_IGNORED_ACTIONS.has(actionName);
}

export function requireString(input: Record<string, unknown>, field: string) {
  const value = readString(input, field);
  if (!value) {
    throw new CustomerAgentActionError("missing_field", `${field} is required.`);
  }
  return value;
}

export function readString(input: Record<string, unknown>, field: string) {
  const value = input[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readBoolean(input: Record<string, unknown>, field: string, fallback: boolean) {
  const value = input[field];
  return typeof value === "boolean" ? value : fallback;
}

export function readOptionalBoolean(input: Record<string, unknown>, field: string) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    return undefined;
  }
  const value = input[field];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  throw new CustomerAgentActionError("invalid_boolean", `${field} must be true or false.`);
}

export function readInteger(input: Record<string, unknown>, field: string, fallback: number) {
  const value = input[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.floor(Number(value));
  }
  return fallback;
}

export function clampListLimit(value: number, max = 100) {
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export function readStringList(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      .map((entry) => entry.trim());
  }
  const single = readString(input, field);
  return single
    ? single
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
    : [];
}

export function buildAgentActionRequestFingerprint(actionName: CustomerAgentActionName, input: Record<string, unknown>) {
  return fnv1a32(`${actionName}:${stableStringify(sanitizeAgentActionInputForFingerprint(actionName, input))}`);
}

function sanitizeAgentActionInputForFingerprint(actionName: CustomerAgentActionName, input: Record<string, unknown>) {
  return sanitizeFingerprintObject(input, {
    actionName,
    topLevel: true,
  });
}

function sanitizeFingerprintObject(
  input: Record<string, unknown>,
  options: {
    actionName: CustomerAgentActionName;
    topLevel?: boolean;
  },
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (options.topLevel && (key === "action" || key === "idempotencyKey")) {
      continue;
    }
    const preservesSchemaKey = options.topLevel && options.actionName === "memory.upsert" && key === "key";
    if (isSecretishMemoryField(key) && !preservesSchemaKey) {
      output[key] = "[redacted]";
      continue;
    }
    const sanitized = sanitizeFingerprintValue(value, options.actionName);
    if (typeof sanitized !== "undefined") {
      output[key] = sanitized;
    }
  }
  return output;
}

function sanitizeFingerprintValue(value: unknown, actionName: CustomerAgentActionName): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return isSecretishMemoryString(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFingerprintValue(entry, actionName))
      .filter((entry) => typeof entry !== "undefined");
  }
  if (value && typeof value === "object") {
    return sanitizeFingerprintObject(value as Record<string, unknown>, { actionName });
  }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => typeof nestedValue !== "undefined")
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`).join(",")}}`;
  }
  return "null";
}

function fnv1a32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
