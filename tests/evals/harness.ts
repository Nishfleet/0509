import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { noulAction } from "../../app/lib/jev/thresholds";
import type { NoulAction } from "../../app/lib/jev/thresholds";
import type { BreakageEvidence } from "../../app/lib/site/breakage-evidence";

const REPEATS = 3;

const CONCURRENCY = 8;

const MIN_PER_SPLIT = 20;

const MIN_TOTAL = 50;

const HERE = path.dirname(fileURLToPath(import.meta.url));

const JEV_URL = process.env.JEV_URL ?? "http://127.0.0.1:4000/jev";

const JEV_KEY = process.env.LITELLM_JEV_KEY ?? "";

type Split = "train" | "test";

interface EvalEvidence {
  source: string;
  excerpt: string;
}

export interface EvalCase {
  id: string;
  split: Split;
  kind: "domain" | "creator";
  self: { name: string; domain: string; description: string | null };
  competitors: { name: string; domain: string }[];
  item: { name: string; domain: string; evidence: EvalEvidence[] };
  label: boolean;
  why: string;
}

export interface EvalQuestion {
  id: string;
  instructions: string;
  whenTrue: string;
  whenFalse: string;
}

export interface EvalChoiceQuestion {
  id: string;
  instructions: string;
  options: Record<string, string>;
}

interface JevAnswer {
  type?: string;
  noul?: number;
  choice?: string;
}

export type Ask = (row: EvalCase) => Promise<{ p: number; model: string }>;

async function loadJson(questionId: string): Promise<unknown> {
  const file = path.join(HERE, "cases", `${questionId}.json`);
  if (!existsSync(file)) throw new Error(`eval cases missing: ${file}`);
  return JSON.parse(await readFile(file, "utf8"));
}

function requireSplits(questionId: string, cases: readonly { split: Split }[]): void {
  if (cases.length < MIN_TOTAL) throw new Error(`${questionId} has ${cases.length} cases, needs ${MIN_TOTAL}`);
  for (const split of ["train", "test"] as const) {
    const count = cases.filter((row) => row.split === split).length;
    if (count < MIN_PER_SPLIT)
      throw new Error(`${questionId} ${split} split has ${count} cases, needs ${MIN_PER_SPLIT}`);
  }
}

function validateCases(questionId: string, parsed: unknown): EvalCase[] {
  if (!Array.isArray(parsed)) throw new Error(`eval cases must be a JSON array: ${questionId}`);
  const cases = parsed.map((entry, index) => {
    const row = entry as EvalCase;
    if (typeof row.id !== "string" || row.id === "") throw new Error(`case ${index} has no id`);
    if (row.split !== "train" && row.split !== "test") throw new Error(`case ${row.id} has no split`);
    if (typeof row.label !== "boolean") throw new Error(`case ${row.id} has no boolean label`);
    if (typeof row.why !== "string" || row.why === "") throw new Error(`case ${row.id} has no why`);
    if (row.kind !== "domain" && row.kind !== "creator") throw new Error(`case ${row.id} has no kind`);
    return row;
  });
  requireSplits(questionId, cases);
  return cases;
}

export async function loadCases(questionId: string): Promise<EvalCase[]> {
  return validateCases(questionId, await loadJson(questionId));
}

export interface SiteChangeCase {
  id: string;
  split: Split;
  subject: { name: string | null; domain: string };
  isSelf: boolean;
  pageUrl: string;
  pageRole: string | null;
  hunks: { lines: readonly string[] }[];
  evidence: BreakageEvidence;
  history_30d: (string | null)[];
  labels: Record<string, boolean | string>;
  why: Record<string, string>;
}

export type SiteStateBuilder = (row: SiteChangeCase) => unknown;

function siteLabel(row: SiteChangeCase, questionId: string): boolean | string {
  const label = row.labels[questionId];
  if (typeof label === "boolean" || typeof label === "string") return label;
  throw new Error(`site case ${row.id} has no label for ${questionId}`);
}

