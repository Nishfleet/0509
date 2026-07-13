/**
 * Shared (client-safe) helpers for the AI weekly strategy paragraph stored in
 * `digest_run.summary_json`. Generation lives in `digest-strategy.server.ts`;
 * this module only knows how to read a stored summary shape back out.
 */

export const DIGEST_STRATEGY_MODEL = "@cf/meta/llama-3.2-3b-instruct";

export interface DigestStrategyNote {
  paragraph: string;
  generatedAt: string | null;
}

/**
 * Reads a stored strategy paragraph out of a digest_run summary object.
 * Tolerates legacy summary shapes (missing keys, non-object values, arrays)
 * by returning null — absence is always silent.
 */
export function readDigestStrategyNote(
  summary: Record<string, unknown> | null | undefined,
): DigestStrategyNote | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return null;
  }

  const rawParagraph = summary.strategyParagraph;
  if (typeof rawParagraph !== "string") {
    return null;
  }

  const paragraph = rawParagraph.replace(/\s+/g, " ").trim();
  if (!paragraph) {
    return null;
  }

  const rawGeneratedAt = summary.strategyGeneratedAt;
  const generatedAt =
    typeof rawGeneratedAt === "string" && rawGeneratedAt.trim()
      ? rawGeneratedAt.trim()
      : null;

  return { paragraph, generatedAt };
}
