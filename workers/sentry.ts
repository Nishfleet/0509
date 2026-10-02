import { consoleLoggingIntegration, type CloudflareOptions, type ErrorEvent } from "@sentry/cloudflare";

type SentryLog = Parameters<NonNullable<CloudflareOptions["beforeSendLog"]>>[0];
type TransactionEvent = Parameters<NonNullable<CloudflareOptions["beforeSendTransaction"]>>[0];
type SentryEnv = Env & { SENTRY_DSN?: string };

const TOKEN_PATH_PREFIXES = ["/u/", "/v/"] as const;
const REDACTED = "[redacted]";
const DEPTH_CAP = 6;
const SEEN_CAP = 2000;

export const sentryOptions = (env: SentryEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeBreadcrumb: () => null,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  enableLogs: true,
  integrations: [consoleLoggingIntegration({ levels: ["warn", "error"] })],
  beforeSendLog: scrubLog,
});

function scrubLog(log: SentryLog): SentryLog {
  return {
    ...log,
    message: scrubText(String(log.message)),
    attributes: Object.fromEntries(
      Object.entries(log.attributes ?? {}).map(([key, value]) => [key, scrubLogValue(value)]),
    ),
  };
}

function scrubLogValue(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubText(value);
  if (isTraversable(value)) return scrubContainer(value, depth, seen ?? new WeakSet());
  return value;
}
function scrubContainer(value: object, depth: number, seen: WeakSet<object>): unknown {
  if (depth >= DEPTH_CAP || seen.size >= SEEN_CAP || seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => scrubLogValue(entry, depth + 1, seen));
  if (isOpaqueObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubLogValue(entry, depth + 1, seen)]));
}

function isTraversable(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function isOpaqueObject(value: object): boolean {
  if (Object.entries(value).length > 0) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return isTraversable(prototype) && prototype !== Object.prototype;
}

const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/g;
const EMAIL_PATTERN = /[^\s@"'<>]+@[^\s@"'<>]+/g;
const KEPT_CONTEXTS = ["runtime", "os"] as const;

function scrubEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  const route = typeof event.tags?.route === "string" ? event.tags.route : undefined;
  const transaction = route ?? (event.transaction === undefined ? undefined : scrubTokenPath(event.transaction));
  return {
    ...event,
    extra: undefined,
    ...(transaction === undefined ? {} : { transaction }),
    request: event.request && {
      method: event.request.method,
      url: route ?? scrubRequestUrl(event.request.url),
    },
    contexts: Object.fromEntries(
      KEPT_CONTEXTS.flatMap((key) => (event.contexts?.[key] ? [[key, event.contexts[key]]] : [])),
    ),
    ...(event.exception?.values && {
      exception: {
        ...event.exception,
        values: event.exception.values.map((entry) => ({
          ...entry,
          ...(entry.value === undefined ? {} : { value: scrubText(entry.value) }),
        })),
      },
    }),
  };
}

function scrubText(value: string): string {
  return value.replace(URL_PATTERN, (match) => scrubRequestUrl(match) ?? match).replace(EMAIL_PATTERN, REDACTED);
}

function scrubRequestUrl(url: string | undefined): string | undefined {
  return url === undefined ? undefined : scrubTokenPath(url.split("?")[0] ?? url);
}

function scrubTokenPath(value: string): string {
  for (const prefix of TOKEN_PATH_PREFIXES) {
    const start = value.indexOf(prefix);
    if (start !== -1) return `${value.slice(0, start)}${prefix}${REDACTED}`;
  }
  return value;
}
