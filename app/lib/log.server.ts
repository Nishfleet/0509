import type { AppEnv } from "~/lib/env.server";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogRecord {
  level: AppLogLevel;
  operation: string;
  message: string;
  timestamp: string;
  requestId?: string | null;
  userId?: string | null;
  watchlistId?: string | null;
  eventId?: string | null;
  paymentId?: string | null;
  details?: Record<string, unknown>;
}

const REDACTED_KEY = /(secret|password|token|signature|cookie|authorization|ticket|api[_-]?key)/i;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(redactValue);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEY.test(key) ? "[redacted]" : redactValue(nested);
    }
    return output;
  }
  return value;
}

export function requestIdFrom(request: Request) {
  return (
    request.headers.get("cf-ray") ??
    request.headers.get("x-request-id") ??
    request.headers.get("x-correlation-id")
  );
}

export function writeAppLog(record: AppLogRecord) {
  const payload = {
    ...record,
    details: record.details ? redactValue(record.details) : undefined,
  };
  const line = JSON.stringify(payload);
  if (record.level === "error") {
    console.error(line);
    return;
  }
  if (record.level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function logAppEvent(
  level: AppLogLevel,
  operation: string,
  message: string,
  fields: Omit<AppLogRecord, "level" | "operation" | "message" | "timestamp"> = {},
) {
  writeAppLog({
    level,
    operation,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  });
}

export function logBillingEvent(
  env: AppEnv,
  level: AppLogLevel,
  operation: string,
  message: string,
  fields: Omit<AppLogRecord, "level" | "operation" | "message" | "timestamp"> = {},
) {
  void env;
  logAppEvent(level, operation, message, fields);
}
