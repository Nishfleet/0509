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

function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactText(breadcrumb.message);
  }
  if (!breadcrumb.data) return breadcrumb;
  const data = breadcrumb.data as Record<string, unknown>;
  for (const key of ["url", "from", "to"]) {
    const value = data[key];
    if (typeof value === "string") data[key] = redactText(value);
  }
  return breadcrumb;
}

function redactEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (request) {
    if (typeof request.url === "string") request.url = stripQueryAndHash(request.url);
    request.headers = undefined;
    request.cookies = undefined;
    request.data = undefined;
    request.query_string = undefined;
  }
  event.user = undefined;
  if (typeof event.transaction === "string") {
    event.transaction = stripQueryAndHash(event.transaction);
  }
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) redactBreadcrumb(breadcrumb);
  }
  const values = event.exception?.values;
  if (values) {
    for (const item of values) {
      if (typeof item.value === "string") item.value = redactText(item.value);
    }
  }
  return event;
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

export default Sentry.withSentry(
  () => ({
    tracesSampleRate: 0,
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
