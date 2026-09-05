/**
 * Shared scaffold for the codebase's guarded Workers AI text generators
 * (search "what to steal", the competitor counter-brief, and the weekly digest
 * strategy paragraph). Each of those follows the same honesty contract:
 *
 * - wrap the untrusted competitor data in an explicit <<<DATA>>> envelope and
 *   tell the model to treat it as data, never instructions;
 * - sanitize every free-text field that flows into the prompt;
 * - run the model under a hard timeout and NEVER throw — null on any doubt;
 * - validate the output wholesale against the input corpus (digit grounding,
 *   prompt-echo rejection, capitalized-token grounding) before trusting it.
 *
 * This module owns the primitives; each caller keeps its own prompt, model,
 * gates, and output shape. Behavior must match the hand-rolled versions this
 * replaced — the per-caller tests are the contract.
 */

import type { AppEnv } from "~/lib/env.server";
import { promiseWithTimeout } from "~/lib/fetch-timeout.server";

const DATA_START = "<<<DATA>>>";
const DATA_END = "<<<END DATA>>>";

/** Collapse all whitespace runs to single spaces and trim the ends. */
export function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Prompt-injection hygiene for any free text that flows into a model prompt:
 * collapse whitespace and neutralize angle brackets so embedded markup cannot
 * pose as instructions. `maxLength`, when given, truncates the result.
 */
export function sanitizePromptText(
  value: string | null | undefined,
  options: { maxLength?: number } = {},
): string {
  const cleaned = collapseWhitespace(value)
    .replaceAll("<", "‹")
    .replaceAll(">", "›");
  return typeof options.maxLength === "number"
    ? cleaned.slice(0, options.maxLength)
    : cleaned;
}

/** Wrap already-prepared content lines in the untrusted-data envelope. */
export function buildDataEnvelope(contentLines: readonly string[]): string {
  return [DATA_START, ...contentLines, DATA_END].join("\n");
}

/** Extract the text payload from a Workers AI run result. */
function readAiResponseText(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }
  if (
    response &&
    typeof (response as { response?: unknown }).response === "string"
  ) {
    return (response as { response: string }).response;
  }
  return "";
}

export interface GuardedGenerationRequest {
  model: string;
  systemPrompt: string;
  /** Fully-assembled user message (usually a buildDataEnvelope result). */
  userContent: string;
  maxTokens: number;
  /** Hard cap in ms; callers own any clamping before passing it in. */
  timeoutMs: number;
  timeoutMessage: string;
}

/**
 * Bounded, never-throwing Workers AI text run. Returns the raw model text, or
 * null when AI is unavailable, the run times out, or the run throws. Callers
 * own validation of the returned text.
 */
export async function runGuardedGeneration(
  env: Pick<AppEnv, "AI">,
  request: GuardedGenerationRequest,
): Promise<string | null> {
  if (!env.AI) {
    return null;
  }
  try {
    const response = await promiseWithTimeout(
      env.AI.run(request.model, {
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userContent },
        ],
        max_tokens: request.maxTokens,
      }),
      request.timeoutMs,
      request.timeoutMessage,
    );
    return readAiResponseText(response);
  } catch {
    return null;
  }
}

/** True when any fragment appears in the (already-lowercased) text. */
export function containsPromptEcho(
  loweredText: string,
  fragments: readonly string[],
): boolean {
  return fragments.some((fragment) => loweredText.includes(fragment));
}

/**
 * Grounding: every digit run in the output must be justified by the corpus.
 * "substring" (default) accepts a run that appears anywhere in the corpus text;
 * "token" requires the run to exactly equal one of the corpus's digit runs.
 * The corpus is expected to already be lowercased (digits are case-agnostic).
 */
export function everyDigitRunGrounded(
  outputText: string,
  corpus: string,
  mode: "substring" | "token" = "substring",
): boolean {
  const runs = outputText.match(/\d+/g) ?? [];
  if (mode === "token") {
    const corpusRuns = new Set(corpus.match(/\d+/g) ?? []);
    return runs.every((run) => corpusRuns.has(run));
  }
  return runs.every((run) => corpus.includes(run));
}

/**
 * Grounding for candidate brand/product names: every capitalized token past a
 * string's first character must appear (case-insensitively) in the corpus. The
 * first token is exempt because sentence-initial capitalization is style, not a
 * factual claim. The corpus is expected to already be lowercased.
 */
export function everyCapitalizedTokenGrounded(
  text: string,
  corpus: string,
): boolean {
  for (const match of text.matchAll(/[A-Z][A-Za-z'’-]+/g)) {
    if (match.index === 0) {
      continue;
    }
    if (!corpus.includes(match[0].toLowerCase())) {
      return false;
    }
  }
  return true;
}
