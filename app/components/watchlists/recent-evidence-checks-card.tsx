import { WatchlistProofAge } from "~/components/watchlists/watchlist-proof-age";
import {
  formatConfidenceBandLabel,
  formatProofCaptureStatusLabel,
} from "~/lib/landing-page-display";
import type { ProofCaptureRecord, WatchlistProofSummary } from "~/lib/types";

export function RecentEvidenceChecksCard({
  data,
}: {
  data: {
    proofSummary: WatchlistProofSummary;
    renderedAt: string;
    recentProofCaptures: ProofCaptureRecord[];
  };
}) {
  return (
    <article className="f9-detail-cell">
      <p className="f9-app-kicker">Recent evidence checks</p>
      <h3>Evidence freshness</h3>
      <p className="f9-muted-copy">
        {data.proofSummary.successfulAttempts} successful · {data.proofSummary.failedAttempts} failed
        {data.proofSummary.skippedAttempts > 0
          ? ` · ${data.proofSummary.skippedAttempts} skipped`
          : ""}
      </p>
      <p className="f9-muted-copy">
        {data.proofSummary.lastSuccessfulProofAt ? (
          <>
            Last good evidence check{" "}
            <WatchlistProofAge
              capturedAt={data.proofSummary.lastSuccessfulProofAt}
              renderedAt={data.renderedAt}
            />
          </>
        ) : (
          "No successful evidence check yet."
        )}
      </p>
      <div className="f9-work-list is-compact">
        {data.recentProofCaptures.slice(0, 4).map((capture) => (
          <div className="f9-work-row" key={capture.id}>
            <div>
              <h4 style={{ marginBottom: "0.25rem" }}>
                {formatProofCaptureStatusLabel(capture.status)}
              </h4>
              <p className="f9-muted-copy">
                {formatConfidenceBandLabel(capture.fieldConfidence)} ·{" "}
                <WatchlistProofAge
                  capturedAt={capture.succeededAt ?? capture.attemptedAt}
                  renderedAt={data.renderedAt}
                />
              </p>
            </div>
          </div>
        ))}
        {data.recentProofCaptures.length === 0 ? (
          <p className="f9-muted-copy">Evidence checks will appear here after the next proof-backed check.</p>
        ) : null}
      </div>
    </article>
  );
}
