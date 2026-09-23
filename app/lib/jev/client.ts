import { z } from "zod";

export const JevQuestion = z.object({
  type: z.enum(["boolean", "choice", "score"]),
  instructions: z.string(),
  criteria: z.record(z.string(), z.string()).optional(),
});
export type JevQuestion = z.infer<typeof JevQuestion>;

export const JevAnswer = z.object({
  type: z.string().optional(),
  probability: z.number().optional(),
  choice: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  score: z.number().optional(),
  reason: z.string().optional(),
});
export type JevAnswer = z.infer<typeof JevAnswer>;

const JevResponse = z.object({
  answers: z.record(z.string(), JevAnswer),
});

export interface JevClientEnv {
  JEV_ENDPOINT?: string;
  JEV_KEY?: string;
  JEV_MODEL?: string;
}

const DEFAULT_MODEL = "typesafe-ai/jev";
const JEV_TIMEOUT_MS = 30_000;

export async function jevAsk(
  env: JevClientEnv,
  state: unknown,
  questions: Record<string, JevQuestion>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, JevAnswer> | null> {
  if (!env.JEV_ENDPOINT) return null;
  const model = env.JEV_MODEL ?? DEFAULT_MODEL;
  const res = await fetchImpl(env.JEV_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ai-gateway-protocol-version": "0.0.1",
      "ai-evaluation-model-specification-version": "4",
      "ai-model-id": model,
      ...(env.JEV_KEY ? { authorization: `Bearer ${env.JEV_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      state,
      questions,
    }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) return null;
  const parsed = JevResponse.safeParse(await res.json());
  return parsed.success ? parsed.data.answers : null;
}