function validateSiteCases(questionId: string, parsed: unknown): SiteChangeCase[] {
  if (!Array.isArray(parsed)) throw new Error(`site eval cases must be a JSON array: ${questionId}`);
  const cases = parsed.map((entry, index) => {
    const row = entry as SiteChangeCase;
    if (typeof row.id !== "string" || row.id === "") throw new Error(`site case ${index} has no id`);
    if (row.split !== "train" && row.split !== "test") throw new Error(`site case ${row.id} has no split`);
    if (typeof row.subject?.domain !== "string") throw new Error(`site case ${row.id} has no subject domain`);
    if (typeof row.isSelf !== "boolean") throw new Error(`site case ${row.id} has no isSelf`);
    if (typeof row.pageUrl !== "string" || row.pageUrl === "") throw new Error(`site case ${row.id} has no pageUrl`);
    if (!Array.isArray(row.hunks)) throw new Error(`site case ${row.id} has no hunks`);
    if (typeof row.evidence?.status !== "number") throw new Error(`site case ${row.id} has no evidence`);
    if (!Array.isArray(row.history_30d)) throw new Error(`site case ${row.id} has no history_30d`);
    if (typeof row.labels !== "object" || row.labels === null) throw new Error(`site case ${row.id} has no labels`);
    if (typeof row.why !== "object" || row.why === null) throw new Error(`site case ${row.id} has no why`);
    siteLabel(row, questionId);
    return row;
  });
  requireSplits(questionId, cases);
  return cases;
}

export async function loadSiteCases(caseFile: string): Promise<SiteChangeCase[]> {
  return validateSiteCases(caseFile, await loadJson(caseFile));
}

function selectedSplits(): Split[] {
  const value = process.env.EVAL_SPLIT ?? "all";
  if (value === "train") return ["train"];
  if (value === "test") return ["test"];
  if (value === "all") return ["train", "test"];
  throw new Error(`EVAL_SPLIT must be train, test or all, got ${value}`);
}

