import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import {
  DELIVERY_FAILED_BODY,
  DELIVERY_FAILED_KIND,
  DELIVERY_FAILED_TITLE,
  DLQ_ALERT_PREFIX,
  deliveryFailedAlert,
  handleDlqBatch,
} from "../../workers/delivery/dlq-consumer";

interface Recorded {
  sql: string;
  args: unknown[];
}

function fakeEnv(firstBySql: (sql: string) => Promise<unknown>): {
  env: Env;
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => {
            recorded.push({ sql, args });
            return {
              first: () => firstBySql(sql),
              run: () => Promise.resolve(),
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, recorded };
}

function fakeBatch(body: unknown) {
  const ack = vi.fn();
  const retry = vi.fn();
  const batch = {
    queue: "send-email-dlq",
    messages: [{ id: "m1", body, ack, retry }],
  } as unknown as MessageBatch;
  return { batch, ack, retry };
}

describe("deliveryFailedAlert", () => {
  it("names the digest and says in plain words that we stopped trying (0509#4375)", () => {
    const alert = deliveryFailedAlert({
      digest_id: "dg_1",
      workspace_id: "ws_1",
      now: "2026-09-23T00:00:00.000Z",
    });
    expect(alert.id).toBe(`${DLQ_ALERT_PREFIX}dg_1`);
    expect(alert.kind).toBe(DELIVERY_FAILED_KIND);
    expect(alert.title).toBe(DELIVERY_FAILED_TITLE);
    expect(alert.body).toBe(DELIVERY_FAILED_BODY);
    expect(alert.body).not.toContain("2026-09-23");
  });
});

describe("handleDlqBatch", () => {
  it("marks the digest failed, inserts one plain delivery_failed alert and acks (0509#4375)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, recorded } = fakeEnv((sql) => {
      if (sql.startsWith("SELECT workspace_id")) {
        return Promise.resolve({ workspace_id: "ws_1" });
      }
      if (sql.startsWith("SELECT error")) {
        return Promise.resolve({ error: "invalid recipient" });
      }
      return Promise.resolve(null);
    });
    const { batch, ack, retry } = fakeBatch({ digest_id: "dg_1" });

    const ids = await handleDlqBatch(env, batch);

    const inserts = recorded.filter((row) => row.sql.startsWith("INSERT INTO alert"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.args[0]).toBe("dlq:dg_1");
    expect(inserts[0]?.args).not.toContain("invalid recipient");
    const failed = recorded.filter((row) => row.sql.startsWith("UPDATE digest SET status = 'failed'"));
    expect(failed.map((row) => row.args)).toEqual([["dg_1"]]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("invalid recipient"));
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(ids).toEqual(["dlq:dg_1"]);
    error.mockRestore();
  });

  it("acks an unparseable message without inserting an alert", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, recorded } = fakeEnv(() => Promise.resolve(null));
    const { batch, ack, retry } = fakeBatch("not-a-message");

    const ids = await handleDlqBatch(env, batch);

    expect(recorded.some((row) => row.sql.startsWith("INSERT INTO alert"))).toBe(false);
    expect(error).toHaveBeenCalledWith("send-email-dlq: unparseable message", "m1");
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
    error.mockRestore();
  });

  it("acks a missing digest without inserting an alert", async () => {
    const { env, recorded } = fakeEnv((sql) => {
      if (sql.startsWith("SELECT workspace_id")) {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    const { batch, ack, retry } = fakeBatch({ digest_id: "dg_1" });

    const ids = await handleDlqBatch(env, batch);

    expect(recorded.some((row) => row.sql.startsWith("INSERT INTO alert"))).toBe(false);
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
  });
});
