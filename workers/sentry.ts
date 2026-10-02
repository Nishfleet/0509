import { consoleLoggingIntegration } from "@sentry/cloudflare";
import type { CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";

type TransactionEvent = Parameters<NonNullable<CloudflareOptions["beforeSendTransaction"]>>[0];
type SentryLog = Parameters<NonNullable<CloudflareOptions["beforeSendLog"]>>[0];
type SentryEnv = Env & { SENTRY_DSN?: string };

const TOKEN_PATH_PREFIXES = ["/u/", "/v/"] as const;
const REDACTED = "[redacted]";

export const sentryOptions = (env: SentryEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  enableLogs: true,
  integrations: [consoleLoggingIntegration()],
  sendDefaultPii: false,
  beforeBreadcrumb: () => null,
  beforeSend: scrubEvent,
  beforeSendLog: scrubLog,
  beforeSendTransaction: scrubEvent,
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

function scrubLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value !== null && typeof value === "object" && depth < 3) {
    if (Array.isArray(value)) return value.map((entry) => scrubLogValue(entry, depth + 1));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, scrubLogValue(entry, depth + 1)]),
    );
  }
  return value;
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
