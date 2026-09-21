/**
 * Jev, through the Vercel AI Gateway evaluation-model endpoint — the same
 * upstream the fleet LiteLLM pass-through at 127.0.0.1:4000/jev forwards to
 * (fleet-ops config/litellm-proxy.yaml). Request shape probed live
 * 2026-09-22: boolean answers carry { probability }, choice answers carry
 * { choice, probabilities }, and a choice question requires `criteria` —
 * a record of option -> description.
 *
 * A missing JEV_API_KEY returns null and callers mark the item unreviewed;
 * an HTTP or network failure throws so the Workflow step retries it.
 */
const JEV_EVALUATION_URL =
  "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";

export type JevQuestion =
  | { type: "boolean"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export interface JevAnswer {
  probability?: number;
  choice?: string;
  probabilities?: Record<string, number>;
}

export interface JevEnv {
  JEV_API_BASE?: string;
  JEV_API_KEY?: string;
}

export async function jevDecide(
  env: JevEnv,
  state: Record<string, unknown>,
  questions: Record<string, JevQuestion>,
): Promise<Record<string, JevAnswer>> {
  if (!env.JEV_API_KEY) return {};
  const res = await fetch(env.JEV_API_BASE ?? JEV_EVALUATION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.JEV_API_KEY}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-evaluation-model-specification-version": "4",
      "ai-model-id": "typesafe-ai/jev",
    },
    body: JSON.stringify({ state, questions }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(`jev evaluation HTTP ${String(res.status)}`);
  const body: { answers?: Record<string, JevAnswer> } = await res.json();
  return body.answers ?? {};
}
