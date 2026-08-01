import { LocalTime } from "~/components/local-time";
import { SecondaryAction } from "~/components/evidence/cta";
import {
  DiffPlate,
  DIFF_PLATE_DEGRADE_COPY,
  hasCaptureTime,
  type DiffCapture,
} from "~/components/evidence/diff-plate";
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

export const EVENT_DELIVERY_NONE_COPY = "No alert sent for this change yet.";

export const EVENT_CHANGE_SUPPRESSED_COPY =
  "Suppressed. This low-signal change is not shown as a before-and-after.";

export const EVENT_CHANGE_AD_NEW_COPY =
  "Checked. We recorded a new ad. There is no stored before-and-after field to show.";

export const EVENT_CHANGE_BASELINE_COPY =
  "Checked. This is the baseline capture. There is no before-and-after to show.";

export const EVENT_CHANGE_NO_FIELD_DIFF_COPY =
  "Checked. We recorded this change without stored before-and-after field values.";

export function hasStoredDiffFieldValues(event: WatchEventRecord): boolean {
  return Boolean(
    readMetadataString(event.metadata, "from") && readMetadataString(event.metadata, "to"),
  );
}

export function canRenderEventDiffPlate(input: {
  event: WatchEventRecord;
  before: DiffCapture;
  now: DiffCapture;
}): boolean {
  if (!hasStoredDiffFieldValues(input.event)) {
    return false;
  }

  return hasCaptureTime(input.before.capturedAt) && hasCaptureTime(input.now.capturedAt);
}

/**
 * BL-030 round 4 — which event owns the view's ONE green mark.
 *
 * The green fill is the announcement; an archived capture is a record, and
 * records are not highlighted (the same rule that already forbids animating a
 * diff). So exactly one plate in the feed may paint its NOW token green: the
 * NEWEST event that actually renders a diff plate with a before/now mark.
 *
 * This is computed here, where the list is built and the order is known,
 * rather than guessed with a CSS positional selector. Round 3 tried
 * `.f9-ed-change-feed > :first-child` and `.f9-ed-detail-main > .f9-ed-diff-plate:first-of-type`;
 * both missed the live DOM — every event is wrapped in a `<div>`, and the
 * newest event on the release fixture is a suppressed change RECORD with no
 * `<mark>` at all — so the announcement green was dead on this surface and
 * nothing caught it, because the spec asserted a CSS string instead of a
 * painted node.
 *
 * Returns null when no event in the feed carries a mark, which is a real
 * state: a competitor whose only stored changes are suppressed, or scan-native
 * with no before/after field values, announces nothing and shows no green.
 */
export function resolveNewestMarkedEventId(input: {
  events: readonly WatchEventRecord[];
  proofCapturesById: Map<string, ProofCaptureRecord>;
  recentProofCaptures: readonly ProofCaptureRecord[];
  runsById: Map<string, WatchlistRunRecord>;
}): string | null {
  for (const event of input.events) {
    const proofCapture = event.proofCaptureId
      ? input.proofCapturesById.get(event.proofCaptureId) ?? null
      : null;
    const priorProofCapture = resolvePriorProofCapture(
      proofCapture,
      input.recentProofCaptures,
    );
    const { before, now } = resolveEventDiffCaptures({
      event,
      proofCapture,
      priorProofCapture,
      runsById: input.runsById,
    });
    if (canRenderEventDiffPlate({ event, before, now })) {
      return event.id;
    }
  }
  return null;
}

export function resolveEventChangeQuietCopy(input: {
  event: WatchEventRecord;
  hasStoredDiffFields: boolean;
  hasBothCaptureTimes: boolean;
}): string {
  if (input.event.status === "suppressed") {
    return EVENT_CHANGE_SUPPRESSED_COPY;
  }

  if (input.hasStoredDiffFields && !input.hasBothCaptureTimes) {
    return DIFF_PLATE_DEGRADE_COPY;
  }

  if (input.event.metadata?.kind === "baseline") {
    return EVENT_CHANGE_BASELINE_COPY;
  }

  if (input.event.eventType === "ad_new") {
    return EVENT_CHANGE_AD_NEW_COPY;
  }

  if (input.event.eventType === "ad_inactive") {
    return "Checked. We recorded this ad as inactive. There is no stored before-and-after field to show.";
  }

  return EVENT_CHANGE_NO_FIELD_DIFF_COPY;
}

export function formatEventChangeWhy(input: {
  event: WatchEventRecord;
  intelligence: ReturnType<typeof buildChangeIntelligenceSummary>;
}): string {
  return input.event.summary || input.intelligence.recommendedAction;
}

