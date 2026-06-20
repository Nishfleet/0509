import { sanitizeAgentActionMetadata } from "~/lib/agent-actions.server";
import { AGENT_MEMORY_SCOPES, type AgentMemoryRecord, type AgentMemoryScope } from "~/lib/types";

type JsonRecord = Record<string, unknown>;

export class AgentMemoryInputError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AgentMemoryInputError";
    this.code = code;
    this.status = status;
  }
}

export function readSafeAgentMemoryScope(value: unknown): AgentMemoryScope {
  return readOptionalSafeAgentMemoryScope(value) ?? "workspace";
}

export function readOptionalSafeAgentMemoryScope(value: unknown): AgentMemoryScope | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value !== "string") {
    throw new AgentMemoryInputError(
      "invalid_memory_scope",
      "scope must be workspace, customer, brand, or competitor.",
    );
  }

  const scope = value.trim();
  if (!scope) {
    return null;
  }
  if ((AGENT_MEMORY_SCOPES as readonly string[]).includes(scope)) {
    return scope as AgentMemoryScope;
  }

  throw new AgentMemoryInputError(
    "invalid_memory_scope",
    "scope must be workspace, customer, brand, or competitor.",
  );
}

export function readSafeAgentMemoryKey(value: unknown): string {
  const key = requireMemoryString(value, "key");
  if (isSecretishMemoryField(key) || isSecretishMemoryString(key)) {
    throw new AgentMemoryInputError("secret_memory_rejected", "Memory keys cannot describe secrets or credentials.");
  }
  return key;
}

export function readSafeAgentMemorySource(value: unknown): string | null {
  const source = readOptionalMemoryString(value);
  if (source && (isSecretishMemoryField(source) || isSecretishMemoryString(source))) {
    throw new AgentMemoryInputError("secret_memory_rejected", "Memory source cannot describe secrets or credentials.");
  }
  return source;
}

export function readSafeAgentMemoryValue(value: unknown): JsonRecord {
  rejectSecretishMemoryValue(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return { value };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return sanitizeAgentActionMetadata(value);
  }
  if (Array.isArray(value)) {
    return {
      items: value.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? sanitizeAgentActionMetadata(entry)
          : entry,
      ),
    };
  }
  throw new AgentMemoryInputError("missing_field", "value is required.");
}

export function safeAgentMemoryRecord(memory: AgentMemoryRecord): AgentMemoryRecord {
  const value = sanitizeAgentFacingValue(memory.value);

  return {
    ...memory,
    key: isSecretishMemoryField(memory.key) || isSecretishMemoryString(memory.key) ? "[redacted]" : memory.key,
    value: value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {},
    source: memory.source && (isSecretishMemoryField(memory.source) || isSecretishMemoryString(memory.source))
      ? null
      : memory.source,
  };
}

export function summarizeAgentMemoryValue(value: unknown) {
  const sanitized = sanitizeAgentFacingValue(value);
  if (!sanitized || typeof sanitized !== "object") {
    return summarizePrimitiveMemoryValue(sanitized);
  }
  if (Array.isArray(sanitized)) {
    return summarizeMemoryItems(sanitized.length);
  }

  const record = sanitized as JsonRecord;
  if (Object.prototype.hasOwnProperty.call(record, "value")) {
    return summarizePrimitiveMemoryValue(record.value);
  }
  if (Array.isArray(record.items)) {
    return summarizeMemoryItems(record.items.length);
  }

  const fields = Object.keys(record).filter((key) => record[key] !== null && typeof record[key] !== "undefined");
  return fields.length > 0 ? `Fields: ${fields.slice(0, 3).join(", ")}` : "Structured context";
}

export function rejectSecretishMemoryValue(
  value: unknown,
  message = "Memory values cannot contain secrets or credentials.",
) {
  if (typeof value === "string") {
    if (isSecretishMemoryString(value)) {
      throw new AgentMemoryInputError("secret_memory_rejected", message);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      rejectSecretishMemoryValue(entry, message);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as JsonRecord)) {
      if (isSecretishMemoryField(key) || isSecretishMemoryString(key)) {
        throw new AgentMemoryInputError("secret_memory_rejected", message);
      }
      rejectSecretishMemoryValue(nested, message);
    }
  }
}

