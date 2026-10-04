import { countVerdictsSince, insertVerdicts, readVerdictIds, type VerdictRow } from "../data/jev_verdict.server";
import { readRecentSignals } from "../data/signal.server";
import {
  askChoice,
  askNoul,
  JevUnavailableError,
  type ChoiceQuestion,
  type ChoiceVerdict,
  type NoulQuestion,
  type NoulVerdict,
} from "../jev/client.server";
import { ACT_AT, CHANGE_KIND_QUESTION_ID, PRICING_ACT_AT, REJECT_AT } from "../jev/thresholds";
import { daysBefore } from "../site-changes.server";
import type { BreakageEvidence } from "./breakage-evidence";

const JEV_JUDGMENTS_PER_BRAND_PER_DAY = 6;

const HISTORY_DAYS = 30;

const HISTORY_LIMIT = 20;

const BREAKAGE_ALERT_P = 0.5;

const BREAKAGE_CLEAR_P = 0.1;

const PUBLISH_P = ACT_AT;

const DISCARD_P = REJECT_AT;

const D3S_BREAKAGE_QID = "own_site_breakage";

const D3_NOTEWORTHY_QID = "noteworthy_change";

const D3_KIND_QID = CHANGE_KIND_QUESTION_ID;

export const D3S_BREAKAGE: NoulQuestion = {
  id: D3S_BREAKAGE_QID,
  instructions: "Does this change make the brand own website look broken or unintentionally degraded for a visitor?",
  whenTrue: "The page looks broken or degraded for a visitor working normally.",
  whenFalse: "The change looks deliberate and the page looks fine for a visitor working normally.",
};

export const D3_NOTEWORTHY: NoulQuestion = {
  id: D3_NOTEWORTHY_QID,
  instructions: "Is this change to the brand website worth telling a customer who tracks this brand?",
  whenTrue: "A customer tracking this brand would want to know about this change.",
  whenFalse: "Nothing here would matter to a customer tracking this brand.",
};

export const D3_KIND: ChoiceQuestion = {
  id: D3_KIND_QID,
  instructions: "What kind of change is this?",
  options: {
    offer: "a new promotion or discount",
    pricing: "a price or plan change",
    copy: "a messaging or positioning change",
    launch: "a new product, feature or collection",
    removal: "a product, plan or section removed",
    breakage: "the page looks broken",
    unintended: "a change that looks accidental",
    noise: "nothing meaningful changed",
  },
};

interface BreakageBand {
  p: number;
  band: "alert" | "check" | "clear";
}

interface NoteworthyBand {
  p: number;
  kind: string;
  band: "publish" | "uncertain" | "discard";
}

export interface ChangeJudgment {
  deferred: boolean;
  selfBreakage: BreakageBand | null;
  noteworthy: NoteworthyBand | null;
}

export interface JudgedChange extends ChangeJudgment {
  verdictIds: readonly string[];
}

export interface ChangeStateInput {
  isSelf: boolean;
  subject: { name: string | null; domain: string };
  pageUrl: string;
  pageRole: string | null;
  hunks: readonly { lines: readonly string[] }[];
  evidence: BreakageEvidence;
}

export interface HistoryEntry {
  kind: string | null;
  at: string;
}

export interface ChangeState<H = HistoryEntry> {
  subject: { name: string | null; domain: string };
  isSelf: boolean;
  page: { url: string; role: string | null };
  item: { hunks: readonly { lines: readonly string[] }[]; evidence: BreakageEvidence };
  history_30d: readonly H[];
}

export interface JudgeInput extends ChangeStateInput {
  workspaceId: string;
  entityId: string;
  signalId: string | null;
}

export function changeState<H>(input: ChangeStateInput, history30d: readonly H[]): ChangeState<H> {
  return {
    subject: input.subject,
    isSelf: input.isSelf,
    page: { url: input.pageUrl, role: input.pageRole },
    item: { hunks: input.hunks, evidence: input.evidence },
    history_30d: history30d,
  };
}

function breakageBandOf(p: number): BreakageBand["band"] {
  if (p >= BREAKAGE_ALERT_P) return "alert";
  if (p <= BREAKAGE_CLEAR_P) return "clear";
  return "check";
}

function noteworthyBandOf(p: number, kind: string): NoteworthyBand["band"] {
  if (kind === "noise") return "discard";
  if (p >= PUBLISH_P) return "publish";
  if (kind === "pricing" && p >= PRICING_ACT_AT) return "publish";
  if (p <= DISCARD_P) return "discard";
  return "uncertain";
}

