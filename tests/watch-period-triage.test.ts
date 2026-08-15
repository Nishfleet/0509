import { describe, expect, it } from "vitest";

import {
  classifyWatchPeriodTriage,
  readTriageFromDigestSummary,
  triageToDigestSummary,
} from "~/lib/watch-event-evaluator.server";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
} from "~/lib/types";

/**
 * Zero-noise proof triage (2026-08-06, sealed packet acceptance): the five
 * fixtures — unchanged page, routine-only mutation, meaningful price/CTA
 * mutation, failed evidence, proof pending — classify truthfully, and a
 * failed or pending check can never come back as all quiet. A skipped proof
 * capture is a benign no-work decision and does not by itself force evidence
 * pending (2026-08-06 Grok repair packet).
 */

const CHECKED_AT = "2026-08-06T04:00:00.000Z";

function event(status: WatchEventRecord["status"]): Pick<WatchEventRecord, "status"> {
  return { status };
}

function candidate(
  status: EventCandidateRecord["status"],
  dedupeReason: EventCandidateRecord["dedupeReason"] = null,
): Pick<EventCandidateRecord, "status" | "dedupeReason"> {
  return { status, dedupeReason };
}

function proofCapture(
  status: ProofCaptureRecord["status"],
): Pick<ProofCaptureRecord, "status"> {
  return { status };
}

