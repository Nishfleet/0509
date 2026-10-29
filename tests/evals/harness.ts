import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { noulAction } from "../../app/lib/jev/thresholds";
import type { NoulAction } from "../../app/lib/jev/thresholds";
import type { BreakageEvidence } from "../../app/lib/site/breakage-evidence";

const REPEATS = 3;

const CONCURRENCY = 8;

const MIN_PER_SPLIT = 20;

const MIN_TOTAL = 50;

const HERE = path.dirname(fileURLToPath(import.meta.url));

const JEV_KEY = process.env.LITELLM_JEV_KEY ?? "";

const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";

const VIA_GATEWAY = JEV_KEY === "" && CF_ACCOUNT !== "" && CF_TOKEN !== "";

const GATEWAY_MODEL = "@cf/cloudflare/clef";

const JEV_URL = VIA_GATEWAY ? "workers-ai binding" : (process.env.JEV_URL ?? "http://127.0.0.1:4000/jev");

export const NOUL_WIRE: { type: string; field: string; value: (answer: JevAnswer) => number | undefined } = VIA_GATEWAY
  ? { type: "noul", field: "noul", value: (answer) => answer.noul }
  : { type: "boolean", field: "probability", value: (answer) => answer.probability };

const WRANGLER_CONFIG = path.join(HERE, "..", "..", "wrangler.jsonc");

let platform: Promise<PlatformProxy<{ AI: Ai }>> | undefined;

export async function aiBinding(): Promise<Ai> {
  platform ??= getPlatformProxy<{ AI: Ai }>({ configPath: WRANGLER_CONFIG, persist: false });
  return (await platform).env.AI;
}

type Split = "train" | "test";

export interface EvalRow {
  id: string;
  split: Split;
  why: string;
}

interface EvalEvidence {
  source: string;
  excerpt: string;
}

export interface DiscoveryCase extends EvalRow {
  label: boolean;
  kind: "domain" | "creator";
  self: { name: string; domain: string; description: string | null };
  competitors: { name: string; domain: string }[];
  item: { name: string; domain: string; evidence: EvalEvidence[] };
}

export interface NoulEvalRow extends EvalRow {
  label: boolean;
}

export interface ChoiceEvalRow extends EvalRow {
  label: string;
}

export interface NoulEvalQuestion {
  id: string;
  instructions: string;
  whenTrue: string;
  whenFalse: string;
}

export interface ChoiceEvalQuestion {
  id: string;
  instructions: string;
  options: Readonly<Record<string, string>>;
}

interface Call {
  model: string;
  p: number | null;
  choice: string | null;
}

interface Outcome {
  points: number;
  uncertain: boolean;
  key: string;
}

export type StateAsk = (state: unknown) => Promise<Call>;

export type Ask<T extends EvalRow> = (row: T) => Promise<Call>;

export type Score<T extends EvalRow> = (row: T, call: Call) => Outcome;

export interface JevAnswer {
  type?: string;
  noul?: number;
  probability?: number;
  choice?: string;
}

interface JevResponse {
  model?: string;
  answers?: Record<string, JevAnswer>;
}

export async function loadCases<T extends EvalRow>(
  questionId: string,
  required: readonly (keyof T & string)[],
  options: { file?: string; project?: (entry: unknown) => unknown; unsplit?: boolean } = {},
): Promise<T[]> {
  const file = path.join(HERE, "cases", `${options.file ?? questionId}.json`);
  if (!existsSync(file)) throw new Error(`eval cases missing: ${file}`);
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`eval cases must be a JSON array: ${file}`);
  const cases = parsed.map((raw, index) => {
    const entry = options.project?.(raw) ?? raw;
    const row = entry as EvalRow;
    if (typeof row.id !== "string" || row.id === "") throw new Error(`case ${index} has no id`);
    if (options.unsplit !== true && row.split !== "train" && row.split !== "test")
      throw new Error(`case ${row.id} has no split`);
    if (typeof row.why !== "string" || row.why === "") throw new Error(`case ${row.id} has no why`);
    for (const key of required) {
      const value = Reflect.get(row, key);
      if (value === undefined || value === null) throw new Error(`case ${row.id} has no ${key}`);
    }
    const label = Reflect.get(row, "label");
    if (label !== undefined && typeof label !== "boolean" && typeof label !== "string") {
      throw new Error(`case ${row.id} label must be a boolean or a string`);
    }
    return entry as T;
  });
  if (cases.length < MIN_TOTAL) throw new Error(`${questionId} has ${cases.length} cases, needs ${MIN_TOTAL}`);
  const ids = new Set(cases.map((row) => row.id));
  if (ids.size !== cases.length) throw new Error(`${questionId} has duplicate case ids`);
  for (const split of options.unsplit === true ? [] : (["train", "test"] as const)) {
    const count = cases.filter((row) => row.split === split).length;
    if (count < MIN_PER_SPLIT)
      throw new Error(`${questionId} ${split} split has ${count} cases, needs ${MIN_PER_SPLIT}`);
  }
  return cases;
}

