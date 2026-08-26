import { LocalTime } from "~/components/local-time";
import { QuietLineList } from "~/components/evidence/quiet-line";
import { WatchlistProofAge } from "~/components/watchlists/watchlist-proof-age";
import { FactRail, type FactRow } from "~/components/evidence/fact-rail";
import { formatConfidenceBandLabel, formatProofCaptureStatusLabel } from "~/lib/landing-page-display";
import {
  buildRunHistoryRefusalRows,
  formatRunHistoryRefusalCopy,
  resolveProofCaptureRefusal,
} from "~/lib/run-history-capture-visibility";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistProofSummary,
} from "~/lib/types";
import { watchlistDetailTabHref } from "~/lib/watchlist-detail-tabs";

export function RecentEvidenceChecksCard({
  data,
  watchlistId,
  checksExpanded = false,
}: {
  data: {
    proofSummary: WatchlistProofSummary;
    renderedAt: string;
    recentProofCaptures: ProofCaptureRecord[];
    eventCandidates?: readonly EventCandidateRecord[];
    events?: readonly WatchEventRecord[];
  };
  watchlistId?: string;
  checksExpanded?: boolean;
}) {
  const otherSkipped =
    data.proofSummary.skippedAttempts - data.proofSummary.skippedDueToBudget;
  const refusalRows = buildRunHistoryRefusalRows({
    captures: data.recentProofCaptures,
    candidates: data.eventCandidates,
    events: data.events,
  });
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
    ...(data.proofSummary.skippedDueToBudget > 0
      ? [
          {
            key: "Skipped (plan allowance)",
            value: String(data.proofSummary.skippedDueToBudget),
          } satisfies FactRow,
        ]
      : []),
    ...(otherSkipped > 0
      ? [
          {
            key: "Skipped (other)",
            value: String(otherSkipped),
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

  const recentRows: FactRow[] = data.recentProofCaptures.slice(0, 4).map((capture) => {
    const refusal = resolveProofCaptureRefusal(capture);
    return {
      key: captureStatusKey(capture.status),
      value: (
        <>
          {refusal?.explanation ?? formatConfidenceBandLabel(capture.fieldConfidence)} ·{" "}
          <WatchlistProofAge
            capturedAt={capture.succeededAt ?? capture.attemptedAt}
            renderedAt={data.renderedAt}
          />
        </>
      ),
      missingLabel: "not recorded",
    };
  });

  return (
    <section aria-label="Evidence freshness" className="f9-evidence-panel">
      <p className="f9-evidence-micro">Recent proof captures</p>
      <h3 className="f9-evidence-panel-title">Evidence freshness</h3>
      <FactRail rows={rows} title="Summary" />
      {data.proofSummary.skippedDueToBudget > 0 ? (
        <p className="f9-wk-dim">
          {data.proofSummary.skippedDueToBudget} check
          {data.proofSummary.skippedDueToBudget === 1 ? "" : "s"} skipped because the
          plan allowance was reached. Checks resume when the allowance resets — add a
          credit pack or upgrade the plan to capture more now.
        </p>
      ) : null}
      {refusalRows.length > 0 ? (
        <section aria-label="What we did not alert on">
          <p className="f9-evidence-micro">What we did not alert on</p>
          <QuietLineList
            expanded={checksExpanded}
            items={refusalRows.map((row) => ({
              id: row.id,
              stamp: <LocalTime iso={row.attemptedAt} />,
              copy: formatRunHistoryRefusalCopy(row),
            }))}
            loadMore={
              watchlistId
                ? { to: `${watchlistDetailTabHref(watchlistId, "evidence")}&checks=all` }
                : undefined
            }
          />
        </section>
      ) : null}
      {recentRows.length > 0 ? (
        <FactRail rows={recentRows} title="Latest captures" />
      ) : (
        <p className="f9-wk-dim">
          Proof captures will appear here after the next source-backed check.
        </p>
      )}
    </section>
  );
}

function captureStatusKey(status: ProofCaptureRecord["status"]): string {
  if (status === "succeeded") return "Captured";
  if (status === "failed") return "Failed";
  if (status.startsWith("skipped_")) return "Skipped";
  return formatProofCaptureStatusLabel(status);
}
