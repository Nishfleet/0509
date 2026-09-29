import type { CloudflareOptions } from "@sentry/cloudflare";

type SentryEnv = Env & { SENTRY_DSN?: string };

const TOKEN_PATH_PREFIXES = ["/u/", "/v/"] as const;
const REDACTED = "[redacted]";

export const sentryOptions = (env: SentryEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeBreadcrumb: () => null,
  beforeSend: (event) => {
    const route = typeof event.tags?.route === "string" ? event.tags.route : undefined;
    const transaction =
      route ?? (event.transaction === undefined ? undefined : scrubTokenPath(event.transaction));
    return {
      ...event,
      ...(transaction === undefined ? {} : { transaction }),
      request: event.request && {
        method: event.request.method,
        url: route ?? scrubRequestUrl(event.request.url),
      },
    };
  },
});

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