function selectedSplits(): Split[] {
  const value = process.env.EVAL_SPLIT ?? "all";
  if (value === "train") return ["train"];
  if (value === "test") return ["test"];
  if (value === "all") return ["train", "test"];
  throw new Error(`EVAL_SPLIT must be train, test or all, got ${value}`);
}

const JEV_TIMEOUT_MS = 60_000;

const BUDGET_MARGIN = 1.2;

const NEURONS_PER_CLEF_CALL = 17;

export const NEURONS_PER_MODEL_CALL = 60;

function readCeiling(name: string, fallback: number): number {
  const raw = process.env[name] ?? "";
  if (raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer or empty, got ${raw}`);
  }
  return Number(raw);
}

const NEURON_CEILING = readCeiling("EVAL_MAX_NEURONS", 0);

const DAILY_CEILING = readCeiling("EVAL_DAILY_NEURON_CEILING", 9000);

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const DAILY_QUERY = `query($account: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    aiInferenceAdaptiveGroups(limit: 1, filter: { datetime_geq: $since, datetime_leq: $until }) {
      sum { totalNeurons }
    }
  } }
}`;

interface DailyReply {
  data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: unknown } }[] }[] } };
  errors?: unknown;
}

async function neuronsToday(): Promise<number> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CF_TOKEN}` },
    body: JSON.stringify({
      query: DAILY_QUERY,
      variables: { account: CF_ACCOUNT, since: since.toISOString(), until: now.toISOString() },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GraphQL answered ${String(response.status)}`);
  const reply = (await response.json()) as DailyReply;
  if (reply.errors !== undefined && reply.errors !== null) throw new Error("GraphQL returned errors");
  const groups = reply.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
  if (groups === undefined) throw new Error("GraphQL returned no aiInferenceAdaptiveGroups");
  const total = groups[0]?.sum?.totalNeurons ?? 0;
  if (typeof total !== "number" || !Number.isFinite(total)) throw new Error("GraphQL neurons were not a number");
  return total;
}

let dailyGuard: Promise<void> | undefined;

async function checkDaily(): Promise<void> {
  let today: number;
  try {
    today = await neuronsToday();
  } catch (error) {
    throw new Error(
      `eval refused: cannot read today's neurons (${String(error)}), so the daily ceiling cannot be checked (0509#7249)`,
      { cause: error },
    );
  }
  const verdict = today + NEURON_CEILING > DAILY_CEILING ? "refused" : "ok";
  console.log(
    `daily neuron guard: ${verdict}; today (UTC) ${String(Math.round(today))} + this run's ceiling ${String(NEURON_CEILING)} vs daily ceiling ${String(DAILY_CEILING)}`,
  );
  if (verdict === "refused") {
    throw new Error(
      `eval refused: ${String(Math.round(today))} neurons used today (UTC) plus this run's ${String(NEURON_CEILING)} would pass the daily ceiling of ${String(DAILY_CEILING)}; set by EVAL_DAILY_NEURON_CEILING in .github/workflows/evals.yml (0509#7249)`,
    );
  }
}

function guardDaily(): Promise<void> {
  if (!VIA_GATEWAY) return Promise.resolve();
  dailyGuard ??= checkDaily();
  return dailyGuard;
}

let callBudget = 0;

let callsUsed = 0;

