import { env } from "cloudflare:workers";

import { countVerdictsSince, findVerdict, insertVerdicts, type VerdictRow } from "../data/jev_verdict.server";
import { askChoice, askNoul, JevUnavailableError, type ChoiceQuestion, type NoulQuestion } from "../jev/client.server";
import type { BreakageEvidence } from "./breakage-evidence";

export const JEV_JUDGMENTS_PER_BRAND_PER_DAY = 6;

const HISTORY_DAYS = 30;

const HISTORY_SQL =
  "SELECT summary FROM signal WHERE entity_id = ?1 AND kind = 'change' AND observed_at >= ?2 ORDER BY observed_at DESC LIMIT 20";

const BREAKAGE_ALERT_P = 0.5;

const BREAKAGE_CLEAR_P = 0.1;

const PUBLISH_P = 0.9;

const DISCARD_P = 0.1;

export const D3S_BREAKAGE_QID = "own_site_breakage";

export const D3_NOTEWORTHY_QID = "noteworthy_change";

export const D3_KIND_QID = "change_kind";

const D3S_BREAKAGE: NoulQuestion = {
  id: D3S_BREAKAGE_QID,
  instructions: "Does this change make the brand own website look broken or unintentionally degraded for a visitor?",
  whenTrue: "The page looks broken or degraded for a visitor working normally.",
  whenFalse: "The change looks deliberate and the page looks fine for a visitor working normally.",
};

const D3_NOTEWORTHY: NoulQuestion = {
  id: D3_NOTEWORTHY_QID,
  instructions: "Is this change to the brand website worth telling a customer who tracks this brand?",
  whenTrue: "A customer tracking this brand would want to know about this change.",
  whenFalse: "Nothing here would matter to a customer tracking this brand.",
};

const D3_KIND: ChoiceQuestion = {
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

export interface BreakageBand {
  p: number;
  band: "alert" | "check" | "clear";
  reason: string;
}

export interface NoteworthyBand {
  p: number;
  kind: string;
  band: "publish" | "uncertain" | "discard";
  reason: string;
}

export interface ChangeJudgment {
  deferred: boolean;
  selfBreakage: BreakageBand | null;
  noteworthy: NoteworthyBand | null;
}

export interface JudgeInput {
  workspaceId: string;
  entityId: string;
  isSelf: boolean;
  subject: { name: string | null; domain: string };
  pageUrl: string;
  pageRole: string | null;
  hunks: readonly { lines: readonly string[] }[];
  evidence: BreakageEvidence;
}

interface HistoryRow {
  summary: string | null;
}

function bandReason(band: string, p: number): string {
  return `${band} at p=${String(p)}`;
}

function breakageBandOf(p: number): BreakageBand["band"] {
  if (p >= BREAKAGE_ALERT_P) return "alert";
  if (p <= BREAKAGE_CLEAR_P) return "clear";
  return "check";
}

function noteworthyBandOf(p: number, kind: string): NoteworthyBand["band"] {
  if (kind === "noise") return "discard";
  if (p >= PUBLISH_P) return "publish";
  if (p <= DISCARD_P) return "discard";
  return "uncertain";
}

function todayStartIso(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function daysBeforeIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function verdictRow(input: {
  workspaceId: string;
  entityId: string;
  questionId: string;
  inputHash: string;
  p: number | null;
  choice: string | null;
  reason: string;
  decidedAt: string;
}): VerdictRow {
  return {
    workspaceId: input.workspaceId,
    questionId: input.questionId,
    inputHash: input.inputHash,
    signalId: null,
    entityId: input.entityId,
    p: input.p,
    choice: input.choice,
    reason: input.reason,
    decidedAt: input.decidedAt,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function groupHash(questionIds: readonly string[], state: unknown): Promise<string> {
  return sha256Hex(JSON.stringify({ questionIds, state }));
}

async function readHistory30d(entityId: string, sinceIso: string): Promise<(string | null)[]> {
  const result = await env.DB.prepare(HISTORY_SQL).bind(entityId, sinceIso).all<HistoryRow>();
  return result.results.map((row) => row.summary);
}

export async function judgeChange(input: JudgeInput): Promise<ChangeJudgment> {
  const now = new Date();
  const decidedAt = now.toISOString();

  const usedToday = await countVerdictsSince(input.entityId, todayStartIso(now));
  if (usedToday >= JEV_JUDGMENTS_PER_BRAND_PER_DAY) {
    return { deferred: true, selfBreakage: null, noteworthy: null };
  }

  const history30d = await readHistory30d(input.entityId, daysBeforeIso(now, HISTORY_DAYS));
  const state = {
    subject: input.subject,
    isSelf: input.isSelf,
    page: { url: input.pageUrl, role: input.pageRole },
    item: { hunks: input.hunks, evidence: input.evidence },
    history_30d: history30d,
  };

  const rows: VerdictRow[] = [];
  let selfBreakage: BreakageBand | null = null;

  if (input.isSelf) {
    const hash = await groupHash([D3S_BREAKAGE_QID], state);
    const cached = await findVerdict(D3S_BREAKAGE_QID, hash);
    let p: number;
    if (typeof cached?.p === "number") {
      p = cached.p;
    } else {
      try {
        p = (await askNoul(input.workspaceId, D3S_BREAKAGE, state)).p;
      } catch (error) {
        if (error instanceof JevUnavailableError) {
          return { deferred: true, selfBreakage: null, noteworthy: null };
        }
        throw error;
      }
    }
    const band = breakageBandOf(p);
    const reason = bandReason(band, p);
    rows.push(verdictRow({
      workspaceId: input.workspaceId,
      entityId: input.entityId,
      questionId: D3S_BREAKAGE_QID,
      inputHash: hash,
      p,
      choice: null,
      reason,
      decidedAt,
    }));
    selfBreakage = { p, band, reason };
    if (band !== "clear") {
      await insertVerdicts(rows);
      return { deferred: false, selfBreakage, noteworthy: null };
    }
  }

  const hash = await groupHash([D3_NOTEWORTHY_QID, D3_KIND_QID], state);
  const cachedNoul = await findVerdict(D3_NOTEWORTHY_QID, hash);
  const cachedKind = await findVerdict(D3_KIND_QID, hash);

  let p: number;
  let kind: string;
  if (cachedNoul?.p != null && cachedKind?.choice != null) {
    p = cachedNoul.p;
    kind = cachedKind.choice;
  } else {
    let noul: { p: number };
    let choice: { choice: string };
    try {
      [noul, choice] = await Promise.all([
        askNoul(input.workspaceId, D3_NOTEWORTHY, state),
        askChoice(input.workspaceId, D3_KIND, state),
      ]);
    } catch (error) {
      if (error instanceof JevUnavailableError) {
        return { deferred: true, selfBreakage, noteworthy: null };
      }
      throw error;
    }
    p = noul.p;
    kind = choice.choice;
  }

  const band = noteworthyBandOf(p, kind);
  const reason = bandReason(band, p);
  rows.push(verdictRow({
    workspaceId: input.workspaceId,
    entityId: input.entityId,
    questionId: D3_NOTEWORTHY_QID,
    inputHash: hash,
    p,
    choice: null,
    reason,
    decidedAt,
  }));
  rows.push(verdictRow({
    workspaceId: input.workspaceId,
    entityId: input.entityId,
    questionId: D3_KIND_QID,
    inputHash: hash,
    p: null,
    choice: kind,
    reason,
    decidedAt,
  }));
  await insertVerdicts(rows);

  return { deferred: false, selfBreakage, noteworthy: { p, kind, band, reason } };
}