function todayStartIso(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function verdictRow(input: {
  workspaceId: string;
  entityId: string;
  signalId: string | null;
  questionId: string;
  inputHash: string;
  p: number | null;
  choice: string | null;
  decidedAt: string;
}): VerdictRow {
  return {
    workspaceId: input.workspaceId,
    questionId: input.questionId,
    inputHash: input.inputHash,
    signalId: input.signalId,
    entityId: input.entityId,
    p: input.p,
    choice: input.choice,
    reason: null,
    decidedAt: input.decidedAt,
  };
}

async function readHistory30d(entityId: string, since: string): Promise<HistoryEntry[]> {
  const recent = await readRecentSignals(entityId, since);
  return recent
    .filter((row) => row.kind === "change")
    .slice(0, HISTORY_LIMIT)
    .map((row) => ({ kind: row.aspect, at: row.observedAt }));
}

function logJevUnavailable(error: JevUnavailableError): null {
  console.error(JSON.stringify({ event: "site.jev_unavailable", message: error.message }));
  return null;
}

async function storeVerdicts(rows: readonly VerdictRow[]): Promise<readonly string[]> {
  await insertVerdicts(rows);
  return readVerdictIds(rows);
}

type ChangeStateValue = ChangeState;

function deferredResult(selfBreakage: BreakageBand | null): JudgedChange {
  return { deferred: true, selfBreakage, noteworthy: null, verdictIds: [] };
}

async function judgeSelfBreakage(
  input: JudgeInput,
  state: ChangeStateValue,
  decidedAt: string,
): Promise<{ selfBreakage: BreakageBand; row: VerdictRow } | null> {
  let breakage: NoulVerdict;
  try {
    breakage = await askNoul(input.workspaceId, D3S_BREAKAGE, state);
  } catch (error) {
    if (error instanceof JevUnavailableError) return logJevUnavailable(error);
    throw error;
  }
  const p = breakage.p;
  const row = verdictRow({
    workspaceId: input.workspaceId,
    entityId: input.entityId,
    signalId: input.signalId,
    questionId: D3S_BREAKAGE_QID,
    inputHash: breakage.inputHash,
    p,
    choice: null,
    decidedAt,
  });
  return { selfBreakage: { p, band: breakageBandOf(p) }, row };
}

async function judgeNoteworthy(
  input: JudgeInput,
  state: ChangeStateValue,
  decidedAt: string,
): Promise<{ noteworthy: NonNullable<JudgedChange["noteworthy"]>; rows: VerdictRow[] } | null> {
  let noul: NoulVerdict;
  let choice: ChoiceVerdict;
  try {
    [noul, choice] = await Promise.all([
      askNoul(input.workspaceId, D3_NOTEWORTHY, state),
      askChoice(input.workspaceId, D3_KIND, state),
    ]);
  } catch (error) {
    if (error instanceof JevUnavailableError) return logJevUnavailable(error);
    throw error;
  }
  const p = noul.p;
  const kind = choice.choice;
  const base = { workspaceId: input.workspaceId, entityId: input.entityId, signalId: input.signalId, decidedAt };
  return {
    noteworthy: { p, kind, band: noteworthyBandOf(p, kind) },
    rows: [
      verdictRow({ ...base, questionId: D3_NOTEWORTHY_QID, inputHash: noul.inputHash, p, choice: null }),
      verdictRow({ ...base, questionId: D3_KIND_QID, inputHash: choice.inputHash, p: null, choice: kind }),
    ],
  };
}

export async function judgeChange(input: JudgeInput): Promise<JudgedChange> {
  const now = new Date();
  const decidedAt = now.toISOString();

  const usedToday = await countVerdictsSince(input.entityId, todayStartIso(now));
  if (usedToday >= JEV_JUDGMENTS_PER_BRAND_PER_DAY) return deferredResult(null);

  const history30d = await readHistory30d(input.entityId, daysBefore(now, HISTORY_DAYS));
  const state = changeState(input, history30d);

  const self = input.isSelf ? await judgeSelfBreakage(input, state, decidedAt) : undefined;
  if (self === null) return deferredResult(null);
  if (self !== undefined && self.selfBreakage.band !== "clear") {
    return {
      deferred: false,
      selfBreakage: self.selfBreakage,
      noteworthy: null,
      verdictIds: await storeVerdicts([self.row]),
    };
  }
  const selfBreakage = self?.selfBreakage ?? null;

  const judged = await judgeNoteworthy(input, state, decidedAt);
  if (judged === null) return deferredResult(selfBreakage);

  const rows = self === undefined ? judged.rows : [self.row, ...judged.rows];
  return { deferred: false, selfBreakage, noteworthy: judged.noteworthy, verdictIds: await storeVerdicts(rows) };
}
