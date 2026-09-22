import { describe, expect, it, vi } from "vitest";
import type { Breadcrumb, ErrorEvent } from "@sentry/cloudflare";

const captured = vi.hoisted(() => ({
  options: undefined as
    | (() => {
        tracesSampleRate?: number;
        dsn?: string;
        dataCollection?: {
          userInfo?: boolean;
          cookies?: boolean | object;
          httpHeaders?: boolean | object;
          httpBodies?: string[];
          urlQueryParams?: boolean | object;
          stackFrameVariables?: boolean | object;
          databaseQueryData?: boolean;
        };
        beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
        beforeBreadcrumb?: (breadcrumb: Breadcrumb) => Breadcrumb | null;
      })
    | undefined,
  handler: undefined as { fetch?: unknown; scheduled?: unknown } | undefined,
}));

vi.mock("@sentry/cloudflare", () => ({
  withSentry: (
    options: () => unknown,
    handler: { fetch?: unknown; scheduled?: unknown },
  ) => {
    captured.options = options as NonNullable<typeof captured.options>;
    captured.handler = handler;
    return handler;
  },
}));

vi.mock("react-router", () => ({
  createRequestHandler: () => () => new Response("ok"),
}));

import "../workers/app";

describe("sentry scrub", () => {
  it("wraps fetch and scheduled, and does not embed a DSN", () => {
    expect(typeof captured.handler?.fetch).toBe("function");
    expect(typeof captured.handler?.scheduled).toBe("function");
    const options = captured.options?.();
    expect(options?.dsn).toBeUndefined();
    expect(options?.tracesSampleRate).toBe(0);
    expect(options?.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
    });
  });

  it("strips magic-link credentials from the event and its breadcrumbs", () => {
    const options = captured.options?.();
    const send = options?.beforeSend;
    const crumb = options?.beforeBreadcrumb;
    expect(send).toBeTypeOf("function");
    expect(crumb).toBeTypeOf("function");

    const event = send?.({
      request: {
        url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&email=a@b.c",
        method: "GET",
        headers: { cookie: "session=secret" },
        cookies: { session: "secret" },
        data: "body",
        query_string: "token=secret-token",
      },
      user: { email: "a@b.c", ip_address: "203.0.113.5" },
      transaction: "/api/auth/magic-link/verify?token=secret-token",
      breadcrumbs: [
        {
          message: "opened https://0509.io/api/auth/magic-link/verify?token=secret-token.",
          data: { url: "https://0509.io/login?token=secret-token" },
        },
      ],
      exception: {
        values: [
          {
            type: "Error",
            value: "failed https://0509.io/api/auth/magic-link/verify?token=secret-token",
          },
        ],
      },
    });

    expect(event?.request?.url).toBe("https://0509.io/api/auth/magic-link/verify");
    expect(event?.request?.headers).toBeUndefined();
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.data).toBeUndefined();
    expect(event?.request?.query_string).toBeUndefined();
    expect(event?.user).toBeUndefined();
    expect(event?.transaction).toBe("/api/auth/magic-link/verify");
    expect(event?.breadcrumbs?.[0]?.message).toBe(
      "opened https://0509.io/api/auth/magic-link/verify.",
    );
    expect(event?.breadcrumbs?.[0]?.data?.url).toBe("https://0509.io/login");
    expect(event?.exception?.values?.[0]?.value).toBe(
      "failed https://0509.io/api/auth/magic-link/verify",
    );

    const bare = crumb?.({
      message: "no url here",
      data: { url: "https://0509.io/app" },
    });
    expect(bare?.message).toBe("no url here");
    expect(bare?.data?.url).toBe("https://0509.io/app");
  });
});
