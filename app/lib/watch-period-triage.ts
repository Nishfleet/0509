import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
} from "~/lib/types";

/* ============================================================================
   Zero-noise period triage (2026-08-06, zero-noise proof triage packet).

   The shared truthful classification for a watch period. Every surface that
   reports on a period — the digest email, the digest orchestration, and the
   app watchlist record — reads the same status, label, explanation, and
   suppression reasons from this one vocabulary so a buyer sees the same
   story everywhere and a failed check can never be presented as "all
   quiet". A skipped proof capture (budget, rate limit, dedupe) is a benign
   no-work decision — it is not proof pending, so it never blocks an honest
   all-quiet record on its own.

   This module is deliberately NOT `.server`: the app route renders the
   period record in the client bundle, so the classification and its copy
   must be isomorphic. Server callers import it through
   `~/lib/watch-event-evaluator.server`, which re-exports everything here.

   Precedence (the strongest honest claim wins):
     changed            >  confirmed changes exist — show them
     evidence_failed    >  an evidence check failed and proof did not land
     evidence_pending   >  a change was seen but proof has not completed
     routine_only       >  changes were seen but all were suppressed repeats
     all_quiet          >  checks completed and nothing changed
     not_run            >  no check completed in the period
   ========================================================================== */

export const WATCH_PERIOD_TRIAGE_STATUSES = [
  "changed",
  "evidence_failed",
  "evidence_pending",
  "routine_only",
  "all_quiet",
  "not_run",
] as const;

export type WatchPeriodTriageStatus = (typeof WATCH_PERIOD_TRIAGE_STATUSES)[number];

export type WatchPeriodTriageSourceStatus =
  | "checked"
  | "evidence_pending"
  | "evidence_failed"
  | "not_run";

export interface WatchPeriodTriage {
  status: WatchPeriodTriageStatus;
  /** Shared customer-facing headline (sentence case), used verbatim by every surface. */
  label: string;
  /** Shared one-sentence finding, used verbatim by every surface. */
  explanation: string;
  sourceStatus: WatchPeriodTriageSourceStatus;
  /** Last successful check time inside the period, when one is known. */
  checkedAt: string | null;
  checksCompleted: number;
  changesCaptured: number;
  suppressedChanges: number;
  /** Customer-safe suppression reasons (already-reported repeats, etc.). */
  suppressionReasons: string[];
  nextAction: string;
  /** Explicit no-action line; null only when there is genuinely nothing to do and no claim to make. */
  noActionLine: string | null;
}

export interface WatchPeriodTriageInput {
  events: readonly Pick<WatchEventRecord, "status">[];
  candidates: readonly Pick<EventCandidateRecord, "status" | "dedupeReason">[];
  proofCaptures: readonly Pick<ProofCaptureRecord, "status">[];
  successfulRuns: number;
  lastSuccessfulCheckAt: string | null;
}

