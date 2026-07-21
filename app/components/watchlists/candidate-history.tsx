import {
  formatImportanceBandLabel,
  formatWatchEventStatusLabel,
} from "~/lib/landing-page-display";
import type { EventCandidateRecord } from "~/lib/types";

export function CandidateHistory({ candidates }: { candidates: EventCandidateRecord[] }) {
  return (
    <details>
      <summary>Candidate history</summary>
      <div className="f9-work-list is-compact" style={{ marginTop: "1rem" }}>
        {candidates.length === 0 ? (
          <p className="f9-muted-copy">No candidates yet — possible changes appear here before we confirm them.</p>
        ) : (
          candidates.map((candidate) => (
            <div className="f9-work-row" key={candidate.id}>
              <div>
                <h4 style={{ marginBottom: "0.25rem" }}>{candidate.title}</h4>
                <p className="f9-muted-copy">
                  {formatWatchEventStatusLabel(candidate.status)} · {formatImportanceBandLabel(candidate.importanceScore)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </details>
  );
}
