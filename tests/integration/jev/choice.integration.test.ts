import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askChoice, JevUnavailableError } from "../../../app/lib/jev/client.server";
import { insertVerdict } from "../../../app/lib/data/jev_verdict.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-jev-choice-${String(runs)}`;
  const workspaceId = `ws-jev-choice-${String(runs)}`;
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

const question = {
  id: "activity",
  instructions: "Is this competitor active or dormant?",
  options: { active: "shipped something in the last 90 days", dormant: "no visible activity for months" },
} as const;

const state = { subject: { name: "Gymshark", domain: "gymshark.com" } };

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("askChoice", () => {
  it("asks Jev once, sends a choice question with the options as criteria, and returns the uncached choice", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.resolve({ answers: { activity: { type: "choice", choice: "dormant" } } }));
    Reflect.set(env, "AI", { run });

    const verdict = await askChoice(workspaceId, question, state);

    expect(verdict).toMatchObject({ questionId: "activity", choice: "dormant", cached: false });
    expect(verdict.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("typesafe/jev");
    const request = run.mock.calls[0]?.[1] as { questions: { activity: { type: string; criteria: unknown } } };
    expect(request.questions.activity.type).toBe("choice");
    expect(request.questions.activity.criteria).toEqual(question.options);
  });

  it("reuses a stored verdict for the same input and does not ask again", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.resolve({ answers: { activity: { type: "choice", choice: "dormant" } } }));
    Reflect.set(env, "AI", { run });

    const first = await askChoice(workspaceId, question, state);
    await env.DB.batch([
      insertVerdict({
        workspaceId,
        questionId: first.questionId,
        inputHash: first.inputHash,
        signalId: null,
        entityId: null,
        p: null,
        choice: first.choice,
        reason: null,
        decidedAt: NOW,
      }),
    ]);

    const second = await askChoice(workspaceId, question, state);

    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ questionId: "activity", inputHash: first.inputHash, choice: "dormant", cached: true });
  });

  it("throws JevUnavailableError when the answer's choice is not one of the options", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.resolve({ answers: { activity: { type: "choice", choice: "exploded" } } }));
    Reflect.set(env, "AI", { run });

    await expect(askChoice(workspaceId, question, state)).rejects.toThrow(JevUnavailableError);
  });

  it("throws JevUnavailableError when Jev refuses", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.reject(new Error("Insufficient balance; add money to your gateway")));
    Reflect.set(env, "AI", { run });

    await expect(askChoice(workspaceId, question, state)).rejects.toThrow(JevUnavailableError);
  });
});
