/**
 * Jev choice helpers for the crawler shadow measurement (issue #3618,
 * epic #3530), plus the live `env.AI.run("typesafe/jev", …)` wrapper the
 * crawlers will call once the epic's switch-on conditions are met.
 *
 * Pattern from browser-use/jev-ultrafast: code enumerates the candidates it
 * already knows about plus `stop`, Jev picks one, and we log its pick beside
 * the scripted one. Nothing here changes crawl behaviour — the wrapper is
 * observe-only and swallows every failure.
 *
 * This module currently has no production caller: the epic #3530 scope note
 * (2026-09-18) gates switch-on on two conditions (the fleet-ops#7754 row shape,
 * satisfied here, and the Cloudflare per-token price, read in the dashboard and
 * reported in the PR). The measurement CLI imports these functions, so the
 * helper is exercised by real runs and pinned by tests.
 */

/** Shared site name for every shadow row. */
export const CRAWLER_CHOICE_SITE = "crawler-choice";

/** Workers AI binding model id. */
export const CRAWLER_CHOICE_MODEL = "typesafe/jev";

/** Always appended to the candidate list. */
export const CRAWLER_CHOICE_STOP = "stop";

/** One action the crawler could take at this choice point. */
export interface CrawlerChoiceCandidate {
  /** Stable id the scripted branch would use (e.g. "scroll_pass"). */
  id: string;
  /** Short label Jev sees. */
  label: string;
  /** Optional extra context for Jev only. */
  detail?: string;
}

/** Minimal structural view of the Workers AI binding. */
export interface CrawlerChoiceAi {
  run(model: string, input: { state: unknown; questions: unknown }): Promise<unknown>;
}

/** What the crawler code itself decided, for the beside-comparison. */
export interface CrawlerChoiceScripted {
  id: string;
  reason?: string;
}

/** Bounded page context Jev sees. Never customer data. */
export interface CrawlerChoicePageState {
  url: string;
  title?: string;
  text?: string;
  candidates: readonly CrawlerChoiceCandidate[];
}

/** Input to one shadow decision. */
export interface CrawlerChoiceInput {
  choicePoint: string;
  page: CrawlerChoicePageState;
  scripted: CrawlerChoiceScripted;
  recent?: readonly string[];
  /** Traceability ref, e.g. Nishfleet/0509#3618. */
  ref?: string;
  correlationId?: string;
}

/** The row we log: fleet-helper shape plus crawler context. */
export interface CrawlerChoiceRow {
  ts: string;
  site: string;
  ref: string;
  state_sha256: string;
  answers: { action: { type: "choice"; choice: string } };
  probabilities: Record<string, number>;
  usage: { input_tokens: number; output_tokens: number };
  ms: number;
  choice_point: string;
  page_url: string;
  scripted: string;
  scripted_reason?: string;
  jev_choice: string;
  jev_confidence: number | null;
  agreed: boolean;
  candidates: string[];
  correlation_id?: string;
}

/** Parsed, validated Jev answer. */
export interface CrawlerChoiceDecision {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number | null;
}

/** Raised when the binding answers with something we cannot trust. */
export class CrawlerChoiceAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlerChoiceAnswerError";
  }
}

const MAX_CANDIDATES = 40;
const MAX_TEXT_CHARS = 4_000;

/** Candidate ids offered to Jev, `stop` last. */
export function crawlerChoiceOfferedIds(
  candidates: readonly CrawlerChoiceCandidate[],
): string[] {
  return [...candidates.slice(0, MAX_CANDIDATES).map((c) => c.id), CRAWLER_CHOICE_STOP];
}

/** Build the single choice question. One question per call keeps the shadow cheap. */
export function buildCrawlerChoiceQuestion(input: {
  choicePoint: string;
  page: CrawlerChoicePageState;
  scripted: CrawlerChoiceScripted;
  recent?: readonly string[];
}): { state: unknown; questions: Record<string, unknown> } {
  const candidates = input.page.candidates.slice(0, MAX_CANDIDATES);
  const criteria: Record<string, string> = {};
  for (const candidate of candidates) {
    criteria[candidate.id] = candidate.detail
      ? `${candidate.label} — ${candidate.detail}`
      : candidate.label;
  }
  criteria[CRAWLER_CHOICE_STOP] =
    "Stop crawling: nothing useful is left to reach, or continuing would repeat work already done.";

  return {
    state: {
      choice_point: input.choicePoint,
      page: {
        url: input.page.url,
        title: input.page.title ?? "",
        text: (input.page.text ?? "").slice(0, MAX_TEXT_CHARS),
      },
      scripted_choice: input.scripted.id,
      recent_scripted_choices: [...(input.recent ?? [])],
    },
    questions: {
      action: {
        type: "choice",
        instructions:
          `You are the decision step of a crawler at the "${input.choicePoint}" choice point. ` +
          "Pick the single next action that makes the most progress toward collecting this " +
          "site's public pages or ads. Prefer a candidate over stop unless the page shows " +
          "nothing further to reach, or the same action was already taken and yielded nothing new. " +
          "Do not invent actions that are not in the criteria.",
        criteria,
      },
    },
  };
}

/**
 * Validate the binding's answer. Mirrors jev-ultrafast's `validate_choice`:
 * the choice must be one we offered, probabilities must cover every option and
 * sum to ~1, and the chosen option must be the maximum.
 */
