import { noulAction, type NoulAction } from "./jev/thresholds";

export interface WhyFlaggedField {
  label: string;
  value: string;
}

export type WhyFlaggedDecision = "Flagged" | "Possibly" | "Held back";

export interface WhyFlagged {
  verdictId: string;
  compared: readonly WhyFlaggedField[];
  sure: string;
  decision: WhyFlaggedDecision;
  reason: string | null;
  decidedAt: string;
}

const DECISION_BY_ACTION = {
  act: "Flagged",
  maybe: "Possibly",
  reject: "Held back",
} satisfies Record<NoulAction, WhyFlaggedDecision>;

export function whyFlagged(input: {
  verdictId: string | null;
  p: number | null;
  reason: string | null;
  decidedAt: string | null;
  compared: readonly WhyFlaggedField[];
}): WhyFlagged | null {
  const { verdictId, p, reason, decidedAt, compared } = input;
  if (verdictId === null || p === null || decidedAt === null) return null;
  if (!Number.isFinite(p)) return null;

  const trimmedReason = reason === null ? "" : reason.trim();

  return {
    verdictId,
    compared,
    sure: `${String(Math.round(p * 100))}%`,
    decision: DECISION_BY_ACTION[noulAction(p)],
    reason: trimmedReason === "" ? null : trimmedReason,
    decidedAt,
  };
}
