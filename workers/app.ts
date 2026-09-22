import * as Sentry from "@sentry/cloudflare";
import type { Breadcrumb, ErrorEvent } from "@sentry/cloudflare";
import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

function stripQueryAndHash(value: string): string {
  if (value.includes("://")) {
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return value.split(/[?#]/, 1)[0] ?? value;
    }
  }
  return value.split(/[?#]/, 1)[0] ?? value;
}

function redactText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, (match) => {
    const trimmed = match.replace(/[),.;]+$/, "");
    return stripQueryAndHash(trimmed) + match.slice(trimmed.length);
  });
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item: unknown) => redactValue(item));
  if (typeof value !== "object" || value === null) return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    next[key] = redactValue(item);
  }
  return next;
}

function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    message:
      typeof breadcrumb.message === "string" ? redactText(breadcrumb.message) : breadcrumb.message,
    data: breadcrumb.data
      ? (redactValue(breadcrumb.data) as Breadcrumb["data"])
      : breadcrumb.data,
  };
}

function redactEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  return {
    ...event,
    request: request
      ? {
          ...request,
          url: typeof request.url === "string" ? stripQueryAndHash(request.url) : request.url,
          headers: undefined,
          cookies: undefined,
          data: undefined,
          query_string: undefined,
        }
      : request,
    user: undefined,
    transaction:
      typeof event.transaction === "string"
        ? stripQueryAndHash(event.transaction)
        : event.transaction,
    breadcrumbs: event.breadcrumbs?.map((breadcrumb) => redactBreadcrumb(breadcrumb)),
    exception: event.exception
      ? {
          ...event.exception,
          values: event.exception.values?.map((item) =>
            typeof item.value === "string" ? { ...item, value: redactText(item.value) } : item,
          ),
        }
      : event.exception,
  };
}

const handler = {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(_controller, _env, ctx) {
    // The dead-man ping: an external service alerts when the reports stop,
    // which is the one failure a Worker cannot report about itself.
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
  },
} satisfies ExportedHandler<Env>;

function readDsn(env: Env): string | undefined {
  const bag = env as unknown as Record<string, unknown>;
  const value = bag.SENTRY_DSN;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default Sentry.withSentry(
  (env) => ({
    dsn: readDsn(env),
    tracesSampleRate: 0,
    integrations: [Sentry.httpServerIntegration({ maxRequestBodySize: "none" })],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
      databaseQueryData: false,
    },
    beforeBreadcrumb(breadcrumb) {
      return redactBreadcrumb(breadcrumb);
    },
    beforeSend(event) {
      return redactEvent(event);
    },
  }),
  handler,
);