async function askJev(
  question: EvalQuestion | EvalChoiceQuestion,
  state: unknown,
): Promise<{ answer: JevAnswer; model: string }> {
  const asked =
    "whenTrue" in question
      ? {
          type: "noul" as const,
          instructions: question.instructions,
          criteria: { true: question.whenTrue, false: question.whenFalse },
        }
      : { type: "choice" as const, instructions: question.instructions, criteria: question.options };
  const response = await fetch(JEV_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${JEV_KEY}` },
    body: JSON.stringify({ model: "jev-latest", state, questions: { [question.id]: asked } }),
  });
  if (!response.ok) throw new Error(`jev POST failed with ${String(response.status)}: ${await response.text()}`);
  const body = (await response.json()) as { model?: string; answers?: Record<string, JevAnswer> };
  const answer = body.answers?.[question.id];
  if (answer === undefined) throw new Error(`jev answer missing ${question.id}: ${JSON.stringify(body).slice(0, 300)}`);
  if (typeof body.model !== "string") throw new Error("jev response carried no model version");
  return { answer, model: body.model };
}

export async function makeAsk(
  question: EvalQuestion,
): Promise<(state: unknown) => Promise<{ p: number; model: string }>> {
  return async (state) => {
    const { answer, model } = await askJev(question, state);
    if (typeof answer.noul !== "number") {
      throw new Error(`jev answer for ${question.id} carried no noul: ${JSON.stringify(answer).slice(0, 200)}`);
    }
    return { p: answer.noul, model };
  };
}

async function makeChoiceAsk(
  question: EvalChoiceQuestion,
): Promise<(state: unknown) => Promise<{ choice: string; model: string }>> {
  return async (state) => {
    const { answer, model } = await askJev(question, state);
    if (typeof answer.choice !== "string") {
      throw new Error(`jev answer for ${question.id} carried no choice: ${JSON.stringify(answer).slice(0, 200)}`);
    }
    return { choice: answer.choice, model };
  };
}

function scoreAction(action: NoulAction, label: boolean): number {
  if (action === "maybe") return 0.5;
  return (action === "act") === label ? 1 : 0;
}

function scoreChoice(choice: string, expected: string): number {
  return choice === expected ? 1 : 0;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
}

interface ScoredRow {
  id: string;
  actions: string[];
  calls: number[];
}

function summarise(split: Split, caseCount: number, scored: readonly ScoredRow[]): SplitScore {
  const calls = scored.flatMap((entry) => entry.calls);
  const score = mean(calls);
  const spread = 1.959963984540054 * (stdev(calls) / Math.sqrt(calls.length));
  const wrongIds = scored.filter((entry) => entry.calls.some((value) => value === 0)).map((entry) => entry.id);
  const maybeIds = scored.filter((entry) => entry.actions.includes("maybe")).map((entry) => entry.id);
  const flippedIds = scored.filter((entry) => new Set(entry.actions).size > 1).map((entry) => entry.id);
  return {
    split,
    cases: caseCount,
    calls: calls.length,
    score: Number(score.toFixed(4)),
    low: Number(Math.max(0, score - spread).toFixed(4)),
    high: Number(Math.min(1, score + spread).toFixed(4)),
    wrong: wrongIds.length,
    maybe: maybeIds.length,
    flipped: flippedIds.length,
    wrongIds,
    maybeIds,
    flippedIds,
  };
}

function reportOf(questionId: string, models: Set<string>, splits: SplitScore[]): EvalReport {
  return { questionId, model: [...models].join(","), repeats: REPEATS, jevUrl: JEV_URL, splits };
}

export async function runEval(questionId: string, ask: Ask): Promise<EvalReport> {
  const cases = await loadCases(questionId);
  const models = new Set<string>();
  const splits: SplitScore[] = [];
  for (const split of selectedSplits()) {
    const rows = cases.filter((row) => row.split === split);
    const scored = await mapLimit(rows, CONCURRENCY, async (row) => {
      const actions: NoulAction[] = [];
      const calls: number[] = [];
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        const { p, model } = await ask(row);
        models.add(model);
        const action = noulAction(p);
        actions.push(action);
        calls.push(scoreAction(action, row.label));
      }
      return { id: row.id, actions, calls };
    });
    splits.push(summarise(split, rows.length, scored));
  }
  return reportOf(questionId, models, splits);
}

export async function runSiteNoul(
  caseFile: string,
  question: EvalQuestion,
  buildState: SiteStateBuilder,
): Promise<EvalReport> {
  const cases = await loadSiteCases(caseFile);
  const questionId = question.id;
  const ask = await makeAsk(question);
  const models = new Set<string>();
  const splits: SplitScore[] = [];
  for (const split of selectedSplits()) {
    const rows = cases.filter((row) => row.split === split);
    const scored = await mapLimit(rows, CONCURRENCY, async (row) => {
      const label = siteLabel(row, questionId);
      const actions: NoulAction[] = [];
      const calls: number[] = [];
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        const { p, model } = await ask(buildState(row));
        models.add(model);
        const action = noulAction(p);
        actions.push(action);
        calls.push(scoreAction(action, typeof label === "boolean" ? label : false));
      }
      return { id: row.id, actions, calls };
    });
    splits.push(summarise(split, rows.length, scored));
  }
  return reportOf(questionId, models, splits);
}

export async function runSiteChoice(
  caseFile: string,
  question: EvalChoiceQuestion,
  buildState: SiteStateBuilder,
): Promise<EvalReport> {
  const cases = await loadSiteCases(caseFile);
  const questionId = question.id;
  const ask = await makeChoiceAsk(question);
  const models = new Set<string>();
  const splits: SplitScore[] = [];
  for (const split of selectedSplits()) {
    const rows = cases.filter((row) => row.split === split);
    const scored = await mapLimit(rows, CONCURRENCY, async (row) => {
      const expected = String(siteLabel(row, questionId));
      const actions: string[] = [];
      const calls: number[] = [];
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        const { choice, model } = await ask(buildState(row));
        models.add(model);
        actions.push(choice);
        calls.push(scoreChoice(choice, expected));
      }
      return { id: row.id, actions, calls };
    });
    splits.push(summarise(split, rows.length, scored));
  }
  return reportOf(questionId, models, splits);
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
  return [`question ${report.questionId}\tmodel ${report.model}\trepeats ${report.repeats}`, rows, uncertain].join(
    "\n",
  );
}

export function jevKeyPresent(): boolean {
  return JEV_KEY !== "";
}
