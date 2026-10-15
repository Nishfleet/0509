export interface ActivationWeek {
  week: string;
  signed_up: number;
  watching: number;
  briefed: number;
  came_back: number;
  activated: number;
}

export interface AtRiskCounts {
  live: number;
  unseen: number;
  unopened_brief: number;
  paused: number;
  few_rivals: number;
  unhappy: number;
  unreachable: number;
  any: number;
  two_or_more: number;
}

export interface ActivationBoard {
  cohorts: ActivationWeek[];
  atRisk: AtRiskCounts;
}

export const ACTIVATION_STEPS = [
  "Signed up",
  "Watching a competitor",
  "First brief sent",
  "Came back after it",
  "Did something",
] as const;

export const AT_RISK_ROWS = [
  ["Not seen for 14 days or more", "unseen"],
  ["Last brief sent 2+ days ago and not opened", "unopened_brief"],
  ["Brief paused", "paused"],
  ["Watching fewer than 2 competitors", "few_rivals"],
  ["3+ not-useful answers, no useful ones, last 30 days", "unhappy"],
  ["Brief can't reach them (address suppressed or last brief failed)", "unreachable"],
  ["Any of the above", "any"],
  ["Two or more of the above", "two_or_more"],
] as const satisfies readonly (readonly [string, keyof AtRiskCounts])[];