let neuronsSpent = 0;

function withoutModel(body: unknown): unknown {
  const { model: _model, ...rest } = body as { model?: string };
  return rest;
}

function unwrapJev(value: unknown): JevResponse {
  const { response, result } = value as { response?: unknown; result?: unknown };
  const inner = result ?? response;
  if (typeof inner === "string") return JSON.parse(inner) as JevResponse;
  return (inner ?? value) as JevResponse;
}

async function withOneRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!String(error).includes("Network connection lost")) throw error;
    return call();
  }
}

function spendCall(neurons: number): void {
  if (callsUsed >= callBudget) throw new Error(`eval stopped: call budget of ${String(callBudget)} spent`);
  if (NEURON_CEILING > 0 && neuronsSpent + neurons > NEURON_CEILING) {
    throw new Error(
      `eval stopped: neuron ceiling of ${String(NEURON_CEILING)} spent (estimated ${String(neuronsSpent)}); EVAL_MAX_NEURONS sets it, a repository variable whose evals.yml default is 2000 (0509#7249)`,
    );
  }
  callsUsed += 1;
  neuronsSpent += neurons;
}

export async function postWorkersAi(model: string, body: unknown): Promise<unknown> {
  await guardDaily();
  return withOneRetry(async () => {
    spendCall(NEURONS_PER_MODEL_CALL);
    const ai = await aiBinding();
    return ai.run(model as never, body as never);
  });
}

async function postJev(body: unknown): Promise<JevResponse> {
  await guardDaily();
  spendCall(NEURONS_PER_CLEF_CALL);
  if (VIA_GATEWAY) {
    const raw = await (
      await aiBinding()
    ).run(GATEWAY_MODEL as never, { ...(withoutModel(body) as object), model: "clef" } as never);
    const unwrapped = unwrapJev(raw);
    return { ...unwrapped, model: typeof unwrapped.model === "string" ? unwrapped.model : GATEWAY_MODEL };
  }
  const response = await fetch(JEV_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${JEV_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`jev POST failed with ${String(response.status)}: ${detail}`);
  }
  const parsed = (await response.json()) as JevResponse;
  if (typeof parsed.model !== "string") throw new Error("jev response carried no model version");
  return parsed;
}

function answerOf(body: JevResponse, questionId: string): JevAnswer {
  const answer = body.answers?.[questionId];
  if (answer === undefined) throw new Error(`jev answer missing ${questionId}: ${JSON.stringify(body).slice(0, 300)}`);
  return answer;
}

interface HistoryCase {
  kind: string | null;
  at: string;
  change?: string;
  customer_said?: "useful" | "not_useful";
}

interface SiteChangeCase {
  id: string;
  split: Split;
  subject: { name: string | null; domain: string };
  isSelf: boolean;
  pageUrl: string;
  pageRole: string | null;
  hunks: { lines: readonly string[] }[];
  evidence: BreakageEvidence;
  history_30d: (string | null | HistoryCase)[];
  labels: Record<string, boolean | string>;
  why: Record<string, string>;
}

export type SiteRow<L extends boolean | string> = Omit<SiteChangeCase, "labels" | "why"> & {
  label: L;
  why: string;
};

export function loadSiteRows<L extends boolean | string>(caseFile: string, questionId: string): Promise<SiteRow<L>[]> {
  return loadCases<SiteRow<L>>(questionId, ["subject", "pageUrl", "hunks", "evidence", "label"], {
    file: caseFile,
    project: (entry) => {
      const { labels, why, ...rest } = entry as SiteChangeCase;
      return { ...rest, label: labels[questionId], why: why[questionId] };
    },
  });
}

export function loadProdRows(): Promise<SiteRow<boolean>[]> {
  return loadCases<SiteRow<boolean>>("noteworthy_change", ["subject", "pageUrl", "hunks", "evidence", "label"], {
    file: "site-change-prod",
    unsplit: true,
    project: (entry) => {
      const { labels, why, ...rest } = entry as SiteChangeCase;
      return { ...rest, split: "test", label: labels.noteworthy_change, why: why.noteworthy_change };
    },
  });
}

