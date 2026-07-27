import { FactRail, type FactRow } from "~/components/evidence/fact-rail";
import {
  formatImportanceBandLabel,
  formatWatchEventStatusLabel,
} from "~/lib/landing-page-display";
import type { EventCandidateRecord } from "~/lib/types";

export function CandidateHistory({ candidates }: { candidates: EventCandidateRecord[] }) {
  const rows: FactRow[] = candidates.map((candidate) => ({
    key: formatWatchEventStatusLabel(candidate.status),
    value: `${candidate.title} · ${formatImportanceBandLabel(candidate.importanceScore)}`,
    missingLabel: "not recorded",
  }));

  return (
    <details className="f9-ed-candidate-history">
      <summary className="f9-ed-micro">Candidate history</summary>
      {candidates.length === 0 ? (
        <p className="f9-muted-copy">
          No candidates yet — possible changes appear here before we confirm them.
        </p>
      ) : (
        <FactRail rows={rows} title="Unconfirmed signals" />
      )}
    </details>
  );
}