export function formatEventDeliveryLine(
  lastAttempt: PublicDeliveryAttemptSummary | null,
): string {
  return lastAttempt
    ? `Last send: ${formatDeliveryAttemptStatusLabel(lastAttempt.status, lastAttempt.channel, lastAttempt.webhookStatus)} · ${lastAttempt.targetValue}.`
    : EVENT_DELIVERY_NONE_COPY;
}

export function formatPlateVerification(input: {
  event: WatchEventRecord;
  proofCapture: ProofCaptureRecord | null;
  intelligence: ReturnType<typeof buildChangeIntelligenceSummary>;
}): string {
  if (!input.proofCapture) {
    return `${formatImportanceBandLabel(input.event.importanceScore)} · ${formatWatchEventStatusLabel(input.event.status).toUpperCase()}`;
  }

  const confidenceValues = Object.values(input.proofCapture.fieldConfidence ?? {}).filter((value) =>
    Number.isFinite(value),
  );
  if (confidenceValues.length === 0) {
    return (
      input.intelligence.proofTrail ||
      `${formatImportanceBandLabel(input.event.importanceScore)} · ${formatWatchEventStatusLabel(input.event.status).toUpperCase()}`
    );
  }

  return `${formatConfidenceBandLabel(input.proofCapture.fieldConfidence)} · VERIFIED`;
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
      value: from,
      quote: from,
      note: input.priorProofCapture ? `capture ${input.priorProofCapture.id.slice(0, 8)}` : null,
    },
    now: {
      capturedAt: nowAt,
      value: to,
      quote: to,
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
  const newestMarkedEventId = resolveNewestMarkedEventId({
    events: data.events,
    proofCapturesById,
    recentProofCaptures,
    runsById,
  });
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
            const hasStoredDiffFields = hasStoredDiffFieldValues(event);
            const hasBothCaptureTimes =
              hasCaptureTime(before.capturedAt) && hasCaptureTime(now.capturedAt);
            const intelligence = buildChangeIntelligenceSummary(
              event,
              data.effectiveDeliveryConfig.timezone,
            );
            const lastAttempt = lastAttemptByEventId.get(event.id) ?? null;
            const caughtAt = now.capturedAt ?? event.confirmedAt ?? event.createdAt;
            const isHighlighted = data.highlightedEventId === event.id;
            const why = formatEventChangeWhy({ event, intelligence });
            const delivery = formatEventDeliveryLine(lastAttempt);
            const verification = formatPlateVerification({ event, proofCapture, intelligence });
            const actions = (
              <SecondaryAction to={watchlistDetailTabHref(props.watchlistId, "evidence")}>
                Open evidence
              </SecondaryAction>
            );
            const caughtLabel = caughtAt ? formatCaughtStamp(caughtAt) : "CHANGE RECORDED";
            const degradeStamp = caughtAt ? <LocalTime iso={caughtAt} /> : "capture time not recorded";

            // The newest event that actually carries a mark owns the view's one
            // green; every plate below it is a record and renders in ink.
            const isNewestMarked = event.id === newestMarkedEventId;
            const plateClassName =
              [isHighlighted ? "is-highlighted" : null, isNewestMarked ? "is-newest" : null]
                .filter(Boolean)
                .join(" ") || undefined;
            const plate = canRenderEventDiffPlate({ event, before, now }) ? (
              <DiffPlate
                actions={actions}
                before={before}
                caughtLabel={caughtLabel}
                className={plateClassName}
                degradeStamp={degradeStamp}
                delivery={delivery}
                field={diffFieldLabel(event)}
                headline={event.title}
                now={now}
                verification={verification}
                why={why}
              />
            ) : (
              <article
                className={
                  isHighlighted ? "f9-ed-change-record is-highlighted" : "f9-ed-change-record"
                }
              >
                <header className="f9-ed-plate-header f9-ed-micro">
                  <span>
                    {caughtLabel} · {diffFieldLabel(event)}
                  </span>
                  <span className="f9-ed-plate-header-end">{verification}</span>
                </header>
                <div className="f9-ed-diff-body">
                  <h3 className="f9-ed-diff-headline">{event.title}</h3>
                  <p className="f9-ed-diff-why">{why}</p>
                  <p className="f9-ed-diff-delivery">{delivery}</p>
                  <QuietLine
                    copy={resolveEventChangeQuietCopy({
                      event,
                      hasStoredDiffFields,
                      hasBothCaptureTimes,
                    })}
                    stamp={degradeStamp}
                  />
                  <div className="f9-ed-action-row">{actions}</div>
                </div>
              </article>
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
