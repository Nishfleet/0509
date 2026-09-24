import type { CloudflareOptions } from "@sentry/cloudflare";

interface SentryEnv {
  SENTRY_DSN?: string;
}

const UNSUBSCRIBE_PREFIX = "/u/";
const REDACTED = "[redacted]";

export const sentryOptions = (env: SentryEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeBreadcrumb: () => null,
  beforeSend: (event) => ({
    ...event,
    request: event.request && {
      method: event.request.method,
      url: scrubRequestUrl(event.request.url),
    },
  }),
});

function scrubRequestUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const withoutQuery = url.split("?")[0];
  const start = withoutQuery.indexOf(UNSUBSCRIBE_PREFIX);
  if (start === -1) return withoutQuery;
  return `${withoutQuery.slice(0, start)}${UNSUBSCRIBE_PREFIX}${REDACTED}`;
}
