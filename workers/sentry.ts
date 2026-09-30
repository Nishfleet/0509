import type { CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";

type TransactionEvent = Parameters<NonNullable<CloudflareOptions["beforeSendTransaction"]>>[0];
type SentryEnv = Env & { SENTRY_DSN?: string };

const TOKEN_PATH_PREFIXES = ["/u/", "/v/"] as const;
const REDACTED = "[redacted]";

export const sentryOptions = (env: SentryEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeBreadcrumb: () => null,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
});

const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/g;
const EMAIL_PATTERN = /[^\s@"'<>]+@[^\s@"'<>]+/g;
const KEPT_CONTEXTS = ["runtime", "os"] as const;

function scrubEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  const route = typeof event.tags?.route === "string" ? event.tags.route : undefined;
  const transaction = route ?? (event.transaction === undefined ? undefined : scrubTokenPath(event.transaction));
  const { extra: _extra, ...rest } = event;
  return {
    ...rest,
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
  return url === undefined ? undefined : scrubTokenPath(url.split("?")[0]);
}

function scrubTokenPath(value: string): string {
  for (const prefix of TOKEN_PATH_PREFIXES) {
    const start = value.indexOf(prefix);
    if (start !== -1) return `${value.slice(0, start)}${prefix}${REDACTED}`;
  }
  return value;
}
