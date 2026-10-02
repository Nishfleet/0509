import { CloudflareClient, createTransport, setCurrentClient } from "@sentry/cloudflare";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sentryOptions } from "../workers/sentry";

type BeforeSend = NonNullable<ReturnType<typeof sentryOptions>["beforeSend"]>;
type SentryEvent = Parameters<BeforeSend>[0];

const options = sentryOptions({});

afterEach(() => {
  vi.restoreAllMocks();
});

async function beforeSend(event: SentryEvent): Promise<SentryEvent> {
  const send = options.beforeSend;
  if (send === undefined) throw new Error("the Sentry options have no beforeSend");
  const result = await send(event, {});
  if (result === null) throw new Error("beforeSend dropped the event");
  return result;
}

describe("Sentry beforeSend", () => {
  it("redacts the unsubscribe token and drops the query", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      request: { method: "GET", url: "https://0509.io/u/abc?x=1" },
    });

    expect(result.request?.url).toBe("https://0509.io/u/[redacted]");
  });

  it("redacts a delivery-confirm token the same way", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      request: { method: "GET", url: "https://0509.io/v/abc?x=1" },
    });

    expect(result.request?.url).toBe("https://0509.io/v/[redacted]");
  });

  it("redacts the unsubscribe token in the transaction name", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      transaction: "GET /u/abc",
    });

    expect(result.transaction).toBe("GET /u/[redacted]");
  });

  it("redacts a delivery-confirm token in the transaction name", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      transaction: "GET /v/abc",
    });

    expect(result.transaction).toBe("GET /v/[redacted]");
  });

  it("leaves a path without a token alone apart from the query", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      request: { method: "GET", url: "https://0509.io/brief?x=1" },
    });

    expect(result.request?.url).toBe("https://0509.io/brief");
  });

  it("keeps the rest of the event and drops the rest of the request", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      platform: "javascript",
      request: { method: "GET", url: "https://0509.io/u/abc", headers: { cookie: "session" } },
    });

    expect(result.event_id).toBe("e1");
    expect(result.platform).toBe("javascript");
    expect(result.request).toEqual({ method: "GET", url: "https://0509.io/u/[redacted]" });
  });

  it("tolerates an event with no request", async () => {
    const result = await beforeSend({ type: undefined, event_id: "e1" });

    expect(result.request).toBeUndefined();
  });

  it("uses the route tag as the request url and the transaction", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      tags: { route: "/u/:token" },
      transaction: "GET /u/abc",
      request: { method: "GET", url: "https://0509.io/u/abc?x=1" },
    });

    expect(result.request).toEqual({ method: "GET", url: "/u/:token" });
    expect(result.transaction).toBe("/u/:token");
  });

  it("ignores a route tag that is not a string", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      tags: { route: 3 },
      request: { method: "GET", url: "https://0509.io/u/abc?x=1" },
    });

    expect(result.request?.url).toBe("https://0509.io/u/[redacted]");
  });

  it("scrubs urls and emails out of the exception message", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      exception: {
        values: [{ type: "Error", value: "GET https://0509.io/u/abc?x=1 failed for a@b.co" }],
      },
    });

    expect(result.exception?.values?.[0]?.value).toBe("GET https://0509.io/u/[redacted] failed for [redacted]");
  });

  it("drops extra and keeps only the runtime and os contexts", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      extra: { brand: "acme" },
      contexts: { runtime: { name: "workerd" }, os: { name: "linux" }, state: { term: "acme" } },
    });

    expect(result.extra).toBeUndefined();
    expect(result.contexts).toEqual({ runtime: { name: "workerd" }, os: { name: "linux" } });
  });

  it("scrubs a transaction event the same way", async () => {
    const send = options.beforeSendTransaction;
    if (send === undefined) throw new Error("the Sentry options have no beforeSendTransaction");
    const result = await send(
      { type: "transaction", event_id: "e1", transaction: "GET /v/abc", request: { url: "https://0509.io/v/abc?x=1" } },
      {},
    );

    expect(result?.transaction).toBe("GET /v/[redacted]");
    expect(result?.request?.url).toBe("https://0509.io/v/[redacted]");
  });

  it("turns Logs on for console warnings and errors only", async () => {
    expect(options.enableLogs).toBe(true);
    const sent: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = new CloudflareClient({
      ...options,
      dsn: "https://key@o0.ingest.sentry.io/0",
      stackParser: () => [],
      integrations: options.integrations,
      transport: () =>
        createTransport({ recordDroppedEvent: () => undefined }, (request) => {
          sent.push(String(request.body));
          return Promise.resolve({ statusCode: 200 });
        }),
    });
    setCurrentClient(client);
    client.init();

    console.log("plain-log-line");
    console.info("info-line");
    console.warn("warn-line");
    console.error("error-line");
    await client.flush(2000);

    const body = sent.join("\n");
    expect(body).toContain("warn-line");
    expect(body).toContain("error-line");
    expect(body).not.toContain("plain-log-line");
    expect(body).not.toContain("info-line");
  });

  it("scrubs emails, token paths and string attributes from a log line", () => {
    const send = options.beforeSendLog;
    if (send === undefined) throw new Error("the Sentry options have no beforeSendLog");
    const result = send({
      level: "error",
      message: "failed for a@b.co at https://0509.io/u/abc?x=1",
      attributes: { url: "https://0509.io/v/abc?x=1", count: 3 },
    });

    expect(result?.message).toBe("failed for [redacted] at https://0509.io/u/[redacted]");
    expect(result?.attributes).toEqual({ url: "https://0509.io/v/[redacted]", count: 3 });
  });
});
