import { ACT_AT, ABOUT_BRAND_KEEP_AT, changeActsSql } from "./jev/thresholds";
import { changeJudgedSql } from "./site-change";
import { D3_QUESTION_ID, D3S_QUESTION_ID, D6_QUESTION_ID } from "./standing-score";

export const PIPELINE_SIGNALS = "signal";

const MENTION_VERDICT = `(SELECT mv.p FROM jev_verdict mv WHERE mv.signal_id = s.id AND mv.question_id = '${D6_QUESTION_ID}' ORDER BY mv.decided_at DESC LIMIT 1)`;

const CHANGE_JUDGED = changeJudgedSql({ noteworthy: `'${D3_QUESTION_ID}'`, breakage: `'${D3S_QUESTION_ID}'` });

const CHANGE_CAPTURED = `(CASE WHEN json_valid(s.payload_json)
  THEN json_extract(s.payload_json, '$.before.textKey') IS NOT NULL
    AND json_extract(s.payload_json, '$.after.textKey') IS NOT NULL
  ELSE 0 END)`;

const KIND_READY = `CASE s.kind
  WHEN 'mention' THEN s.state IS NOT 'unjudged' AND s.title IS NOT NULL AND s.canonical_url IS NOT NULL AND ${MENTION_VERDICT} >= ${String(ABOUT_BRAND_KEEP_AT)}
  WHEN 'change' THEN ${CHANGE_CAPTURED} AND ${CHANGE_JUDGED}
  WHEN 'hiring' THEN s.title IS NOT NULL AND s.url IS NOT NULL
  WHEN 'content' THEN s.title IS NOT NULL AND s.url IS NOT NULL
  WHEN 'ad' THEN COALESCE(s.title, s.summary) IS NOT NULL
  ELSE 0
END`;

const ACTS = `CASE s.kind
  WHEN 'mention' THEN ${MENTION_VERDICT} >= ${String(ACT_AT)}
  WHEN 'change' THEN EXISTS (
    SELECT 1 FROM jev_verdict av
    WHERE av.signal_id = s.id AND av.question_id = '${D3_QUESTION_ID}' AND ${changeActsSql("s", "av")}
  )
  ELSE 1
END`;

const SHOWN_WHERE = `s.is_tombstoned = 0 AND s.duplicate_of IS NULL AND ${KIND_READY}`;

export const SHOWN_SIGNALS = `(SELECT s.* FROM ${PIPELINE_SIGNALS} s WHERE ${SHOWN_WHERE})`;

export const SENDABLE_SIGNALS = `(SELECT s.* FROM ${PIPELINE_SIGNALS} s WHERE ${SHOWN_WHERE} AND ${ACTS})`;

export function alsoReportedCountSql(mention: string): string {
  return `(SELECT COUNT(*) FROM ${PIPELINE_SIGNALS} d WHERE d.duplicate_of = ${mention}.id AND d.is_tombstoned = 0)`;
}

const HOLD_DEADLINE_MS = 72 * 60 * 60 * 1000;

export function holdDeadlinePassed(closesAt: Date, now: Date): boolean {
  return now.getTime() - closesAt.getTime() >= HOLD_DEADLINE_MS;
}

export function weekSendable(input: { unjudgedInputs: number; holdDeadlinePassed: boolean }): boolean {
  return input.unjudgedInputs === 0 || input.holdDeadlinePassed;
}
