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

export function changeActsSql(signal: string, verdict: string): string {
  return `(${verdict}.p >= ${String(ACT_AT)} OR (${signal}.kind = 'change' AND ${signal}.aspect = 'pricing' AND ${verdict}.p >= ${String(PRICING_ACT_AT)}))`;
}

export function noulAction(p: number): NoulAction {
  if (p >= ACT_AT) return "act";
  if (p <= REJECT_AT) return "reject";
  return "maybe";
}
