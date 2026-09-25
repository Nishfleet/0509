import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askNoul, askNouls, JevUnavailableError } from "../../../app/lib/jev/client.server";
import { insertVerdict } from "../../../app/lib/data/jev_verdict.server";
import type { NoulQuestion } from "../../../app/lib/jev/client.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-jev-noul-batch-${String(runs)}`;
  const workspaceId = `ws-jev-noul-batch-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
  ]);
  return workspaceId;
}

const NAME_QUESTION: NoulQuestion = {
  id: "identity_name",
  instructions: "Is this extracted name the brand's own name?",
  whenTrue: "the page presents it as the brand name",
  whenFalse: "the page presents it as something else",
};

const CATEGORY_QUESTION: NoulQuestion = {
  id: "identity_category",
  instructions: "Is the category right for this brand?",
  whenTrue: "the evidence supports the category",
  whenFalse: "the evidence points somewhere else",
};

const COUNTRY_QUESTION: NoulQuestion = {
  id: "identity_country",
  instructions: "Is the country right for this brand?",
  whenTrue: "the evidence names this country as its base",
  whenFalse: "the evidence names another country",
};

const questions: readonly NoulQuestion[] = [NAME_QUESTION, CATEGORY_QUESTION, COUNTRY_QUESTION];

const state = { subject: { name: "Gymshark", domain: "gymshark.com" } };

function allFreshAnswers(): { answers: Record<string, { type: "boolean"; probability: number }> } {
  return {
    answers: {
      identity_name: { type: "boolean", probability: 0.93 },
      identity_category: { type: "boolean", probability: 0.42 },
      identity_country: { type: "boolean", probability: 0.05 },
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("askNouls", () => {
  it("asks Jev once for every uncached noul question and returns verdicts in order", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.resolve(allFreshAnswers()));
    Reflect.set(env, "AI", { run });

    const verdicts = await askNouls(workspaceId, questions, state);

    expect(verdicts.map((verdict) => verdict.questionId)).toEqual([
      "identity_name",
      "identity_category",
      "identity_country",
    ]);
    expect(verdicts.map((verdict) => verdict.p)).toEqual([0.93, 0.42, 0.05]);
    expect(verdicts.map((verdict) => verdict.cached)).toEqual([false, false, false]);
    expect(verdicts[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("typesafe/jev");
    expect(run.mock.calls[0]?.[2]).toEqual({ gateway: { id: "default" } });
    const request = run.mock.calls[0]?.[1] as {
      questions: Record<string, { type: string; instructions: string; criteria: unknown }>;
    };
    expect(Object.keys(request.questions)).toEqual(["identity_name", "identity_category", "identity_country"]);
    expect(request.questions.identity_name).toEqual({
      type: "boolean",
      instructions: questions[0]?.instructions,
      criteria: { true: questions[0]?.whenTrue, false: questions[0]?.whenFalse },
    });
    expect(request.questions.identity_category?.type).toBe("boolean");
    expect(request.questions.identity_country?.type).toBe("boolean");
  });

  it("reuses a cached verdict and asks Jev only about the uncached questions", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.resolve(allFreshAnswers()));
    Reflect.set(env, "AI", { run });

    const seeded = await askNoul(workspaceId, CATEGORY_QUESTION, state);
    await env.DB.batch([
      insertVerdict({
        workspaceId,
        questionId: seeded.questionId,
        inputHash: seeded.inputHash,
        signalId: null,
        entityId: null,
        p: 0.88,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }),
    ]);
    run.mockClear();
    run.mockImplementation(() =>
      Promise.resolve({
        answers: {
          identity_name: { type: "boolean", probability: 0.93 },
          identity_country: { type: "boolean", probability: 0.05 },
        },
      }),
    );

    const verdicts = await askNouls(workspaceId, questions, state);

    expect(run).toHaveBeenCalledTimes(1);
    const request = run.mock.calls[0]?.[1] as { questions: Record<string, unknown> };
    expect(Object.keys(request.questions)).toEqual(["identity_name", "identity_country"]);
    expect(verdicts.map((verdict) => verdict.questionId)).toEqual([
      "identity_name",
      "identity_category",
      "identity_country",
    ]);
    expect(verdicts.map((verdict) => verdict.cached)).toEqual([false, true, false]);
    expect(verdicts[1]?.p).toBe(0.88);
    expect(verdicts[1]?.inputHash).toBe(seeded.inputHash);
  });

  it("asks Jev nothing when every question is cached", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.resolve(allFreshAnswers()));
    Reflect.set(env, "AI", { run });

    const seeded = await Promise.all(
      questions.map((question) => askNoul(workspaceId, question, state)),
    );
    await env.DB.batch(
      seeded.map((verdict, index) =>
        insertVerdict({
          workspaceId,
          questionId: verdict.questionId,
          inputHash: verdict.inputHash,
          signalId: null,
          entityId: null,
          p: [0.91, 0.35, 0.07][index] ?? 0.5,
          choice: null,
          reason: null,
          decidedAt: NOW,
        }),
      ),
    );
    run.mockClear();

    const verdicts = await askNouls(workspaceId, questions, state);

    expect(run).not.toHaveBeenCalled();
    expect(verdicts.map((verdict) => verdict.cached)).toEqual([true, true, true]);
    expect(verdicts.map((verdict) => verdict.p)).toEqual([0.91, 0.35, 0.07]);
  });

  it("throws JevUnavailableError when an asked question is missing from the answers", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() =>
      Promise.resolve({
        answers: {
          identity_name: { type: "boolean", probability: 0.93 },
          identity_country: { type: "boolean", probability: 0.05 },
        },
      }),
    );
    Reflect.set(env, "AI", { run });

    await expect(askNouls(workspaceId, questions, state)).rejects.toThrow(JevUnavailableError);
  });
});
