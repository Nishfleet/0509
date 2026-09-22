import { z } from "zod";

const JevAnswer = z.object({
  type: z.string().optional(),
  probability: z.number().optional(),
  choice: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  score: z.number().optional(),
  reason: z.string().optional(),
});
type JevAnswer = z.infer<typeof JevAnswer>;

const JevResponse = z.object({
  answers: z.record(z.string(), JevAnswer),
});

export type JevQuestion =
  | { type: "boolean"; instructions: string }
  | { type: "score"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export type JevResult =
  | { ok: true; answers: Record<string, JevAnswer>; ms: number }
  | { ok: false; reason: string; ms: number };

export function jevConfig(env: {
  JEV_URL?: string;
  JEV_API_KEY?: string;
}): { url: string; apiKey?: string } | undefined {
  return env.JEV_URL ? { url: env.JEV_URL, apiKey: env.JEV_API_KEY } : undefined;
}

export async function jevAsk(
  config: { url: string; apiKey?: string },
  state: unknown,
  questions: Record<string, JevQuestion>,
  timeoutMs = 8_000,
): Promise<JevResult> {
  const started = Date.now();
  try {
    const res = await fetch(config.url, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ state, questions }),
    });
    if (!res.ok) return { ok: false, reason: `jev-http-${String(res.status)}`, ms: Date.now() - started };
    const parsed = JevResponse.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: "jev-bad-shape", ms: Date.now() - started };
    return { ok: true, answers: parsed.data.answers, ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.name : "jev-unreachable",
      ms: Date.now() - started,
    };
  }
}