export function sanitizeAgentFacingValue(value: unknown): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return isSecretishMemoryString(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeAgentFacingValue).filter((entry) => typeof entry !== "undefined");
  }
  if (value && typeof value === "object") {
    const output: JsonRecord = {};
    for (const [key, nested] of Object.entries(value as JsonRecord)) {
      if (isSecretishMemoryField(key) || isSecretishMemoryString(key)) {
        output["[redacted]"] = "[redacted]";
      } else {
        output[key] = sanitizeAgentFacingValue(nested);
      }
    }
    return output;
  }
  return undefined;
}

export function isSecretishMemoryField(value: string) {
  return /^(key|token|secret|password)$/i.test(value.trim()) ||
    /(authorization|bearer|credential|encrypted|password|secret|token|webhook|api[_-]?key|privatekey|accesskey)/i
    .test(value);
}

export function isSecretishMemoryString(value: string) {
  const normalized = value.trim();
  return (
    containsSecretishJsonMemoryValue(normalized) ||
    /(?:^|[^a-z0-9_])f9_live_[a-z0-9_-]+/i.test(normalized) ||
    /\b(?:bearer\s+[a-z0-9._~+/=-]+|xox[baprs]-[a-z0-9-]+|sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,})\b/i.test(normalized) ||
    /(?:^|[{\s,])["']?(?:password|passphrase|api[_-]?key|access[_-]?key|secret|token|authorization|webhook(?:[_-]?url)?)["']?\s*[:=]\s*["']?\S+/i.test(normalized) ||
    /\b[a-z0-9_]*(?:api[_-]?key|access[_-]?key|secret|token|password|webhook)[a-z0-9_]*\s*=\s*\S+/i.test(normalized) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(normalized) ||
    /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i.test(normalized) ||
    /https:\/\/[^\s"'<>]*(?:hooks\.slack\.com\/services|hooks\.zapier\.com\/hooks\/catch|discord(?:app)?\.com\/api\/webhooks|webhook\.office\.com|outlook\.office\.com\/webhook|\/(?:api\/)?webhooks?\/|\/hooks\/catch\/)[^\s"'<>]*/i.test(normalized) ||
    /https:\/\/[^\s"'<>]*(?:logic\.azure\.com|powerautomate\.com)[^\s"'<>]*\bsig=/i.test(normalized) ||
    /(?:\/share\/[a-z0-9_-]{12,}|https:\/\/[^/\s]+\/share\/[a-z0-9_-]{12,})/i.test(normalized)
  );
}

function containsSecretishJsonMemoryValue(value: string) {
  const normalized = value.trim();
  if (!normalized || !/^[{["]/.test(normalized)) {
    return false;
  }

  try {
    return hasSecretishMemoryContent(JSON.parse(normalized));
  } catch {
    return false;
  }
}

function hasSecretishMemoryContent(value: unknown): boolean {
  if (typeof value === "string") {
    return isSecretishMemoryString(value);
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretishMemoryContent);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as JsonRecord).some(([key, nested]) =>
      isSecretishMemoryField(key) || isSecretishMemoryString(key) || hasSecretishMemoryContent(nested)
    );
  }
  return false;
}

function requireMemoryString(value: unknown, name: string) {
  const normalized = readOptionalMemoryString(value);
  if (!normalized) {
    throw new AgentMemoryInputError("missing_field", `${name} is required.`);
  }
  return normalized;
}

function readOptionalMemoryString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function summarizePrimitiveMemoryValue(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "Empty context";
    }
    return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "Empty context";
  }
  return "Structured context";
}

function summarizeMemoryItems(count: number) {
  return `${count} saved item${count === 1 ? "" : "s"}`;
}