export function validateCrawlerChoiceAnswer(
  raw: unknown,
  offeredIds: readonly string[],
): CrawlerChoiceDecision {
  if (typeof raw !== "object" || raw === null) {
    throw new CrawlerChoiceAnswerError("Jev returned no answer object");
  }
  const answers = (raw as Record<string, unknown>).answers;
  const answer =
    typeof answers === "object" && answers !== null
      ? (answers as Record<string, unknown>).action
      : undefined;
  if (typeof answer !== "object" || answer === null) {
    throw new CrawlerChoiceAnswerError("Jev returned no action answer");
  }
  const action = answer as Record<string, unknown>;
  const choice = action.choice;
  if (typeof choice !== "string" || !offeredIds.includes(choice)) {
    throw new CrawlerChoiceAnswerError(
      `Jev chose ${JSON.stringify(choice)}, which was not offered`,
    );
  }
  const probabilities = action.probabilities;
  if (typeof probabilities !== "object" || probabilities === null) {
    throw new CrawlerChoiceAnswerError("Jev returned no probability map");
  }
  const numeric: Record<string, number> = {};
  for (const id of offeredIds) {
    const value = (probabilities as Record<string, unknown>)[id];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new CrawlerChoiceAnswerError(`Jev returned an invalid probability for ${id}`);
    }
    numeric[id] = value;
  }
  const sum = Object.values(numeric).reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 0.02) {
    throw new CrawlerChoiceAnswerError(`Jev probabilities sum to ${sum.toFixed(3)}`);
  }
  const best = Math.max(...Object.values(numeric));
  if (numeric[choice] < best - 1e-6) {
    throw new CrawlerChoiceAnswerError(
      `Jev's choice ${choice} is not the maximum-probability option`,
    );
  }
  return {
    choice,
    probabilities: numeric,
    confidence:
      typeof action.confidence === "number" && Number.isFinite(action.confidence)
        ? action.confidence
        : null,
  };
}

/** Deterministic JSON: object keys sorted at every depth, so replays agree. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortValue(source[key]);
    return sorted;
  }
  return value;
}

/** SHA-256 of the exact state we sent, so a row is traceable to its input. */
export async function crawlerChoiceStateSha256(state: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(stableJson(state));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readUsage(raw: unknown): { input_tokens: number; output_tokens: number } {
  const usage =
    typeof raw === "object" && raw !== null
      ? ((raw as Record<string, unknown>).usage as Record<string, unknown> | undefined)
      : undefined;
  return {
    input_tokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
    output_tokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
  };
}

/** Ask Jev, validate, and build both the decision and the log row. */
export async function decideCrawlerChoice(
  ai: CrawlerChoiceAi,
  input: CrawlerChoiceInput,
): Promise<{ decision: CrawlerChoiceDecision; row: CrawlerChoiceRow }> {
  const { state, questions } = buildCrawlerChoiceQuestion(input);
  const offeredIds = crawlerChoiceOfferedIds(input.page.candidates);
  const startedAt = Date.now();
  const raw = await ai.run(CRAWLER_CHOICE_MODEL, { state, questions });
  const ms = Date.now() - startedAt;
  const decision = validateCrawlerChoiceAnswer(raw, offeredIds);
  const row: CrawlerChoiceRow = {
    ts: new Date().toISOString(),
    site: CRAWLER_CHOICE_SITE,
    ref: input.ref ?? "Nishfleet/0509#3618",
    state_sha256: await crawlerChoiceStateSha256(state),
    answers: { action: { type: "choice", choice: decision.choice } },
    probabilities: decision.probabilities,
    usage: readUsage(raw),
    ms,
    choice_point: input.choicePoint,
    page_url: input.page.url,
    scripted: input.scripted.id,
    ...(input.scripted.reason ? { scripted_reason: input.scripted.reason } : {}),
    jev_choice: decision.choice,
    jev_confidence: decision.confidence,
    agreed: decision.choice === input.scripted.id,
    candidates: offeredIds,
    ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
  };
  return { decision, row };
}

/**
 * Observe-only wrapper for production crawl paths: asks Jev, emits the row,
 * and swallows every failure so the crawler's own result is untouched. This is
 * the only entry point crawl code should call.
 */
export async function shadowLogCrawlerChoice(
  ai: CrawlerChoiceAi | undefined,
  input: CrawlerChoiceInput,
  log: (row: CrawlerChoiceRow) => void = logCrawlerChoiceRow,
): Promise<CrawlerChoiceRow | null> {
  if (!ai) return null;
  try {
    const { row } = await decideCrawlerChoice(ai, input);
    log(row);
    return row;
  } catch (error) {
    console.info(
      JSON.stringify({
        event: "crawler_choice_shadow_failed",
        ts: new Date().toISOString(),
        site: CRAWLER_CHOICE_SITE,
        ref: input.ref ?? "Nishfleet/0509#3618",
        choice_point: input.choicePoint,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

/** Default sink: the Worker's structured console log path. */
export function logCrawlerChoiceRow(row: CrawlerChoiceRow): void {
  console.info(JSON.stringify(row));
}

/** Agreement summary over rows, for the report. */
export function summarizeCrawlerChoiceRows(rows: readonly CrawlerChoiceRow[]): {
  total: number;
  agreed: number;
  agreementRate: number | null;
  disagreements: CrawlerChoiceRow[];
  byChoicePoint: Record<string, { total: number; agreed: number }>;
} {
  const disagreements = rows.filter((row) => !row.agreed);
  const byChoicePoint: Record<string, { total: number; agreed: number }> = {};
  for (const row of rows) {
    const bucket = (byChoicePoint[row.choice_point] ??= { total: 0, agreed: 0 });
    bucket.total += 1;
    if (row.agreed) bucket.agreed += 1;
  }
  const agreed = rows.length - disagreements.length;
  return {
    total: rows.length,
    agreed,
    agreementRate: rows.length === 0 ? null : agreed / rows.length,
    disagreements,
    byChoicePoint,
  };
}
