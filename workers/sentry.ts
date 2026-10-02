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
    attributes: scrubEntries(Object.entries(log.attributes ?? {}), 0),
  };
}

interface Walk {
  containers: WeakSet<object>;
  visited: number;
}

function scrubEntries(entries: [string, unknown][], depth: number, walk?: Walk): Record<string, unknown> {
  const scrubbed = new Map<string, unknown>();
  for (const [key, entry] of entries) {
    scrubbed.set(uniqueKey(scrubbed, scrubText(key)), scrubLogValue(entry, depth, walk));
  }
  return Object.fromEntries(scrubbed);
}

function uniqueKey(taken: Map<string, unknown>, key: string): string {
  if (!taken.has(key)) return key;
  let suffix = 2;
  while (taken.has(`${key}#${String(suffix)}`)) suffix += 1;
  return `${key}#${String(suffix)}`;
}

function scrubLogValue(value: unknown, depth = 0, walk?: Walk): unknown {
  if (typeof value === "string") return scrubText(value);
  if (isTraversable(value)) return scrubContainer(value, depth, walk ?? { containers: new WeakSet(), visited: 0 });
  return value;
}

function scrubContainer(value: object, depth: number, walk: Walk): unknown {
  if (Object.prototype.toString.call(value) === "[object Date]") return value;
  if (depth >= DEPTH_CAP || walk.visited >= SEEN_CAP || walk.containers.has(value)) return REDACTED;
  walk.visited += 1;
  walk.containers.add(value);
  if (Array.isArray(value)) return value.map((entry) => scrubLogValue(entry, depth + 1, walk));
  if (!isPlainObject(value)) return REDACTED;
  return scrubEntries(Object.entries(value), depth + 1, walk);
}

function isTraversable(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
