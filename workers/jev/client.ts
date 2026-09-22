import { TypeSafeClient, noul, type JsonValue } from "@typesafe-ai/sdk";

import { QUESTION_INSTRUCTIONS, type ContextPack, type QuestionId } from "./context-pack";

export async function askNoul(
  apiKey: string,
  pack: ContextPack,
  questionId: QuestionId,
): Promise<number> {
  const client = new TypeSafeClient({
    apiKey,
    logLevel: "off",
    retry: { maxRetries: 0 },
    timeout: 30_000,
  });
  const state = JSON.parse(JSON.stringify(pack)) as Record<string, JsonValue>;
  const response = await client.systemOne({
    state,
    questions: { [questionId]: noul(QUESTION_INSTRUCTIONS[questionId]) },
  });
  const answers: Record<string, { type?: string; noul?: number }> = response.answers;
  const answer = answers[questionId];
  if (answer?.type !== "noul" || typeof answer?.noul !== "number") {
    throw new Error(`Jev returned no probability for ${questionId}`);
  }
  if (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
    throw new Error(`Jev probability for ${questionId} is outside 0..1`);
  }
  return answer.noul;
}
