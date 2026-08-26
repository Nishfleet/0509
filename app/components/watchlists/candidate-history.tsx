import { FactRail, type FactRow } from "~/components/evidence/fact-rail";
import {
  formatImportanceBandLabel,
  formatWatchEventStatusLabel,
} from "~/lib/landing-page-display";
import { resolveSuppressedCandidateRefusal } from "~/lib/run-history-capture-visibility";
import type { EventCandidateRecord } from "~/lib/types";

export function CandidateHistory({ candidates }: { candidates: EventCandidateRecord[] }) {
  const rows: FactRow[] = candidates.map((candidate) => {
    const refusal = resolveSuppressedCandidateRefusal(candidate);
    const detail = refusal
      ? `${candidate.title} · ${refusal.explanation}. No alert sent.`
      : `${candidate.title} · ${formatImportanceBandLabel(candidate.importanceScore)}`;
    return {
      key: formatWatchEventStatusLabel(candidate.status),
      value: detail,
      missingLabel: "not recorded",
    };
  });

  return (
    <details className="f9-evidence-candidate-history">
      <summary className="f9-evidence-micro">Candidate history</summary>
      {candidates.length === 0 ? (
        <p className="f9-wk-dim">
          No candidates yet — possible changes appear here before we confirm them.
        </p>
      ) : (
        <FactRail rows={rows} title="Unconfirmed signals" />
      )}
    </details>
  );
}
