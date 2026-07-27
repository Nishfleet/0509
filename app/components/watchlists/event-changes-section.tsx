import { LocalTime } from "~/components/local-time";
import { SecondaryAction } from "~/components/evidence/cta";
import { DiffPlate, type DiffCapture } from "~/components/evidence/diff-plate";
import { QuietLine, QuietLineList, type QuietLineItem } from "~/components/evidence/quiet-line";
import { SpecimenEmptyState } from "~/components/evidence/specimen-empty-state";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import type { PublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";
import {
  formatConfidenceBandLabel,
  formatDeliveryAttemptStatusLabel,
  formatImportanceBandLabel,
  formatWatchEventStatusLabel,
  formatWatchEventTypeLabel,
} from "~/lib/landing-page-display";
import { formatNextScanLabel } from "~/lib/schedule-display";
import type {
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRunRecord,
} from "~/lib/types";
import { watchlistDetailTabHref } from "~/lib/watchlist-detail-tabs";
import {
  formatRunEventTypes,
  formatRunSummary,
  resolveEmptyWatchlistEventCopy,
  resolveWatchlistRunTiming,
} from "~/lib/watchlist-display";

/**
 * Change feed — brief §6.5 diff plates, §6.7 quiet lines, §6.8 specimen empty
 * state, §8 proof architecture (two timestamps or no diff).
 */

export function formatCaughtStamp(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `CAUGHT ${day} · ${time} UTC`;
}

export function diffFieldLabel(event: WatchEventRecord): string {
  const kind = event.metadata?.kind;
  if (kind === "creative_copy") return "CREATIVE COPY";
  if (kind === "baseline") return "BASELINE";
  switch (event.eventType) {
    case "landing_page_offer_changed":
      return "OFFER";
    case "landing_page_headline_changed":
      return "HEADLINE";
    case "landing_page_cta_changed":
      return "CTA";
    case "landing_page_form_changed":
      return "FORM";
    case "landing_page_url_changed":
      return "DESTINATION";
    case "ad_new":
      return "NEW AD";
    case "ad_inactive":
      return "AD STATUS";
    default:
      return formatWatchEventTypeLabel(event.eventType).toUpperCase();
  }
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolvePriorProofCapture(
  capture: ProofCaptureRecord | null,
  captures: readonly ProofCaptureRecord[],
): ProofCaptureRecord | null {
  if (!capture) return null;
  const sameTarget = captures
    .filter((entry) => entry.proofTargetId === capture.proofTargetId && entry.status === "succeeded")
    .sort((left, right) =>
      (right.succeededAt ?? right.attemptedAt).localeCompare(left.succeededAt ?? left.attemptedAt),
    );
  const index = sameTarget.findIndex((entry) => entry.id === capture.id);
  return index >= 0 ? (sameTarget[index + 1] ?? null) : (sameTarget[1] ?? null);
}

export function resolveEventDiffCaptures(input: {
  event: WatchEventRecord;
  proofCapture: ProofCaptureRecord | null;
  priorProofCapture: ProofCaptureRecord | null;
  runsById: Map<string, WatchlistRunRecord>;
}): { before: DiffCapture; now: DiffCapture } {
  const from = readMetadataString(input.event.metadata, "from");
  const to = readMetadataString(input.event.metadata, "to");
  const nowAt =
    input.proofCapture?.succeededAt ??
    input.proofCapture?.attemptedAt ??
    input.event.confirmedAt ??
    input.event.createdAt;
  const baselineRun = input.event.baselineFromRunId
    ? input.runsById.get(input.event.baselineFromRunId) ?? null
    : null;
  const beforeAt =
    input.priorProofCapture?.succeededAt ??
    input.priorProofCapture?.attemptedAt ??
    baselineRun?.finishedAt ??
    baselineRun?.startedAt ??
    null;

  return {
    before: {
      capturedAt: beforeAt,
      value: from ?? input.event.title,
      quote: from ?? null,
      note: input.priorProofCapture ? `capture ${input.priorProofCapture.id.slice(0, 8)}` : null,
    },
    now: {
      capturedAt: nowAt,
      value: to ?? input.event.title,
      quote: to ?? null,
      note: input.proofCapture ? `capture ${input.proofCapture.id.slice(0, 8)}` : null,
    },
  };
}

export function buildQuietCheckItems(runs: readonly WatchlistRunRecord[]): QuietLineItem[] {
  return runs
    .filter(
      (run) =>
        run.status === "running" ||
        run.status === "pending" ||
        (run.finishedAt && (run.status === "succeeded" || run.status === "failed")),
    )
    .map((run) => ({
      id: run.id,
      stamp:
        run.status === "running" || run.status === "pending" ? null : (
          <LocalTime iso={run.finishedAt!} />
        ),
      copy: formatQuietCheckCopy(run),
    }));
}

export function formatQuietCheckCopy(run: WatchlistRunRecord): string {
  if (run.status === "running" || run.status === "pending") {
    return resolveWatchlistRunTiming(run).label;
  }

  if (run.status === "failed") {
    return run.errorMessage?.trim()
      ? `Check failed — ${run.errorMessage.trim()}`
      : "Check failed before it could finish.";
  }

  const eventTypes = formatRunEventTypes(run.summary);
  if (eventTypes) {
    return `Checked. ${eventTypes}.`;
  }

  const summary = formatRunSummary(run.summary);
  if (summary) {
    return `Checked. ${summary}.`;
  }

  return "Checked. Nothing changed.";
}

function checksLoadMoreHref(watchlistId: string): string {
  return `${watchlistDetailTabHref(watchlistId, "changed")}&checks=all`;
}

export function EventChangesSection(props: {
  watchlistId: string;
  data: {
    events: WatchEventRecord[];
    runs: WatchlistRunRecord[];
    selectedWatchlist: { lastScannedAt: string | null; id: string; name: string };
    plan: string;
    effectiveDeliveryConfig: { timezone: string | null };
    highlightedEventId: string | null;
  };
  sourceCanSchedule: boolean;
  renderedAt: Date;
  proofCapturesById: Map<string, ProofCaptureRecord>;
  recentProofCaptures: readonly ProofCaptureRecord[];
  lastAttemptByEventId: Map<string, PublicDeliveryAttemptSummary>;
  checksExpanded?: boolean;
}) {
  const {
    data,
    sourceCanSchedule,
    renderedAt,
    proofCapturesById,
    recentProofCaptures,
    lastAttemptByEventId,
    checksExpanded = false,
  } = props;
  const runsById = new Map(data.runs.map((run) => [run.id, run]));
  const eventRunIds = new Set(data.events.map((event) => event.runId));
  const quietChecks = buildQuietCheckItems(
    data.runs.filter((run) => run.status === "succeeded" && !eventRunIds.has(run.id)),
  );
  const latestRun = (data.runs[0] as WatchlistRunRecord | undefined) ?? null;
  const awaitingFirstCapture =
    !data.selectedWatchlist.lastScannedAt &&
    (latestRun?.status === "running" || latestRun?.status === "pending");

  return (
    <section aria-label="What changed">
      <p className="f9-ed-micro">What changed</p>
      {data.events.length === 0 ? (
        awaitingFirstCapture ? (
          <SpecimenEmptyState
            copy="About ten minutes. We take the ads, the offer page and the price — the before that every future change gets measured against."
            headline="First capture running"
            headingLevel={3}
            primaryAction={{
              label: "Check source access",
              to: "/app/source-access",
            }}
            secondaryAction={{
              label: "Open Evidence",
              to: watchlistDetailTabHref(props.watchlistId, "evidence"),
            }}
            stateLabel={`${data.selectedWatchlist.name.toUpperCase()} · FIRST CAPTURE RUNNING`}
          />
        ) : (
          <QuietLine
            copy={resolveEmptyWatchlistEventCopy({
              lastScannedAt: data.selectedWatchlist.lastScannedAt,
              latestRun,
              nextScanLabel: sourceCanSchedule
                ? formatNextScanLabel(
                    data.plan,
                    renderedAt,
                    data.effectiveDeliveryConfig.timezone,
                  )
                : null,
              plan: data.plan,
            })}
            stamp={
              data.selectedWatchlist.lastScannedAt ? (
                <LocalTime iso={data.selectedWatchlist.lastScannedAt} />
              ) : null
            }
          />
        )
      ) : (
        <div className="f9-ed-change-feed">
          {data.events.map((event) => {
            const proofCapture = event.proofCaptureId
              ? proofCapturesById.get(event.proofCaptureId) ?? null
              : null;
            const priorProofCapture = resolvePriorProofCapture(proofCapture, recentProofCaptures);
            const { before, now } = resolveEventDiffCaptures({
              event,
              proofCapture,
              priorProofCapture,
              runsById,
            });
            const intelligence = buildChangeIntelligenceSummary(
              event,
              data.effectiveDeliveryConfig.timezone,
            );
            const lastAttempt = lastAttemptByEventId.get(event.id) ?? null;
            const caughtAt = now.capturedAt ?? event.confirmedAt ?? event.createdAt;
            const isHighlighted = data.highlightedEventId === event.id;

            const plate = (
              <DiffPlate
                actions={
                  <SecondaryAction to={watchlistDetailTabHref(props.watchlistId, "evidence")}>
                    Open evidence
                  </SecondaryAction>
                }
                before={before}
                caughtLabel={caughtAt ? formatCaughtStamp(caughtAt) : "CHANGE RECORDED"}
                className={isHighlighted ? "is-highlighted" : undefined}
                degradeStamp={
                  caughtAt ? <LocalTime iso={caughtAt} /> : "capture time not recorded"
                }
                field={diffFieldLabel(event)}
                headline={event.title}
                now={now}
                verification={
                  proofCapture
                    ? `${formatConfidenceBandLabel(proofCapture.fieldConfidence)} · VERIFIED`
                    : `${formatImportanceBandLabel(event.importanceScore)} · ${formatWatchEventStatusLabel(event.status).toUpperCase()}`
                }
                why={
                  lastAttempt
                    ? `${event.summary || intelligence.recommendedAction} Last send: ${formatDeliveryAttemptStatusLabel(lastAttempt.status, lastAttempt.channel)} · ${lastAttempt.targetValue}.`
                    : event.summary || intelligence.recommendedAction
                }
              />
            );

            return isHighlighted ? (
              <div id={`event-${event.id}`} key={event.id} tabIndex={-1}>
                {plate}
              </div>
            ) : (
              <div key={event.id}>{plate}</div>
            );
          })}
        </div>
      )}
      {quietChecks.length > 0 ? (
        <QuietLineList
          expanded={checksExpanded}
          items={quietChecks}
          loadMore={{ to: checksLoadMoreHref(props.watchlistId) }}
        />
      ) : null}
    </section>
  );
}
