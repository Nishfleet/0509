export interface NoulQuestion {
  id: string;
  instructions: string;
  whenTrue: string;
  whenFalse: string;
}

export type NoulAction = "act" | "maybe" | "reject";

export const ACT_AT = 0.9;

export const REJECT_AT = 0.1;

export function noulAction(p: number): NoulAction {
  if (p >= ACT_AT) return "act";
  if (p <= REJECT_AT) return "reject";
  return "maybe";
}