export function classifyWatchPeriodTriage(
  input: WatchPeriodTriageInput,
): WatchPeriodTriage {
  const base = {
    checkedAt: input.lastSuccessfulCheckAt,
    checksCompleted: input.successfulRuns,
  };

  const eventStatuses = input.events.map((event) => event.status);
  const candidateStatuses = input.candidates.map((candidate) => candidate.status);
  const changesCaptured = eventStatuses.filter(
    (status) => status === "confirmed",
  ).length;
  const suppressedChanges = [...eventStatuses, ...candidateStatuses].filter(
    (status) => status === "suppressed" || status === "invalidated",
  ).length;

  if (changesCaptured > 0) {
    return {
      ...base,
      status: "changed",
      label: "Changes found",
      explanation: "Changes were confirmed across the sources that ran.",
      sourceStatus: "checked",
      changesCaptured,
      suppressedChanges,
      suppressionReasons: [],
      nextAction: "Review the changes in your brief.",
      noActionLine: null,
    };
  }

  const evidenceFailed =
    [...eventStatuses, ...candidateStatuses].some(
      (status) => status === "proof_failed",
    ) || input.proofCaptures.some((capture) => capture.status === "failed");
  if (evidenceFailed) {
    return {
      ...base,
      status: "evidence_failed",
      label: "Proof capture failed",
      explanation:
        "A proof capture couldn't finish, so nothing is confirmed yet.",
      sourceStatus: "evidence_failed",
      changesCaptured: 0,
      suppressedChanges,
      suppressionReasons: [],
      nextAction:
        "We'll retry at the next scheduled check. If it persists, email support and we'll dig in.",
      noActionLine: "No change is confirmed without proof.",
    };
  }

  const evidencePending =
    [...eventStatuses, ...candidateStatuses].some(
      (status) => status === "detected" || status === "proof_pending",
    ) ||
    input.proofCaptures.some((capture) => capture.status === "pending");
  if (evidencePending) {
    return {
      ...base,
      status: "evidence_pending",
      label: "Evidence pending",
      explanation:
        "A possible change was detected, but its proof capture hasn't completed, so nothing is confirmed yet.",
      sourceStatus: "evidence_pending",
      changesCaptured: 0,
      suppressedChanges,
      suppressionReasons: [],
      nextAction: "We're retrying the proof capture. Open watchlists for status.",
      noActionLine: "No change is confirmed until its evidence lands.",
    };
  }

  if (suppressedChanges > 0) {
    const reasons = collectSuppressionReasons(input.candidates);
    const changeNoun = suppressedChanges === 1 ? "change" : "changes";
    return {
      ...base,
      status: "routine_only",
      label: "Routine changes only",
      explanation: `We saw ${suppressedChanges} routine ${changeNoun} and held the alert — ${suppressedChanges === 1 ? "it" : "each one"} repeats a change already reported this period.`,
      sourceStatus: "checked",
      changesCaptured: 0,
      suppressedChanges,
      suppressionReasons: reasons,
      nextAction: "We alert on a change only when it's new.",
      noActionLine: "No action needed — these are repeats, not new moves.",
    };
  }

  if (input.successfulRuns > 0) {
    return {
      ...base,
      status: "all_quiet",
      label: "All quiet",
      explanation: "Checks completed and nothing changed across the sources that ran.",
      sourceStatus: "checked",
      changesCaptured: 0,
      suppressedChanges: 0,
      suppressionReasons: [],
      nextAction: "We check again at the next scheduled scan.",
      noActionLine: "No action needed — nothing new to act on.",
    };
  }

  return {
    ...base,
    status: "not_run",
    label: "Checks didn't run",
    explanation: "No check completed in this period.",
    sourceStatus: "not_run",
    changesCaptured: 0,
    suppressedChanges,
    suppressionReasons: [],
    nextAction:
      "Open watchlists for status — we retry at the next scheduled check.",
    noActionLine: null,
  };
}

function collectSuppressionReasons(
  candidates: readonly Pick<EventCandidateRecord, "status" | "dedupeReason">[],
) {
  const reasons = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.status === "invalidated") {
      reasons.add("Matched the previous snapshot — no real change");
      continue;
    }
    if (candidate.status !== "suppressed") continue;
    if (candidate.dedupeReason === "proof_duplicate") {
      reasons.add("Repeat of a change already reported this period");
    } else if (candidate.dedupeReason === "candidate_duplicate") {
      reasons.add("Duplicate of an earlier change");
    } else {
      reasons.add("Repeated change within the quiet window");
    }
  }
  return [...reasons];
}

/**
 * Persisted shape for a digest run summary (JSON column — no schema change).
 * The triage object is plain JSON-safe data, so the record is stored as-is
 * and replayed verbatim by retries: a routine-only or evidence-failed period
 * never re-renders as an all-quiet heartbeat after recovery.
 */
export function triageToDigestSummary(triage: WatchPeriodTriage) {
  return { triage };
}

export function readTriageFromDigestSummary(
  summary: Record<string, unknown> | null | undefined,
): WatchPeriodTriage | null {
  const value = summary?.triage;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.status !== "string" ||
    !(WATCH_PERIOD_TRIAGE_STATUSES as readonly string[]).includes(
      candidate.status,
    )
  ) {
    return null;
  }
  const status = candidate.status as WatchPeriodTriageStatus;
  const label = readTriageString(candidate.label) ?? "No summary";
  const explanation =
    readTriageString(candidate.explanation) ?? "We couldn't reconstruct this period's summary.";
  return {
    status,
    label,
    explanation,
    sourceStatus:
      readTriageString(candidate.sourceStatus) === "evidence_failed"
        ? "evidence_failed"
        : readTriageString(candidate.sourceStatus) === "evidence_pending"
          ? "evidence_pending"
          : readTriageString(candidate.sourceStatus) === "not_run"
            ? "not_run"
            : "checked",
    checkedAt: readTriageString(candidate.checkedAt) ?? null,
    checksCompleted: readTriageNumber(candidate.checksCompleted),
    changesCaptured: readTriageNumber(candidate.changesCaptured),
    suppressedChanges: readTriageNumber(candidate.suppressedChanges),
    suppressionReasons: Array.isArray(candidate.suppressionReasons)
      ? candidate.suppressionReasons.filter(
          (reason): reason is string =>
            typeof reason === "string" && reason.trim().length > 0,
        )
      : [],
    nextAction:
      readTriageString(candidate.nextAction) ??
      "Review the changes in your brief.",
    noActionLine: readTriageString(candidate.noActionLine) ?? null,
  };
}

function readTriageString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTriageNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}
