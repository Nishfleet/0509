import { env } from "cloudflare:workers";
import { z } from "zod";

import { readCachedChoice, readCachedNoul } from "../data/jev_verdict.server";

const MODEL = "typesafe/jev";

const GATEWAY_ID = "default";

export interface NoulQuestion {
  id: string;
  instructions: string;
  whenTrue: string;
  whenFalse: string;
}

export interface NoulVerdict {
  questionId: string;
  inputHash: string;
  p: number;
  cached: boolean;
}

export interface ChoiceQuestion {
  id: string;
  instructions: string;
  options: Readonly<Record<string, string>>;
}

export interface ChoiceVerdict {
  questionId: string;
  inputHash: string;
  choice: string;
  cached: boolean;
}

const answerSchema = z.object({
  answers: z.record(z.string(), z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) })),
});

const choiceAnswerSchema = z.object({
  answers: z.record(z.string(), z.object({ type: z.literal("choice"), choice: z.string() })),
});

export class JevUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`jev unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "JevUnavailableError";
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inputHash(workspaceId: string, question: NoulQuestion, state: unknown): Promise<string> {
  return sha256Hex(
    JSON.stringify({ workspace: workspaceId, question: question.id, instructions: question.instructions, state }),
  );
}

async function run(question: NoulQuestion, state: unknown): Promise<number> {
  let raw: unknown;
  try {
    raw = await env.AI.run(
      MODEL,
      {
        state,
        questions: {
          [question.id]: {
            type: "noul",
            instructions: question.instructions,
            criteria: { true: question.whenTrue, false: question.whenFalse },
          },
        },
      },
      { gateway: { id: GATEWAY_ID } },
    );
  } catch (error) {
    throw new JevUnavailableError(error);
  }
  const parsed = answerSchema.safeParse(raw);
  const answer = parsed.success ? parsed.data.answers[question.id] : undefined;
  if (answer === undefined) throw new JevUnavailableError(new Error("answer missing its noul"));
  return answer.noul;
}

export async function askNoul(workspaceId: string, question: NoulQuestion, state: unknown): Promise<NoulVerdict> {
  const hash = await inputHash(workspaceId, question, state);
  const cached = await readCachedNoul(question.id, hash);
  if (cached !== null) return { questionId: question.id, inputHash: hash, p: cached, cached: true };
  const p = await run(question, state);
  return { questionId: question.id, inputHash: hash, p, cached: false };
}

async function runChoice(question: ChoiceQuestion, state: unknown): Promise<string> {
  let raw: unknown;
  try {
    raw = await env.AI.run(
      MODEL,
      {
        state,
        questions: {
          [question.id]: {
            type: "choice",
            instructions: question.instructions,
            criteria: question.options,
          },
        },
      },
      { gateway: { id: GATEWAY_ID } },
    );
  } catch (error) {
    throw new JevUnavailableError(error);
  }
  const parsed = choiceAnswerSchema.safeParse(raw);
  const answer = parsed.success ? parsed.data.answers[question.id] : undefined;
  if (answer === undefined || !Object.keys(question.options).includes(answer.choice)) {
    throw new JevUnavailableError(new Error("answer missing its choice"));
  }
  return answer.choice;
}

export async function askChoice(
  workspaceId: string,
  question: ChoiceQuestion,
  state: unknown,
): Promise<ChoiceVerdict> {
  const hash = await sha256Hex(
    JSON.stringify({
      workspace: workspaceId,
      question: question.id,
      instructions: question.instructions,
      options: question.options,
      state,
    }),
  );
  const cached = await readCachedChoice(question.id, hash);
  if (cached !== null) return { questionId: question.id, inputHash: hash, choice: cached, cached: true };
  const choice = await runChoice(question, state);
  return { questionId: question.id, inputHash: hash, choice, cached: false };
}
