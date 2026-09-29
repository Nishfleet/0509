import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

import { captureException } from "@sentry/cloudflare";

import {
  DELIVERY_FAILED_BODY,
  DELIVERY_FAILED_KIND,
  DELIVERY_FAILED_TITLE,
  DLQ_ALERT_PREFIX,
  DLQ_INCIDENT_PREFIX,
  INCIDENT_UNDELIVERED_BODY,
  INCIDENT_UNDELIVERED_TITLE,
  deliveryFailedAlert,
  handleDlqBatch,
  incidentUndeliveredAlert,
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

function capturedReasons(): string[] {
  return vi
    .mocked(captureException)
    .mock.calls.map((call) => (call[0] instanceof Error ? call[0].message : String(call[0])));
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

describe("incidentUndeliveredAlert", () => {
  it("names the incident, stays on the delivery_failed kind the alerts page already renders (0509#5761)", () => {
    const alert = incidentUndeliveredAlert({
      incident_id: "inc_1",
      workspace_id: "ws_1",
      now: "2026-09-28T00:00:00.000Z",
    });
    expect(alert.id).toBe(`${DLQ_INCIDENT_PREFIX}inc_1`);
    expect(alert.kind).toBe(DELIVERY_FAILED_KIND);
    expect(alert.workspace_id).toBe("ws_1");
    expect(alert.title).toBe(INCIDENT_UNDELIVERED_TITLE);
    expect(alert.body).toBe(INCIDENT_UNDELIVERED_BODY);
    expect(alert.body).not.toContain("2026-09-28");
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

  it("raises the Sentry error and writes the workspace alert for a dead-lettered incident (0509#5761)", async () => {
    vi.mocked(captureException).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, recorded } = fakeEnv((sql) => {
      if (sql.startsWith("SELECT workspace_id FROM incident")) {
        return Promise.resolve({ workspace_id: "ws_1" });
      }
      if (sql.startsWith("SELECT error")) {
        return Promise.resolve({ error: "invalid recipient" });
      }
      return Promise.resolve(null);
    });
    const { batch, ack, retry } = fakeBatch({ incident_id: "inc_1" });

    const ids = await handleDlqBatch(env, batch);

    const inserts = recorded.filter((row) => row.sql.startsWith("INSERT INTO alert"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.args[0]).toBe(`${DLQ_INCIDENT_PREFIX}inc_1`);
    expect(inserts[0]?.args[1]).toBe("ws_1");
    expect(inserts[0]?.args[2]).toBe(DELIVERY_FAILED_KIND);
    expect(inserts[0]?.args).not.toContain("invalid recipient");
    // The digest branch must stay out of the incident branch's way.
    expect(recorded.some((row) => row.sql.includes("FROM digest"))).toBe(false);
    expect(recorded.some((row) => row.sql.startsWith("UPDATE digest"))).toBe(false);
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(ids).toEqual([`${DLQ_INCIDENT_PREFIX}inc_1`]);

    // The finding: before this, this message died on "unparseable message" and
    // reached nobody. Now Sentry carries it, naming the incident and why.
    expect(capturedReasons()).toHaveLength(1);
    expect(capturedReasons()[0]).toContain("inc_1");
    expect(capturedReasons()[0]).toContain("invalid recipient");
    expect(error).not.toHaveBeenCalledWith("send-email-dlq: unparseable message", "m1");
    error.mockRestore();
  });

  it("still raises the Sentry error when the incident row is gone (0509#5761)", async () => {
    vi.mocked(captureException).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, recorded } = fakeEnv(() => Promise.resolve(null));
    const { batch, ack, retry } = fakeBatch({ incident_id: "inc_gone" });

    const ids = await handleDlqBatch(env, batch);

    expect(recorded.some((row) => row.sql.startsWith("INSERT INTO alert"))).toBe(false);
    expect(capturedReasons()).toHaveLength(1);
    expect(capturedReasons()[0]).toContain("inc_gone");
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
    error.mockRestore();
  });
});
