import { WatchlistProofAge } from "~/components/watchlists/watchlist-proof-age";
import { FactRail, type FactRow } from "~/components/evidence/fact-rail";
import { formatConfidenceBandLabel } from "~/lib/landing-page-display";
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
  const rows: FactRow[] = [
    {
      key: "Successful",
      value: String(data.proofSummary.successfulAttempts),
      missingLabel: "none yet",
    },
    {
      key: "Failed",
      value: String(data.proofSummary.failedAttempts),
      missingLabel: "none yet",
    },
    ...(data.proofSummary.skippedAttempts > 0
      ? [
          {
            key: "Skipped",
            value: String(data.proofSummary.skippedAttempts),
          } satisfies FactRow,
        ]
      : []),
    {
      key: "Last good check",
      value: data.proofSummary.lastSuccessfulProofAt ? (
        <WatchlistProofAge
          capturedAt={data.proofSummary.lastSuccessfulProofAt}
          renderedAt={data.renderedAt}
        />
      ) : null,
      missingLabel: "no successful proof capture yet",
    },
  ];

  const recentRows: FactRow[] = data.recentProofCaptures.slice(0, 4).map((capture) => ({
    key: capture.status === "succeeded" ? "Succeeded" : "Attempt",
    value: (
      <>
        {formatConfidenceBandLabel(capture.fieldConfidence)} ·{" "}
        <WatchlistProofAge
          capturedAt={capture.succeededAt ?? capture.attemptedAt}
          renderedAt={data.renderedAt}
        />
      </>
    ),
    missingLabel: "not recorded",
  }));

  return (
    <section aria-label="Evidence freshness" className="f9-evidence-panel">
      <p className="f9-evidence-micro">Recent evidence checks</p>
      <h3 className="f9-evidence-panel-title">Evidence freshness</h3>
      <FactRail rows={rows} title="Summary" />
      {recentRows.length > 0 ? (
        <FactRail rows={recentRows} title="Latest captures" />
      ) : (
        <p className="f9-wk-dim">
          Evidence checks will appear here after the next proof-backed check.
        </p>
      )}
    </section>
  );
}
