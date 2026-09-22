import { describe, expect, it, vi } from "vitest";
import type { Breadcrumb, ErrorEvent } from "@sentry/cloudflare";

const captured = vi.hoisted(() => ({
  options: undefined as
    | ((env: { SENTRY_DSN?: string }) => {
        dsn?: string;
        tracesSampleRate?: number;
        integrations?: { name?: string; maxRequestBodySize?: string }[];
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
    options: (env: { SENTRY_DSN?: string }) => unknown,
    handler: { fetch?: unknown; scheduled?: unknown },
  ) => {
    captured.options = options as NonNullable<typeof captured.options>;
    captured.handler = handler;
    return handler;
  },
  httpServerIntegration: (options?: { maxRequestBodySize?: string }) => ({
    name: "HttpServer",
    ...options,
  }),
}));

vi.mock("react-router", () => ({
  createRequestHandler: () => () => new Response("ok"),
}));

import worker from "../workers/app";

const MAGIC = "https://0509.io/api/auth/magic-link/verify?token=secret-token&email=a@b.c";

describe("sentry scrub", () => {
  it("keeps fetch and scheduled, and reads the DSN from env", () => {
    expect(worker).toBe(captured.handler);
    expect(typeof captured.handler?.fetch).toBe("function");
    expect(typeof captured.handler?.scheduled).toBe("function");
    const options = captured.options?.({ SENTRY_DSN: "https://example.invalid/1" });
    expect(options?.dsn).toBe("https://example.invalid/1");
    expect(captured.options?.({}).dsn).toBeUndefined();
    expect(options?.tracesSampleRate).toBe(0);
    expect(options?.integrations?.[0]).toMatchObject({
      name: "HttpServer",
      maxRequestBodySize: "none",
    });
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

  it("strips magic-link credentials, including console arguments, without mutating the event", () => {
    const send = captured.options?.({})?.beforeSend;
    const crumb = captured.options?.({})?.beforeBreadcrumb;
    expect(send).toBeTypeOf("function");
    expect(crumb).toBeTypeOf("function");

    const source = {
      request: {
        url: MAGIC,
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
          category: "console",
          message: `opened ${MAGIC}.`,
          data: {
            arguments: [`opened ${MAGIC}`],
            logger: "console",
            url: "https://0509.io/login?token=secret-token",
          },
        },
      ],
      exception: {
        values: [{ type: "Error", value: `failed ${MAGIC}` }],
      },
    };

    const event = send?.(source);
    expect(source.request.url).toBe(MAGIC);
    expect(source.request.headers).toEqual({ cookie: "session=secret" });
    expect(source.breadcrumbs[0]?.data.arguments[0]).toBe(`opened ${MAGIC}`);

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
    expect(event?.breadcrumbs?.[0]?.data?.arguments).toEqual([
      "opened https://0509.io/api/auth/magic-link/verify",
    ]);
    expect(event?.breadcrumbs?.[0]?.data?.url).toBe("https://0509.io/login");
    expect(event?.exception?.values?.[0]?.value).toBe(
      "failed https://0509.io/api/auth/magic-link/verify",
    );

    const bare = crumb?.({
      message: "no url here",
      data: { url: "https://0509.io/app", arguments: ["plain"] },
    });
    expect(bare?.message).toBe("no url here");
    expect(bare?.data?.url).toBe("https://0509.io/app");
    expect(bare?.data?.arguments).toEqual(["plain"]);
  });
});
