export interface NoulQuestion {
  id: string;
  instructions: string;
  whenTrue: string;
  whenFalse: string;
}

export type NoulAction = "act" | "maybe" | "reject";

export const ACT_AT = 0.9;

export const REJECT_AT = 0.1;

export const PRICING_ACT_AT = 0.6;

export const CHANGE_KIND_QUESTION_ID = "change_kind";

export function changeActsSql(signal: string, verdict: string): string {
  const pricing = `${signal}.kind = 'change' AND ${verdict}.p >= ${String(PRICING_ACT_AT)} AND EXISTS (SELECT 1 FROM jev_verdict kind_v WHERE kind_v.signal_id = ${signal}.id AND kind_v.question_id = '${CHANGE_KIND_QUESTION_ID}' AND kind_v.choice = 'pricing')`;
  return `(${verdict}.p >= ${String(ACT_AT)} OR (${pricing}))`;
}

export function noulAction(p: number): NoulAction {
  if (p >= ACT_AT) return "act";
  if (p <= REJECT_AT) return "reject";
  return "maybe";
}
