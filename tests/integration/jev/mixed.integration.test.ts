import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askChoice, askMixed, askNoul, JevUnavailableError } from "../../../app/lib/jev/client.server";
import { insertVerdict } from "../../../app/lib/data/jev_verdict.server";
import type { MixedQuestions } from "../../../app/lib/jev/client.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-jev-mixed-${String(runs)}`;
  const workspaceId = `ws-jev-mixed-${String(runs)}`;
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

const questions: MixedQuestions = {
  noul: {
    id: "still_competitor",
    instructions: "Is this brand still a competitor to us?",
    whenTrue: "it still competes for the same audience",
    whenFalse: "it stopped competing",
  },
  choice: {
    id: "still_competitor_reason",
    instructions: "Which of these describes the change?",
    options: { pricing: "they changed prices", scope: "they widened or narrowed scope" },
  },
};

const state = { subject: { name: "Gymshark", domain: "gymshark.com" } };

function bothAnswers(): {
  answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }>;
} {
  return {
    answers: {
      still_competitor: { type: "noul", noul: 0.91 },
      still_competitor_reason: { type: "choice", choice: "pricing" },
    },
  };
}

function answersForAsking(
  _model: string,
  request: { questions: Record<string, { type: string }> },
): Promise<{ answers: Record<string, unknown> }> {
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    answers[id] =
      question.type === "noul"
        ? { type: "noul", noul: id === "still_competitor" ? 0.91 : 0.5 }
        : { type: "choice", choice: id === "still_competitor_reason" ? "pricing" : "scope" };
  }
  return Promise.resolve({ answers });
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("askMixed", () => {
  it("asks Jev once with both questions and returns the typed noul and choice", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn((_model: string, _request: unknown, _options?: unknown) => Promise.resolve(bothAnswers()));
    Reflect.set(env, "AI", { run });

    const verdict = await askMixed(workspaceId, questions, state);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("@cf/cloudflare/clef");
    const request = run.mock.calls[0]?.[1] as {
      questions: Record<string, { type: string; instructions: string; criteria: unknown }>;
    };
    expect(Object.keys(request.questions)).toEqual(["still_competitor", "still_competitor_reason"]);
    expect(request.questions.still_competitor.type).toBe("noul");
    expect(request.questions.still_competitor.criteria).toEqual({
      true: questions.noul.whenTrue,
      false: questions.noul.whenFalse,
    });
    expect(request.questions.still_competitor_reason.type).toBe("choice");
    expect(request.questions.still_competitor_reason.criteria).toEqual(questions.choice.options);
    expect(verdict.noul).toMatchObject({ questionId: "still_competitor", p: 0.91, cached: false });
    expect(verdict.choice).toMatchObject({ questionId: "still_competitor_reason", choice: "pricing", cached: false });
    expect(verdict.noul.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verdict.choice.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes each question exactly as the single-question askers do, so the D1 verdict cache is shared", async () => {
    const workspaceId = await seedWorkspace();
    Reflect.set(env, "AI", { run: vi.fn(answersForAsking) });

    const mixed = await askMixed(workspaceId, questions, state);
    const noul = await askNoul(workspaceId, questions.noul, state);
    const choice = await askChoice(workspaceId, questions.choice, state);

    expect(mixed.noul.inputHash).toBe(noul.inputHash);
    expect(mixed.choice.inputHash).toBe(choice.inputHash);
  });

  it("asks only the uncached question when the D1 cache holds the noul verdict", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(answersForAsking);
    Reflect.set(env, "AI", { run });
    const seeded = await askNoul(workspaceId, questions.noul, state);
    await env.DB.batch([
      insertVerdict({
        workspaceId,
        questionId: seeded.questionId,
        inputHash: seeded.inputHash,
        signalId: null,
        entityId: null,
        p: 0.64,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }),
    ]);
    run.mockClear();

    const verdict = await askMixed(workspaceId, questions, state);

    expect(run).toHaveBeenCalledTimes(1);
    const request = run.mock.calls[0]?.[1] as { questions: Record<string, unknown> };
    expect(Object.keys(request.questions)).toEqual(["still_competitor_reason"]);
    expect(verdict.noul).toMatchObject({ p: 0.64, cached: true, inputHash: seeded.inputHash });
    expect(verdict.choice).toMatchObject({ choice: "pricing", cached: false });
  });

  it("asks Jev nothing when the D1 cache holds both verdicts", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn((_model: string, _request: unknown, _options?: unknown) => Promise.resolve(bothAnswers()));
    Reflect.set(env, "AI", { run });
    const first = await askMixed(workspaceId, questions, state);
    await env.DB.batch([
      insertVerdict({
        workspaceId,
        questionId: first.noul.questionId,
        inputHash: first.noul.inputHash,
        signalId: null,
        entityId: null,
        p: first.noul.p,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }),
      insertVerdict({
        workspaceId,
        questionId: first.choice.questionId,
        inputHash: first.choice.inputHash,
        signalId: null,
        entityId: null,
        p: null,
        choice: first.choice.choice,
        reason: null,
        decidedAt: NOW,
      }),
    ]);
    run.mockClear();

    const second = await askMixed(workspaceId, questions, state);

    expect(run).not.toHaveBeenCalled();
    expect(second.noul).toMatchObject({ p: 0.91, cached: true });
    expect(second.choice).toMatchObject({ choice: "pricing", cached: true });
  });

  it("throws JevUnavailableError when the noul answer is missing from the reply", async () => {
    const workspaceId = await seedWorkspace();
    Reflect.set(env, "AI", {
      run: vi.fn(() =>
        Promise.resolve({ answers: { still_competitor_reason: { type: "choice", choice: "pricing" } } }),
      ),
    });

    const thrown = await askMixed(workspaceId, questions, state).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(JevUnavailableError);
    expect(String(thrown)).toContain("keys=answers");
  });

  it("throws JevUnavailableError when the choice is not one of the options", async () => {
    const workspaceId = await seedWorkspace();
    Reflect.set(env, "AI", {
      run: vi.fn(() =>
        Promise.resolve({
          answers: { ...bothAnswers().answers, still_competitor_reason: { type: "choice", choice: "exploded" } },
        }),
      ),
    });

    await expect(askMixed(workspaceId, questions, state)).rejects.toThrow(JevUnavailableError);
  });

  it("says which keys and issue paths came back, and no value, when the mixed answer does not parse", async () => {
    const workspaceId = await seedWorkspace();
    Reflect.set(env, "AI", {
      run: vi.fn(() => Promise.resolve({ response: "x" })),
    });

    const thrown = await askMixed(workspaceId, questions, state).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(JevUnavailableError);
    expect(String(thrown)).toContain("keys=response");
    expect(String(thrown)).toContain("issues=answers:invalid_type");
    expect(String(thrown)).not.toContain('"x"');
  });

  it("throws JevUnavailableError when Jev refuses", async () => {
    const workspaceId = await seedWorkspace();
    Reflect.set(env, "AI", {
      run: vi.fn(() => Promise.reject(new Error("Insufficient balance; add money to your gateway"))),
    });

    await expect(askMixed(workspaceId, questions, state)).rejects.toThrow(JevUnavailableError);
  });
});
