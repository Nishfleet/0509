import type { CloudflareOptions } from "@sentry/cloudflare";

type SentryEnv = Env & { SENTRY_DSN?: string };

const UNSUBSCRIBE_PREFIX = "/u/";
const REDACTED = "[redacted]";

export const sentryOptions = (env: SentryEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeBreadcrumb: () => null,
  beforeSend: (event) => ({
    ...event,
    ...(event.transaction === undefined ? {} : { transaction: scrubTokenPath(event.transaction) }),
    request: event.request && {
      method: event.request.method,
      url: scrubRequestUrl(event.request.url),
    },
  }),
});

function scrubRequestUrl(url: string | undefined): string | undefined {
  return url === undefined ? undefined : scrubTokenPath(url.split("?")[0]);
}

function scrubTokenPath(value: string): string {
  const start = value.indexOf(UNSUBSCRIBE_PREFIX);
  if (start === -1) return value;
  return `${value.slice(0, start)}${UNSUBSCRIBE_PREFIX}${REDACTED}`;
}
