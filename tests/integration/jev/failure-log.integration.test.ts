import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askChoice, askNoul, askNouls, JevUnavailableError } from "../../../app/lib/jev/client.server";
import type { ChoiceQuestion, NoulQuestion } from "../../../app/lib/jev/client.server";
import { deleteExpiredJevFailures, RETENTION_MS } from "../../../app/lib/data/jev_failure.server";

let asked = 0;

function question(): NoulQuestion {
  asked += 1;
  return {
    id: `failure_log_${String(asked)}`,
    instructions: "Is this a test?",
    whenTrue: "it is a test",
    whenFalse: "it is not a test",
  };
}

async function failuresFor(questionId: string): Promise<unknown[]> {
  let rows: unknown[] = [];
  await vi.waitFor(async () => {
    const { results } = await env.DB.prepare(
      "SELECT question, kind, code, message FROM jev_failure WHERE question = ?1",
    )
      .bind(questionId)
      .all();
    expect(results).not.toHaveLength(0);
    rows = results;
  });
  return rows;
}

function choiceQuestion(): ChoiceQuestion {
  asked += 1;
  return {
    id: `failure_log_choice_${String(asked)}`,
    instructions: "Which one?",
    options: { a: "the first", b: "the second" },
  };
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("a failed Jev call", () => {
  it("is written to jev_failure with its kind, code and message", async () => {
    const asking = question();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("2003: Rate limited"))) });

    await expect(askNoul("ws-failure-log", asking, {})).rejects.toThrow(JevUnavailableError);

    expect(await failuresFor(asking.id)).toEqual([
      { question: asking.id, kind: "rate_limited", code: "2003", message: "2003: Rate limited" },
    ]);
  });

  it("records a billing refusal as billing", async () => {
    const asking = question();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("2021: Payment error"))) });

    await expect(askNoul("ws-failure-log", asking, {})).rejects.toThrow(JevUnavailableError);

    expect(await failuresFor(asking.id)).toMatchObject([{ kind: "billing", code: "2021" }]);
  });

  it("records an answer that does not parse as a bad shape, under the questions of a batch", async () => {
    const first = question();
    const second = question();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.resolve({ unexpected: true })) });

    await expect(askNouls("ws-failure-log", [first, second], {})).rejects.toThrow(JevUnavailableError);

    expect(await failuresFor(`${first.id},${second.id}`)).toMatchObject([{ kind: "bad_shape", code: null }]);
  });

  it("records a timeout in a batch call under the questions asked", async () => {
    const first = question();
    const second = question();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("The operation timed out"))) });

    await expect(askNouls("ws-failure-log", [first, second], {})).rejects.toThrow(JevUnavailableError);

    expect(await failuresFor(`${first.id},${second.id}`)).toMatchObject([{ kind: "timeout", code: null }]);
  });

  it("records a failed choice call, both a timeout and a bad shape", async () => {
    const timedOut = choiceQuestion();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("deadline exceeded"))) });
    await expect(askChoice("ws-failure-log", timedOut, {})).rejects.toThrow(JevUnavailableError);
    expect(await failuresFor(timedOut.id)).toMatchObject([{ kind: "timeout" }]);

    const misshapen = choiceQuestion();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.resolve({ unexpected: true })) });
    await expect(askChoice("ws-failure-log", misshapen, {})).rejects.toThrow(JevUnavailableError);
    expect(await failuresFor(misshapen.id)).toMatchObject([{ kind: "bad_shape" }]);
  });

  it("does not store a domain, an email or quoted input that the provider echoed", async () => {
    const asking = question();
    Reflect.set(env, "AI", {
      run: vi.fn(() => Promise.reject(new Error('3010: bad input "allbirds.com" from me@acme.io at https://x.test/p'))),
    });

    await expect(askNoul("ws-failure-log", asking, {})).rejects.toThrow(JevUnavailableError);

    const [row] = (await failuresFor(asking.id)) as { message: string }[];
    expect(row?.message).not.toMatch(/allbirds|acme|x\.test/);
    expect(row?.message).toContain("3010");
  });

  it("deletes rows older than 30 days and keeps newer ones", async () => {
    const now = new Date("2026-10-04T03:00:00.000Z");
    const old = new Date(now.getTime() - RETENTION_MS - 1000).toISOString();
    const fresh = new Date(now.getTime() - RETENTION_MS + 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO jev_failure (id, question, kind, code, message, occurred_at) VALUES ('old-row', 'q', 'other', NULL, 'm', ?1)",
      ).bind(old),
      env.DB.prepare(
        "INSERT INTO jev_failure (id, question, kind, code, message, occurred_at) VALUES ('fresh-row', 'q', 'other', NULL, 'm', ?1)",
      ).bind(fresh),
    ]);

    const deleted = await deleteExpiredJevFailures(env.DB, now);

    expect(deleted).toBeGreaterThanOrEqual(1);
    const { results } = await env.DB.prepare("SELECT id FROM jev_failure WHERE id IN ('old-row', 'fresh-row')").all();
    expect(results).toEqual([{ id: "fresh-row" }]);
  });

  it("still raises the Jev error when the failure cannot be written", async () => {
    const asking = question();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("Network connection lost"))) });
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
      if (sql.startsWith("INSERT INTO jev_failure")) {
        throw new Error("D1 unavailable");
      }
      return prepare(sql);
    });

    try {
      await expect(askNoul("ws-failure-log", asking, {})).rejects.toThrow(JevUnavailableError);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
