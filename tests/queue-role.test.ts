import { describe, expect, it, vi } from "vitest";

import { queueRole, routeQueueBatch, UnknownQueueError } from "../workers/queue-role";

const PROD = {
  "send-email": "send-email",
  "send-email-dlq": "send-email-dlq",
  "fetch-sweep": "fetch-sweep",
  "fetch-sweep-dlq": "fetch-sweep-dlq",
} as const;

describe("queueRole", () => {
  it.each(Object.entries(PROD))("maps the production queue %s to its role", (name, role) => {
    expect(queueRole(name)).toBe(role);
  });

  it.each(Object.entries(PROD))("maps %s-staging to the same role", (name, role) => {
    expect(queueRole(`${name}-staging`)).toBe(role);
  });

  it.each([
    "",
    "send-email-dlq-extra",
    "fetch-sweep-staging-staging",
    "-staging",
    "page-sweep",
    "SEND-EMAIL",
    "staging",
  ])("refuses the unknown queue %j instead of falling through to the email consumer", (name) => {
    expect(() => queueRole(name)).toThrow(UnknownQueueError);
  });
});

describe("routeQueueBatch", () => {
  const handlers = () => ({
    "send-email": vi.fn(() => Promise.resolve()),
    "send-email-dlq": vi.fn(() => Promise.resolve()),
    "fetch-sweep": vi.fn(() => Promise.resolve()),
    "fetch-sweep-dlq": vi.fn(() => Promise.resolve()),
  });

  it.each([
    ["send-email", "send-email"],
    ["send-email-dlq", "send-email-dlq"],
    ["fetch-sweep", "fetch-sweep"],
    ["fetch-sweep-dlq", "fetch-sweep-dlq"],
    ["send-email-staging", "send-email"],
    ["send-email-dlq-staging", "send-email-dlq"],
    ["fetch-sweep-staging", "fetch-sweep"],
    ["fetch-sweep-dlq-staging", "fetch-sweep-dlq"],
  ] as const)("hands a batch from %s to the %s handler only", async (queue, role) => {
    const calls = handlers();
    const batch = { queue };

    await routeQueueBatch(batch, calls);

    for (const [name, handler] of Object.entries(calls)) {
      expect(handler).toHaveBeenCalledTimes(name === role ? 1 : 0);
    }
    expect(calls[role]).toHaveBeenCalledWith(batch);
  });

  it("rejects a batch from an unknown queue and runs no handler", async () => {
    const calls = handlers();

    await expect(routeQueueBatch({ queue: "page-sweep" }, calls)).rejects.toThrow(UnknownQueueError);

    for (const handler of Object.values(calls)) expect(handler).not.toHaveBeenCalled();
  });
});
