/**
 * AI weekly strategy paragraph for weekly digests.
 *
 * Strictly additive: this module NEVER throws and returns null on any doubt.
 * The paragraph is generated once per digest run, persisted in
 * `digest_run.summary_json` before delivery, and reused verbatim on retries —
 * never regenerated (nondeterministic customer-visible content).
 */

import { readDigestIntelligence } from "~/lib/change-intelligence";
import { DIGEST_STRATEGY_MODEL } from "~/lib/digest-strategy";
import type { AppEnv } from "~/lib/env.server";
import { isDigestDecisionCandidate } from "~/lib/proof-classification";

export interface DigestStrategyItemInput {
  watchlistName: string;
  title: string;
  summary: string;
  metadata?: Record<string, unknown>;
  proofStatus?: string;
}

export interface BuildWeeklyStrategyParagraphInput {
  items: DigestStrategyItemInput[];
  totalChanges: number;
  watchlistCount: number;
  periodStart: string;
  periodEnd: string;
}

// Mirrors MAX_TRANSLATION_INPUT_LENGTH in translation.server.ts.
const MAX_STRATEGY_INPUT_LENGTH = 1600;
const MAX_STRATEGY_ITEMS = 6;
const MAX_LINE_LENGTH = 300;
const MIN_PARAGRAPH_LENGTH = 80;
const MAX_PARAGRAPH_LENGTH = 600;
const MAX_OUTPUT_TOKENS = 200;

const SYSTEM_PROMPT =
  "You summarize competitor ad and landing-page changes for a marketing team. " +
  "Restate only the provided change lines as 2 to 4 plain sentences describing what these competitors did this week. " +
  "Use plain prose only: no markdown, no bullet points, no headings, no lists. " +
  "Never invent numbers, competitors, or claims that are not in the lines.";

const MARKDOWN_LIKE_OUTPUT =
  /(^|\n)\s*(?:[-*+•]\s|#{1,6}\s|\d+[.)]\s|>\s)|[`|]|\*\*/;

// Fragments of the instructions above; a compliant summary has no reason to
// contain any of them, so their presence means the model echoed the prompt.
const PROMPT_ECHO_FRAGMENTS = [
  "restate only",
  "provided change lines",
  "change lines:",
  "plain sentences",
  "no markdown",
  "bullet points",
  "you summarize",
  "as an ai",
  "marketing team.",
];

export async function buildWeeklyStrategyParagraph(
  env: Pick<AppEnv, "AI">,
  input: BuildWeeklyStrategyParagraphInput,
): Promise<string | null> {
  if (!env.AI) {
    return null;
  }

  const lines = buildStrategyInputLines(input.items);
  if (lines.length === 0) {
    return null;
  }

  try {
    const response = await env.AI.run(DIGEST_STRATEGY_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `This week (${input.periodStart.slice(0, 10)} to ${input.periodEnd.slice(0, 10)}) monitoring logged ${input.totalChanges} change${input.totalChanges === 1 ? "" : "s"} across ${input.watchlistCount} watchlist${input.watchlistCount === 1 ? "" : "s"}.`,
            "Change lines:",
            ...lines,
          ].join("\n"),
        },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
    });
    const raw =
      typeof response === "string"
        ? response
        : typeof (response as { response?: unknown }).response === "string"
          ? ((response as { response: string }).response)
          : "";
    return validateStrategyParagraph(raw, lines);
  } catch {
    return null;
  }
}

/**
 * Ranks digest items with the same priority signals the digest email uses
 * (decision candidates first, then priority score), takes the top few, and
 * renders one compact line per item capped to a total input budget.
 */
export function buildStrategyInputLines(items: DigestStrategyItemInput[]) {
  const ranked = items
    .map((item, index) => ({
      item,
      index,
      isCandidate: isDigestDecisionCandidate(item),
      priorityScore: readDigestIntelligence(item.metadata).priorityScore ?? -1,
    }))
    .sort(
      (a, b) =>
        Number(b.isCandidate) - Number(a.isCandidate) ||
        b.priorityScore - a.priorityScore ||
        a.index - b.index,
    )
    .slice(0, MAX_STRATEGY_ITEMS);

  const lines: string[] = [];
  let totalLength = 0;
  for (const entry of ranked) {
    const line = formatStrategyLine(entry.item);
    if (!line) {
      continue;
    }
    if (totalLength + line.length > MAX_STRATEGY_INPUT_LENGTH) {
      break;
    }
    lines.push(line);
    totalLength += line.length;
  }
  return lines;
}

function formatStrategyLine(item: DigestStrategyItemInput) {
  const watchlistName = collapseWhitespace(item.watchlistName);
  const title = collapseWhitespace(item.title);
  const summary = collapseWhitespace(item.summary);
  if (!watchlistName && !title && !summary) {
    return null;
  }
  const detail = [title, summary].filter(Boolean).join(" — ");
  const line = watchlistName ? `- ${watchlistName}: ${detail}` : `- ${detail}`;
  return line.slice(0, MAX_LINE_LENGTH);
}

/**
 * Accepts only output that looks like a short plain-prose paragraph honestly
 * derived from the provided lines. Any doubt returns null; absence is silent.
 */
export function validateStrategyParagraph(
  raw: string,
  inputLines: string[],
): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // Bullet lists, headings, tables, or code fences mean the model ignored
  // the plain-prose instruction — reject rather than repair.
  if (MARKDOWN_LIKE_OUTPUT.test(trimmed)) {
    return null;
  }

  // A paragraph is at most a couple of soft wraps; more newlines than that
  // reads as list-shaped output even without markers.
  if ((trimmed.match(/\n/g) ?? []).length > 2) {
    return null;
  }

  const paragraph = collapseWhitespace(trimmed);
  if (
    paragraph.length < MIN_PARAGRAPH_LENGTH ||
    paragraph.length > MAX_PARAGRAPH_LENGTH
  ) {
    return null;
  }

  const lowered = paragraph.toLowerCase();
  if (PROMPT_ECHO_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    return null;
  }
  // Echoing an input line verbatim (with its "- " marker stripped by the
  // whitespace collapse) is not synthesis either.
  if (inputLines.some((line) => {
    const bare = collapseWhitespace(line.replace(/^-\s*/, ""));
    return bare.length >= 40 && lowered.includes(bare.toLowerCase());
  })) {
    return null;
  }

  return paragraph;
}

function collapseWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
