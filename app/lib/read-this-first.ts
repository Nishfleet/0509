export const D4_QUESTION_ID = "read_this_first";

export interface D4Verdict {
  signalId: string;
  p: number;
  observedAt: string;
}

export function pickReadThisFirst(verdicts: readonly D4Verdict[]): string[] {
  return verdicts
    .filter((v) => v.p >= 0.5)
    .sort((a, b) => b.p - a.p || b.observedAt.localeCompare(a.observedAt))
    .slice(0, 3)
    .map((v) => v.signalId);
}

export function readThisFirstLine(picked: number, judged: number, leadName: string): string {
  return `${String(picked)} of ${String(judged)} worth knowing this week, led by ${leadName}.`;
}