function noulQuestions(questions: readonly NoulEvalQuestion[]): Record<string, unknown> {
  return Object.fromEntries(
    questions.map((question) => [
      question.id,
      {
        type: NOUL_WIRE.type,
        instructions: question.instructions,
        criteria: { true: question.whenTrue, false: question.whenFalse },
      },
    ]),
  );
}

function noulValue(answer: JevAnswer, questionId: string): number {
  const value = NOUL_WIRE.value(answer);
  if (typeof value !== "number") throw new Error(`jev answer missing a ${NOUL_WIRE.field} for ${questionId}`);
  return value;
}

export function makeNoulAsk(question: NoulEvalQuestion): StateAsk {
  return async (state) => {
    const body = await postJev({ model: "jev-latest", state, questions: noulQuestions([question]) });
    return { model: body.model as string, p: noulValue(answerOf(body, question.id), question.id), choice: null };
  };
}

export function makeNoulsAsk(questions: readonly NoulEvalQuestion[], combine: (ps: number[]) => number): StateAsk {
  return async (state) => {
    const body = await postJev({ model: "jev-latest", state, questions: noulQuestions(questions) });
    const ps = questions.map((question) => noulValue(answerOf(body, question.id), question.id));
    return { model: body.model as string, p: combine(ps), choice: null };
  };
}

export function makeChoiceAsk(question: ChoiceEvalQuestion): StateAsk {
  return async (state) => {
    const body = await postJev({
      model: "jev-latest",
      state,
      questions: {
        [question.id]: { type: "choice", instructions: question.instructions, criteria: question.options },
      },
    });
    const answer = answerOf(body, question.id);
    if (typeof answer.choice !== "string" || !Object.keys(question.options).includes(answer.choice)) {
      throw new Error(`jev answer missing a known choice: ${question.id}`);
    }
    return { model: body.model as string, p: null, choice: answer.choice };
  };
}

function scoreAction(action: NoulAction, label: boolean): number {
  if (action === "maybe") return 0.5;
  return (action === "act") === label ? 1 : 0;
}

export const noulScore: Score<NoulEvalRow> = (row, call) => {
  if (call.p === null) throw new Error(`noul score got a choice for ${row.id}`);
  const action = noulAction(call.p);
  return { points: scoreAction(action, row.label), uncertain: action === "maybe", key: action };
};

export const choiceScore: Score<ChoiceEvalRow> = (row, call) => {
  if (call.choice === null) throw new Error(`choice score got a noul for ${row.id}`);
  return { points: call.choice === row.label ? 1 : 0, uncertain: false, key: call.choice };
};

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

interface SplitScore {
  split: Split;
  cases: number;
  calls: number;
  score: number;
  low: number;
  high: number;
  wrong: number;
  maybe: number;
  flipped: number;
  wrongIds: string[];
  maybeIds: string[];
  flippedIds: string[];
}

export interface EvalReport {
  questionId: string;
  model: string;
  repeats: number;
  jevUrl: string;
  splits: SplitScore[];
  callsUsed: number;
  callBudget: number;
  neuronsSpent: number;
  neuronCeiling: number;
}

async function scoreSplit<T extends EvalRow>(
  split: Split,
  rows: readonly T[],
  ask: Ask<T>,
  score: Score<T>,
): Promise<{ score: SplitScore; models: Set<string> }> {
  const models = new Set<string>();
  const scored = await mapLimit(rows, CONCURRENCY, async (row) => {
    const outcomes: Outcome[] = [];
    const calls: number[] = [];
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      const call = await ask(row);
      models.add(call.model);
      const outcome = score(row, call);
      outcomes.push(outcome);
      calls.push(outcome.points);
    }
    return { row, outcomes, calls };
  });
  const calls = scored.flatMap((entry) => entry.calls);
  if (models.size > 1) {
    throw new Error(`${split} split mixed model versions across repeats: ${[...models].sort().join(", ")}`);
  }
  const value = mean(calls);
  const spread = 1.959963984540054 * (stdev(calls) / Math.sqrt(calls.length));
  const wrongIds = scored.filter((entry) => entry.calls.some((point) => point === 0)).map((entry) => entry.row.id);
  const maybeIds = scored
    .filter((entry) => entry.outcomes.some((outcome) => outcome.uncertain))
    .map((entry) => entry.row.id);
  const flippedIds = scored
    .filter((entry) => new Set(entry.outcomes.map((outcome) => outcome.key)).size > 1)
    .map((entry) => entry.row.id);
  return {
    score: {
      split,
      cases: rows.length,
      calls: calls.length,
      score: Number(value.toFixed(4)),
      low: Number(Math.max(0, value - spread).toFixed(4)),
      high: Number(Math.min(1, value + spread).toFixed(4)),
      wrong: wrongIds.length,
      maybe: maybeIds.length,
      flipped: flippedIds.length,
      wrongIds,
      maybeIds,
      flippedIds,
    },
    models,
  };
}

