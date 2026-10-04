import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askNoul, askNouls, JevUnavailableError } from "../../../app/lib/jev/client.server";
import type { NoulQuestion } from "../../../app/lib/jev/client.server";

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
  const { results } = await env.DB.prepare(
    "SELECT question_id, kind, code, message FROM jev_failure WHERE question_id = ?1",
  )
    .bind(questionId)
    .all();
  return results;
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
      { question_id: asking.id, kind: "rate_limited", code: "2003", message: "2003: Rate limited" },
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
