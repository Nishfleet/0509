import { captureException } from "@sentry/cloudflare";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { readCachedChoice, readCachedNoul } from "../data/jev_verdict.server";
import { sha256Hex } from "../sha256";
import { isBillingRefusal } from "./refusal";
import type { NoulQuestion } from "./thresholds";

export type { NoulQuestion };

const MODEL = "@cf/cloudflare/clef";

const MODEL_SELECTOR = "clef";

export const GATEWAY_ID = "default";

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

const noulType = z.literal("noul");

interface NoulAsk {
  type: z.infer<typeof noulType>;
  instructions: string;
  criteria: { true: string; false: string };
}

const answerSchema = z.object({
  answers: z.record(z.string(), z.object({ type: noulType, noul: z.number().min(0).max(1) })),
});

type NoulAnswers = z.infer<typeof answerSchema>["answers"];

const choiceAnswerSchema = z.object({
  answers: z.record(z.string(), z.object({ type: z.literal("choice"), choice: z.string() })),
});

export class JevUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`jev unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "JevUnavailableError";
  }
}

export class JevRateLimitedError extends JevUnavailableError {
  constructor(cause: unknown) {
    super(cause);
    this.name = "JevRateLimitedError";
  }
}

const RATE_LIMITED = /(^|\D)2003(\D|$)/;

function unavailable(error: unknown): JevUnavailableError {
  const failure = new JevUnavailableError(error);
  if (isBillingRefusal(failure)) {
    captureException(new Error("jev refused: Workers AI quota, AI Gateway credits or payment"), {
      level: "error",
      fingerprint: ["jev-billing-refused"],
    });
    return failure;
  }
  return RATE_LIMITED.test(failure.message) ? new JevRateLimitedError(error) : failure;
}

function jevBody(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const response: unknown = Reflect.get(raw, "response");
  if (typeof response === "string") {
    try {
      return JSON.parse(response);
    } catch {
      return raw;
    }
  }
  if (typeof response === "object" && response !== null) return response;
  const result: unknown = Reflect.get(raw, "result");
  if (typeof result === "object" && result !== null) return result;
  return raw;
}

interface ParseIssue {
  path: readonly PropertyKey[];
  code: string;
}

function shapeOf(raw: unknown, issues: readonly ParseIssue[]): string {
  const keys = typeof raw === "object" && raw !== null ? Object.keys(raw).slice(0, 20).join(",") : typeof raw;
  const paths = issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join(".")}:${issue.code}`)
    .join(" ");
  return `keys=${keys}; issues=${paths}`;
}

function missing(what: string, raw: unknown, issues: readonly ParseIssue[]): JevUnavailableError {
  return new JevUnavailableError(new Error(`answer missing its ${what}; ${shapeOf(raw, issues)}`));
}

function inputHash(workspaceId: string, question: NoulQuestion, state: unknown): Promise<string> {
  return sha256Hex(
    JSON.stringify({ workspace: workspaceId, question: question.id, instructions: question.instructions, state }),
  );
}

function noulAsk(question: NoulQuestion): NoulAsk {
  return {
    type: "noul",
    instructions: question.instructions,
    criteria: { true: question.whenTrue, false: question.whenFalse },
  };
}

function decide(state: unknown, questions: Record<string, unknown>): Promise<unknown> {
  return env.AI.run(MODEL, { model: MODEL_SELECTOR, state, questions }, { gateway: { id: GATEWAY_ID } });
}

async function run(question: NoulQuestion, state: unknown): Promise<number> {
  const asked = noulAsk(question);
  let raw: unknown;
  try {
    raw = await decide(state, { [question.id]: asked });
  } catch (error) {
    throw unavailable(error);
  }
  const parsed = answerSchema.safeParse(jevBody(raw));
  const answer = parsed.success ? parsed.data.answers[question.id] : undefined;
  if (answer === undefined) throw missing("noul", raw, parsed.error?.issues ?? []);
  return answer.noul;
}

const PROBE_QUESTION: NoulQuestion = {
  id: "jev_probe",
  instructions: "Is the item the number five?",
  whenTrue: "The item is the number five.",
  whenFalse: "The item is not the number five.",
};

export async function probeJev(): Promise<void> {
  await run(PROBE_QUESTION, { item: 5 });
}

export async function askNoul(workspaceId: string, question: NoulQuestion, state: unknown): Promise<NoulVerdict> {
  const hash = await inputHash(workspaceId, question, state);
  const cached = await readCachedNoul(question.id, hash);
  if (cached !== null) return { questionId: question.id, inputHash: hash, p: cached, cached: true };
  const p = await run(question, state);
  return { questionId: question.id, inputHash: hash, p, cached: false };
}

export async function askNouls(
  workspaceId: string,
  questions: readonly NoulQuestion[],
  state: unknown,
): Promise<NoulVerdict[]> {
  const entries = await Promise.all(
    questions.map(async (question) => {
      const hash = await inputHash(workspaceId, question, state);
      const cached = await readCachedNoul(question.id, hash);
      return { question, hash, cached };
    }),
  );
  const pending = entries.filter((entry) => entry.cached === null);
  let answers: NoulAnswers = {};
  let unparsed: { raw: unknown; issues: readonly ParseIssue[] } = { raw: undefined, issues: [] };
  if (pending.length > 0) {
    const asked = Object.fromEntries(pending.map((entry) => [entry.question.id, noulAsk(entry.question)]));
    let raw: unknown;
    try {
      raw = await decide(state, asked);
    } catch (error) {
      throw unavailable(error);
    }
    const parsed = answerSchema.safeParse(jevBody(raw));
    if (parsed.success) answers = parsed.data.answers;
    unparsed = { raw, issues: parsed.error?.issues ?? [] };
  }
  return entries.map((entry) => {
    if (entry.cached !== null) {
      return { questionId: entry.question.id, inputHash: entry.hash, p: entry.cached, cached: true };
    }
    const fresh = answers[entry.question.id]?.noul;
    if (fresh === undefined) throw missing("noul", unparsed.raw, unparsed.issues);
    return { questionId: entry.question.id, inputHash: entry.hash, p: fresh, cached: false };
  });
}

async function runChoice(question: ChoiceQuestion, state: unknown): Promise<string> {
  let raw: unknown;
  try {
    raw = await decide(state, {
      [question.id]: { type: "choice", instructions: question.instructions, criteria: question.options },
    });
  } catch (error) {
    throw unavailable(error);
  }
  const parsed = choiceAnswerSchema.safeParse(jevBody(raw));
  const answer = parsed.success ? parsed.data.answers[question.id] : undefined;
  if (answer === undefined || !Object.keys(question.options).includes(answer.choice)) {
    throw missing("choice", raw, parsed.error?.issues ?? []);
  }
  return answer.choice;
}

export async function askChoice(workspaceId: string, question: ChoiceQuestion, state: unknown): Promise<ChoiceVerdict> {
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