describe("classifyWatchPeriodTriage", () => {
  it("unchanged page with completed checks is an explicit all-quiet record", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [],
      proofCaptures: [],
      successfulRuns: 3,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("all_quiet");
    expect(triage.label).toBe("All quiet");
    expect(triage.sourceStatus).toBe("checked");
    expect(triage.checkedAt).toBe(CHECKED_AT);
    expect(triage.checksCompleted).toBe(3);
    expect(triage.noActionLine).toBe("No action needed — nothing new to act on.");
    expect(triage.nextAction).toBe("We check again at the next scheduled scan.");
  });

  it("routine-only mutation exposes a truthful suppression reason, never all quiet", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [
        candidate("suppressed", "proof_duplicate"),
        candidate("suppressed", "proof_duplicate"),
      ],
      proofCaptures: [],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("routine_only");
    expect(triage.label).toBe("Routine changes only");
    expect(triage.sourceStatus).toBe("checked");
    expect(triage.suppressedChanges).toBe(2);
    expect(triage.suppressionReasons).toEqual([
      "Repeat of a change already reported this period",
    ]);
    expect(triage.explanation).toContain("held the alert");
    expect(triage.noActionLine).toBe(
      "No action needed — these are repeats, not new moves.",
    );
  });

  it("keeps meaningful price/CTA changes as change events with a next action", () => {
    const triage = classifyWatchPeriodTriage({
      events: [event("confirmed"), event("confirmed")],
      candidates: [candidate("suppressed", "proof_duplicate")],
      proofCaptures: [],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("changed");
    expect(triage.changesCaptured).toBe(2);
    expect(triage.sourceStatus).toBe("checked");
    expect(triage.nextAction).toBe("Review the changes in your brief.");
  });

  it("bare failed proof is evidence-failed with cause-neutral copy, never all quiet", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [],
      proofCaptures: [proofCapture("failed")],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("evidence_failed");
    expect(triage.label).toBe("Proof capture failed");
    expect(triage.sourceStatus).toBe("evidence_failed");
    expect(triage.explanation).toBe(
      "A proof capture couldn't finish, so nothing is confirmed yet.",
    );
    expect(triage.explanation).not.toContain("provider timed out");
    expect(triage.explanation).not.toContain("possible change");
    expect(triage.noActionLine).toBe("No change is confirmed without proof.");
    expect(triage.nextAction).toContain("We'll retry at the next scheduled check");
  });

  it("skipped proof captures alone do not force evidence pending — all quiet stays quiet", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [],
      proofCaptures: [
        proofCapture("skipped_due_to_budget"),
        proofCapture("skipped_due_to_rate_limit"),
        proofCapture("skipped_due_to_dedupe"),
      ],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("all_quiet");
    expect(triage.sourceStatus).toBe("checked");
    expect(triage.explanation).toBe(
      "Checks completed and nothing changed across the sources that ran.",
    );
  });

  it("skipped captures still surface the correct non-quiet status from a real signal", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [candidate("suppressed", "proof_duplicate")],
      proofCaptures: [proofCapture("skipped_due_to_dedupe")],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("routine_only");
    expect(triage.sourceStatus).toBe("checked");
  });

  it("proof-pending detection can never appear as all quiet", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [candidate("proof_pending")],
      proofCaptures: [proofCapture("pending")],
      successfulRuns: 1,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("evidence_pending");
    expect(triage.label).toBe("Evidence pending");
    expect(triage.sourceStatus).toBe("evidence_pending");
    expect(triage.noActionLine).toBe(
      "No change is confirmed until its evidence lands.",
    );
  });

  it("only explicit pending/detected signals classify as evidence pending", () => {
    const pendingCapture = classifyWatchPeriodTriage({
      events: [],
      candidates: [],
      proofCaptures: [proofCapture("pending")],
      successfulRuns: 1,
      lastSuccessfulCheckAt: CHECKED_AT,
    });
    const detectedCandidate = classifyWatchPeriodTriage({
      events: [],
      candidates: [candidate("detected")],
      proofCaptures: [],
      successfulRuns: 1,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(pendingCapture.status).toBe("evidence_pending");
    expect(detectedCandidate.status).toBe("evidence_pending");
  });

  it("a proof_failed candidate remains evidence-failed", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [candidate("proof_failed")],
      proofCaptures: [],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("evidence_failed");
    expect(triage.sourceStatus).toBe("evidence_failed");
    expect(triage.explanation).toBe(
      "A proof capture couldn't finish, so nothing is confirmed yet.",
    );
    expect(triage.explanation).not.toContain("possible change");
  });

  it("confirms the strong claim wins: confirmed changes outrank a failed capture", () => {
    const triage = classifyWatchPeriodTriage({
      events: [event("confirmed")],
      candidates: [candidate("suppressed")],
      proofCaptures: [proofCapture("failed")],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("changed");
  });

  it("reports not_run when no check completed, with an actionable next step", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [],
      proofCaptures: [],
      successfulRuns: 0,
      lastSuccessfulCheckAt: null,
    });

    expect(triage.status).toBe("not_run");
    expect(triage.label).toBe("Checks didn't run");
    expect(triage.sourceStatus).toBe("not_run");
    expect(triage.noActionLine).toBeNull();
    expect(triage.nextAction).toContain("Open watchlists for status");
  });

  it("maps an invalidated candidate to the matched-snapshot reason", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [candidate("invalidated")],
      proofCaptures: [],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    expect(triage.status).toBe("routine_only");
    expect(triage.suppressionReasons).toEqual([
      "Matched the previous snapshot — no real change",
    ]);
  });
});

describe("triage digest-summary serialization", () => {
  it("round-trips the triage through the digest summary JSON record", () => {
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [candidate("suppressed", "proof_duplicate")],
      proofCaptures: [],
      successfulRuns: 2,
      lastSuccessfulCheckAt: CHECKED_AT,
    });

    const summary = triageToDigestSummary(triage);
    expect(readTriageFromDigestSummary(summary)).toEqual(triage);
  });

  it("returns null for legacy summaries without a triage record", () => {
    expect(readTriageFromDigestSummary({ totalEvents: 0 })).toBeNull();
    expect(readTriageFromDigestSummary(null)).toBeNull();
    expect(readTriageFromDigestSummary({ triage: "not-an-object" })).toBeNull();
    expect(
      readTriageFromDigestSummary({ triage: { status: "made_up_status" } }),
    ).toBeNull();
  });
});
