import { describe, expect, it } from "vitest";

import { sentryOptions } from "../workers/sentry";

type BeforeSend = NonNullable<ReturnType<typeof sentryOptions>["beforeSend"]>;
type SentryEvent = Parameters<BeforeSend>[0];

const options = sentryOptions({});

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

  it("redacts the unsubscribe token in the transaction name", async () => {
    const result = await beforeSend({
      type: undefined,
      event_id: "e1",
      transaction: "GET /u/abc",
    });

    expect(result.transaction).toBe("GET /u/[redacted]");
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
});