export async function runEval<T extends EvalRow>(
  questionId: string,
  rows: readonly T[],
  ask: Ask<T>,
  score: Score<T>,
  neuronsPerCall: number = NEURONS_PER_CLEF_CALL,
): Promise<EvalReport> {
  const models = new Set<string>();
  const splits: SplitScore[] = [];
  const wanted = selectedSplits();
  callsUsed = 0;
  const selectedRows = rows.filter((row) => wanted.includes(row.split)).length;
  callBudget = Math.ceil(selectedRows * REPEATS * BUDGET_MARGIN);
  const plannedNeurons = selectedRows * REPEATS * neuronsPerCall;
  if (NEURON_CEILING > 0 && neuronsSpent + plannedNeurons > NEURON_CEILING) {
    throw new Error(
      `eval refused before any paid call: ${questionId} needs about ${String(plannedNeurons)} neurons (${String(selectedRows)} rows x ${String(REPEATS)} repeats x ${String(neuronsPerCall)} per call) on top of ${String(neuronsSpent)} already spent, over the ceiling of ${String(NEURON_CEILING)}; narrow the run with the evals.yml split or filter input, or EVAL_SPLIT here, or set the EVAL_MAX_NEURONS repository variable (one run still stops at EVAL_DAILY_NEURON_CEILING) (0509#10054)`,
    );
  }
  for (const split of wanted) {
    const picked = rows.filter((row) => row.split === split);
    if (picked.length === 0) throw new Error(`${questionId} has no ${split} cases to score`);
    const scored = await scoreSplit(split, picked, ask, score);
    for (const model of scored.models) models.add(model);
    splits.push(scored.score);
  }
  return {
    questionId,
    model: [...models].join(","),
    repeats: REPEATS,
    jevUrl: JEV_URL,
    splits,
    callsUsed,
    callBudget,
    neuronsSpent,
    neuronCeiling: NEURON_CEILING,
  };
}

export function formatReport(report: EvalReport): string {
  const rows = report.splits
    .map(
      (split) =>
        `${split.split}\tcases ${split.cases}\tscore ${split.score}\t95% CI [${split.low}, ${split.high}]\twrong ${split.wrong}\tmaybe ${split.maybe}/${split.calls}\tflipped ${split.flipped}`,
    )
    .join("\n");
  const train = report.splits.find((split) => split.split === "train");
  const uncertain =
    train === undefined
      ? ""
      : `\ntrain maybes: ${train.maybeIds.join(", ") || "none"}\ntrain wrong: ${train.wrongIds.join(", ") || "none"}`;
  return [
    `question ${report.questionId}\tmodel ${report.model}\trepeats ${report.repeats}\tjev calls ${report.callsUsed}/${report.callBudget}\test. neurons so far ${report.neuronsSpent}/${report.neuronCeiling > 0 ? report.neuronCeiling : "no ceiling"}`,
    rows,
    uncertain,
  ].join("\n");
}

export function workersAiPresent(): boolean {
  const present = CF_ACCOUNT !== "" && CF_TOKEN !== "";
  if (!present && process.env.CI === "true")
    throw new Error("CI has no Workers AI credentials, so no case would be scored");
  return present;
}

export function jevKeyPresent(): boolean {
  const present = JEV_KEY !== "" || VIA_GATEWAY;
  if (!present && process.env.CI === "true") throw new Error("CI has no Jev credentials, so no case would be scored");
  return present;
}
