import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { CompetitorImportForm } from "~/components/competitor-import-form";
import type { CompetitorImportFormActionData } from "~/components/competitor-import-form";
import { CopyButton } from "~/components/copy-button";
import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { PartialDataNotice } from "~/components/partial-data-notice";
import { useQuickAdd } from "~/components/quick-add-context";
import { QuietLine } from "~/components/evidence/quiet-line";
import { TertiaryAction } from "~/components/evidence/cta";
import { SubmitButton } from "~/components/submit-button";
import { BulkSelectBar } from "~/components/watchlists/bulk-select-bar";
import { CompetitorDetail } from "~/components/watchlists/competitor-detail";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { useFirstCapturePolling } from "~/components/workspace/use-first-capture-polling";
import { WorkingHeader } from "~/components/workspace/working-header";
import {
  COMPETITOR_FILTER_PARAM,
  COMPETITOR_FILTERS,
  competitorFilterLabel,
  countCompetitorStates,
  filterCompetitorRows,
  formatCompetitorContextLine,
  resolveCompetitorFilter,
  toCompetitorRows,
  type CompetitorRow,
} from "~/lib/competitor-list-display";
import { toCustomerDiscoveryStatus } from "~/lib/discovery-customer-copy";
import {
  isSlackWebhookDeliveryCustomerFacing,
  isTeamsWebhookDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import { canUsePlanFeature, getPlanLimit } from "~/lib/plan-entitlements";
import { formatNextScanLabel } from "~/lib/schedule-display";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRunRecord,
} from "~/lib/types";
import { classifyWatchPeriodTriage } from "~/lib/watch-period-triage";
import { countHardFailuresSinceLastSuccess } from "~/lib/watchlist-detail-display";
import {
  resolveWatchlistDetailTab,
  watchlistDetailTabHref,
  WATCHLIST_DETAIL_TAB_PARAM,
} from "~/lib/watchlist-detail-tabs";
import {
  firstScanPollingKey,
  resolveEmptyWatchlistEventCopy,
  resolveWatchlistListScanPresentation,
  resolveWatchlistRunCustomerError,
  resolveWatchlistRunTiming,
  resolveWatchlistTrackingPresentation,
} from "~/lib/watchlist-display";

// Re-exported for test-facing imports from "~/routes/app.watchlists" (see
// tests/watchlists.route.test.ts). Presentation logic now lives in
// ~/lib/watchlist-display.
export {
  firstScanPollingKey,
  resolveEmptyWatchlistEventCopy,
  resolveWatchlistListScanPresentation,
  resolveWatchlistRunCustomerError,
  resolveWatchlistRunTiming,
  resolveWatchlistTrackingPresentation,
};
// WatchlistProofAge now lives in its own component module; re-exported here for
// the hydration test that imports it from "~/routes/app.watchlists".
export { WatchlistProofAge } from "~/components/watchlists/watchlist-proof-age";

/* ============================================================================
   Zero-noise record (2026-08-06, zero-noise proof triage packet).

   The app surface states the same period classification the digest email
   uses: all quiet is a finding with a checked-at time and a no-action line,
   routine-only changes name their suppression reason, and a failed or
   pending evidence check is never presented as quiet. Copy comes from the
   shared triage vocabulary in ~/lib/watch-event-evaluator.server so the two
   surfaces never diverge.
   ========================================================================== */

export interface WatchlistTriageRecord {
  label: string;
  line: string;
  reasons: string[];
  stampIso: string | null;
}

/**
 * The truthful period record for the opened competitor. Returns null when the
 * change feed already carries the story (confirmed changes), or when an
 * existing surface owns the state (first capture still running / in line).
 */
export function resolveWatchlistTriageRecord(input: {
  events: readonly WatchEventRecord[];
  candidates: readonly EventCandidateRecord[];
  runs: readonly WatchlistRunRecord[];
  proofCaptures: readonly ProofCaptureRecord[];
  lastScannedAt: string | null;
}): WatchlistTriageRecord | null {
  const latestRun = input.runs[0] ?? null;
  if (latestRun && (latestRun.status === "running" || latestRun.status === "pending")) {
    // The first-capture banner and the change feed already own these states.
    return null;
  }
  if (latestRun && (latestRun.status === "failed" || latestRun.status === "skipped")) {
    return {
      label: "Latest check didn't complete",
      line: "The latest check didn't complete. We're retrying — open Recent checks for what happened and what runs next.",
      reasons: [],
      stampIso: null,
    };
  }
  const succeededRuns = input.runs.filter((run) => run.status === "succeeded");
  const lastSuccessfulCheckAt =
    succeededRuns.reduce<string | null>((latest, run) => {
      if (!run.finishedAt) return latest;
      return !latest || run.finishedAt > latest ? run.finishedAt : latest;
    }, null) ?? input.lastScannedAt;
  const triage = classifyWatchPeriodTriage({
    events: input.events,
    candidates: input.candidates,
    proofCaptures: input.proofCaptures,
    successfulRuns: succeededRuns.length,
    lastSuccessfulCheckAt,
  });
  if (triage.status === "changed") {
    // The change feed renders the confirmed changes with their evidence.
    return null;
  }
  const line = [triage.explanation, triage.noActionLine ?? triage.nextAction]
    .filter(Boolean)
    .join(" ");
  return {
    label: triage.label,
    line,
    reasons: triage.suppressionReasons,
    stampIso: triage.checkedAt,
  };
}

export const meta = () => [{ title: "Watch | Five to Nine" }];

function resolveSafeShareLink(message: unknown): { href: string; label: string } | null {
  if (typeof message !== "string") return null;

  try {
    const url = new URL(message);
    const token = url.pathname.slice("/share/".length);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.pathname.startsWith("/share/") ||
      !token ||
      token.includes("/") ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }

    // Keep navigation same-origin even if a malformed action response contains
    // an absolute host. The server-generated message remains the copy value.
    return { href: `${url.pathname}${url.search}`, label: message };
  } catch {
    return null;
  }
}

export function HydrateFallback() {
  return <DashboardRouteLoading title="Watch" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

/**
 * Loader and action live in server modules (BL-007). The route kept growing
 * past the 800-line ceiling as the competitor detail grew; both were moved
 * verbatim, and the dynamic import keeps them out of the client bundle
 * exactly as the inline `await import(...)` calls did.
 */
export async function loader(args: LoaderFunctionArgs) {
  const { loadWatchlistsRoute } = await import("~/lib/watchlist-route-loader.server");
  return loadWatchlistsRoute(args);
}

export async function action(args: ActionFunctionArgs) {
  const { handleWatchlistsAction } = await import("~/lib/watchlist-route-actions.server");
  return handleWatchlistsAction(args);
}

/**
 * BL-030 — Competitors, rebuilt in the landing language (concept v4).
 *
 * The page is a list of nine records and a peek pane. What went, and why:
 * the ticker (triple-redundant with the rows and the context line), the
 * five-cell status strip (five numbers shouting at once), the per-band
 * capture histogram (the same fact is one line of text), the state stamps,
 * the boxed chips and every 2-2.5px "cut" rule. One rule weight survives:
 * 1px. Character is spent in four places only — the Bricolage title, the
 * Bricolage competitor names, the single green mark in the detail pane, and
 * the motion curves. Behaviour, loaders and actions are untouched.
 */
export default function WatchlistsRoute() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const importedCountParam = searchParams.get("imported");
  const importedCount =
    importedCountParam && /^\d+$/.test(importedCountParam)
      ? Number.parseInt(importedCountParam, 10)
      : null;
  // Tabs are navigation, not state (brief §6.4/§11): the active panel is read
  // off the URL, so deep links, the back button and SSR all agree.
  const activeTab = resolveWatchlistDetailTab(searchParams.get(WATCHLIST_DETAIL_TAB_PARAM));
  const activeFilter = resolveCompetitorFilter(searchParams.get(COMPETITOR_FILTER_PARAM));

  // WP-24: email deep-links land on ?event= — scroll/focus that row once.
  useEffect(() => {
    const eventId = data.highlightedEventId?.trim();
    if (!eventId) {
      return;
    }
    const node = document.getElementById(`event-${eventId}`);
    if (!node) {
      return;
    }
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    if (node instanceof HTMLElement) {
      node.focus({ preventScroll: true });
    }
  }, [data.highlightedEventId, data.selectedWatchlist?.id]);
  const renderedAt = new Date(data.renderedAt);
  const discoveryStatus = toCustomerDiscoveryStatus(data.discoveryStatus);
  const routeActionData = useActionData<typeof action>();
  const importActionData = routeActionData as CompetitorImportFormActionData | undefined;
  // WP-42: pause/resume runs through a fetcher so the row shows its own
  // pending state instead of lighting up the global route progress bar.
  const pauseResumeFetcher = useFetcher<typeof action>();
  // Workflow-friction pass: bulk pause/resume from the competitors list.
  const bulkFetcher = useFetcher<typeof action>();
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [latestFeedbackSource, setLatestFeedbackSource] = useState<
    "route" | "fetcher" | "bulk" | null
  >(null);
  useEffect(() => {
    if (routeActionData) setLatestFeedbackSource("route");
  }, [routeActionData]);
  useEffect(() => {
    if (pauseResumeFetcher.data) setLatestFeedbackSource("fetcher");
  }, [pauseResumeFetcher.data]);
  useEffect(() => {
    if (bulkFetcher.data) setLatestFeedbackSource("bulk");
    if (bulkFetcher.state === "idle" && bulkFetcher.data?.ok) {
      setSelectedBulkIds([]);
    }
  }, [bulkFetcher.data, bulkFetcher.state]);
  const actionData =
    latestFeedbackSource === "bulk"
      ? bulkFetcher.data
      : latestFeedbackSource === "fetcher"
        ? pauseResumeFetcher.data
        : routeActionData;
  const bulkPending = bulkFetcher.state !== "idle";
  const clearBulkSelection = () => setSelectedBulkIds([]);
  const toggleBulkSelection = (watchlistId: string) => {
    setSelectedBulkIds((previous) =>
      previous.includes(watchlistId)
        ? previous.filter((id) => id !== watchlistId)
        : [...previous, watchlistId],
    );
  };
  const submitBulk = (bulkAction: "pause" | "resume") => {
    if (selectedBulkIds.length === 0 || bulkPending) {
      return;
    }
    const formData = new FormData();
    formData.set("intent", "bulk-watchlists");
    formData.set("bulkAction", bulkAction);
    for (const watchlistId of selectedBulkIds) {
      formData.append("watchlistIds", watchlistId);
    }
    bulkFetcher.submit(formData, { method: "post" });
  };
  const pauseResumePending = pauseResumeFetcher.state !== "idle";
  const showSlackDelivery = isSlackWebhookDeliveryCustomerFacing();
  const showTeamsDelivery = isTeamsWebhookDeliveryCustomerFacing();
  const canExport = canUsePlanFeature(data.plan, "export_csv") && canUsePlanFeature(data.plan, "export_json");
  const canReport = canUsePlanFeature(data.plan, "client_reports");
  const canShare = canUsePlanFeature(data.plan, "share_links");
  const canRefresh = data.plan !== "free";
  // The deep view has one upgrade story, not a separate gate beside every
  // locked control. The same capability flags still decide which local
  // controls exist; this list only writes the quiet explanation.
  const lockedCapabilities = [
    !canReport ? "reports" : null,
    !canExport ? "exports" : null,
    !canShare ? "sharing" : null,
    data.selectedWatchlist?.isActive && !canRefresh ? "fresh checks" : null,
  ].filter((label): label is string => label !== null);
  const canManageWorkspaceDelivery = data.canManageDelivery ?? true;
  // Full delivery config (extra targets, channels) stays paid-only; free
  // owners still manage their weekly digest email settings below.
  const canConfigureDelivery = canManageWorkspaceDelivery && data.plan !== "free";
  const canConfigureDigestSettings =
    canManageWorkspaceDelivery && canUsePlanFeature(data.plan, "weekly_digest");
  const canInstantAlert = canUsePlanFeature(data.plan, "high_priority_alerts");
  const canEmailDelivery = canUsePlanFeature(data.plan, "email_delivery");
  const navigation = useNavigation();
  const trackingPresentation = resolveWatchlistTrackingPresentation(
    discoveryStatus,
    data.runs,
    data.proofSummary,
  );
  const sourceCanSchedule = discoveryStatus.status !== "demo" && discoveryStatus.status !== "disabled";
  const pendingWatchlistId =
    navigation.location?.pathname === "/app/watchlists"
      ? new URLSearchParams(navigation.location.search).get("watchlist")
      : null;

  const captureWindow = data.captureWindow ?? {
    endDate: data.renderedAt.slice(0, 10),
    windowDays: 30,
    days: {},
    capturedChanges: {},
    totalCapturedChanges: 0,
    failedChecks: {},
  };
  const rows = useMemo(() => {
    const resolved = toCompetitorRows({
        watchlists: data.watchlists,
        capturedChanges: captureWindow.capturedChanges,
        failedChecks: captureWindow.failedChecks,
        windowDays: captureWindow.windowDays,
      });
    if (!data.captureWindowDegraded) return resolved;
    return resolved.map((row) =>
      row.isActive
        ? {
            ...row,
            statusLabel: "Recent totals unavailable",
            statusTone: "quiet" as const,
            line: "Recent change and failed-check totals are unavailable. Refresh to try again.",
          }
        : row,
    );
  }, [
    data.watchlists,
    data.captureWindowDegraded,
    captureWindow.capturedChanges,
    captureWindow.failedChecks,
    captureWindow.windowDays,
  ]);
  const filterCounts = countCompetitorStates(rows);
  const visibleRows = data.captureWindowDegraded
    ? rows
    : filterCompetitorRows(rows, activeFilter);
  const hasCompetitors = rows.length > 0;
  const activeWatchlistCount = data.watchlists.filter((watchlist) => watchlist.isActive).length;
  const watchlistPlanLimit = getPlanLimit(data.plan, "watchlists");
  const hasWatchlistCapacity = activeWatchlistCount < watchlistPlanLimit;
  const nextScanLabel = formatNextScanLabel(
    data.plan,
    renderedAt,
    data.effectiveDeliveryConfig.timezone,
  );
  const selectable = data.watchlists.length > 1;
  const quickAdd = useQuickAdd();
  useFirstCapturePolling(
    data.watchlists.some((watchlist) => watchlist.isActive && !watchlist.lastScannedAt),
  );

  /**
   * The filter tabs are links, so they are back-button correct and shareable.
   * Every other param on the URL — the opened competitor, its tab, an emailed
   * `?event=` — survives a filter change untouched.
   */
  const filterHref = (filter: string) => {
    const params = new URLSearchParams(searchParams);
    if (filter === "all") {
      params.delete(COMPETITOR_FILTER_PARAM);
    } else {
      params.set(COMPETITOR_FILTER_PARAM, filter);
    }
    const query = params.toString();
    return query ? `/app/watchlists?${query}` : "/app/watchlists";
  };

  /**
   * One pause/resume control, used by the opened competitor's action row.
   * `aria-busy` and the pending label are per watchlist — a reviewer's
   * finding on BL-006: the old detail button lit up whenever ANY band was
   * pausing. The disabled state stays global on purpose: there is a single
   * fetcher, so a second submit would cancel the first.
   */
  const renderPauseAction = (watchlist: (typeof data.watchlists)[number]) => {
    const bandPending =
      pauseResumePending && pauseResumeFetcher.formData?.get("watchlistId") === watchlist.id;
    return (
      <pauseResumeFetcher.Form method="post">
        <input
          name="intent"
          type="hidden"
          value={watchlist.isActive ? "pause-watchlist" : "resume-watchlist"}
        />
        <input name="watchlistId" type="hidden" value={watchlist.id} />
        <TertiaryAction aria-busy={bandPending || undefined} disabled={pauseResumePending} type="submit">
          {bandPending
            ? watchlist.isActive
              ? "Pausing…"
              : "Resuming…"
            : watchlist.isActive
              ? "Pause watching"
              : "Resume watching"}
        </TertiaryAction>
      </pauseResumeFetcher.Form>
    );
  };

  const selectedWatchlist = data.selectedWatchlist;
  const triageRecord = selectedWatchlist
    ? resolveWatchlistTriageRecord({
        events: data.events,
        candidates: data.eventCandidates,
        runs: data.runs,
        proofCaptures: data.recentProofCaptures,
        lastScannedAt: selectedWatchlist.lastScannedAt,
      })
    : null;
  const selectedStatusLabel = selectedWatchlist
    ? rows.find((row) => row.id === selectedWatchlist.id)?.statusLabel ??
      (selectedWatchlist.isActive ? "Watching" : "Paused")
    : null;
  const selectedCapturedChanges = selectedWatchlist
    ? captureWindow.capturedChanges[selectedWatchlist.id] ?? 0
    : 0;
  const selectedFailedChecks = selectedWatchlist
    ? captureWindow.failedChecks?.[selectedWatchlist.id] ?? countHardFailuresSinceLastSuccess(data.runs)
    : 0;
  const selectedHeaderAction = !selectedWatchlist ? null : !selectedWatchlist.isActive ? (
    <pauseResumeFetcher.Form method="post">
      <input name="intent" type="hidden" value="resume-watchlist" />
      <input name="watchlistId" type="hidden" value={selectedWatchlist.id} />
      <SubmitButton
        className="f9-wk-btn"
        disabled={pauseResumePending}
        intent="resume-watchlist"
        match={{ watchlistId: selectedWatchlist.id }}
        pending={
          pauseResumePending &&
          pauseResumeFetcher.formData?.get("watchlistId") === selectedWatchlist.id
        }
        pendingLabel="Resuming…"
      >
        Resume watching
      </SubmitButton>
    </pauseResumeFetcher.Form>
  ) : lockedCapabilities.length > 0 ? (
    <Link className="f9-wk-btn" to="/app/billing?source=watchlists#plans">
      Upgrade plan
    </Link>
  ) : canRefresh ? (
    <Form method="post">
      <input name="intent" type="hidden" value="refresh-watchlist" />
      <input name="watchlistId" type="hidden" value={selectedWatchlist.id} />
      <SubmitButton
        className="f9-wk-btn"
        intent="refresh-watchlist"
        pendingLabel="Checking…"
      >
        Refresh now
      </SubmitButton>
    </Form>
  ) : null;
  const actionShareLink = actionData?.ok ? resolveSafeShareLink(actionData.message) : null;

  return (
    <DashboardPage className={`f9-wk-page${selectedWatchlist ? " f9-watchdetail-page" : ""}`}>
      <WorkingHeader
        action={
          selectedWatchlist
            ? null
            : quickAdd
              ? {
                  label: "Add competitor",
                  onClick: quickAdd.open,
                  "aria-haspopup": "dialog",
                  "aria-keyshortcuts": "Meta+K Control+K",
                }
              : { label: "Add competitor", to: "/search" }
        }
        actionSlot={selectedHeaderAction}
        context={
          selectedWatchlist ? (
            <>
              <Link className="f9-watchdetail-back" to="/app/watchlists">
                All competitors
              </Link>
              <span aria-hidden="true"> &rsaquo; </span>
              {selectedWatchlist.targetLabel} · {selectedStatusLabel} ·{" "}
              {sourceCanSchedule &&
              trackingPresentation.statusLabel !== "Needs source access" ? (
                trackingPresentation.statusLabel
              ) : (
                <Link
                  className="f9-wk-lnk f9-wk-lnk--quiet"
                  to="/app/source-access"
                >
                  {trackingPresentation.statusLabel}
                </Link>
              )}
              {!selectedWatchlist.isActive && lockedCapabilities.length > 0 ? (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    className="f9-wk-lnk f9-wk-lnk--quiet"
                    to="/app/billing?source=watchlists#plans"
                  >
                    Upgrade plan
                  </Link>
                </>
              ) : null}
            </>
          ) : data.captureWindowDegraded && rows.length > 0 ? (
            `${rows.length} ${rows.length === 1 ? "competitor" : "competitors"}. Recent totals are unavailable.`
          ) : (
            formatCompetitorContextLine({ rows, windowDays: captureWindow.windowDays })
          )
        }
        title={selectedWatchlist?.name ?? "Watch"}
      />

      {data.captureWindowDegraded && (hasCompetitors || selectedWatchlist) ? (
        <PartialDataNotice message="Recent change and failed-check totals could not be loaded. Aggregate counts are unavailable; saved evidence and management controls remain available." />
      ) : null}

      {hasCompetitors && !selectedWatchlist && !data.captureWindowDegraded ? (
        <div className="f9-wk-tabs" role="navigation" aria-label="Filter competitors by state">
          {COMPETITOR_FILTERS.map((filter) => (
            <Link
              aria-current={filter === activeFilter ? "page" : undefined}
              className={`f9-wk-tab${filter === activeFilter ? " is-on" : ""}`}
              key={filter}
              prefetch="intent"
              to={filterHref(filter)}
            >
              {competitorFilterLabel(filter)}
              <span className="f9-wk-tab-n">{filterCounts[filter]}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {actionData?.message ? (
        <FeedbackStrip
          label={actionData.ok ? "Done" : "Not done"}
          tone={actionData.ok ? "ok" : "bad"}
        >
          {actionShareLink ? (
            <>
              <a href={actionShareLink.href} rel="noreferrer" target="_blank">
                {actionShareLink.label}
              </a>{" "}
              <CopyButton value={actionShareLink.label} />
            </>
          ) : (
            actionData.message
          )}
          {!actionData.ok &&
          (actionData.error === "plan_limit_exceeded" || actionData.error === "plan_gated") ? (
            <>
              {" "}
              <Link to="/app/billing?source=watchlists#plans">View plans</Link> to unlock this
              control.
            </>
          ) : null}
        </FeedbackStrip>
      ) : null}

      {importedCount ? (
        <FeedbackStrip label="Done" tone="ok">
          Imported {importedCount} {importedCount === 1 ? "competitor" : "competitors"}.
        </FeedbackStrip>
      ) : null}

      {selectedWatchlist ? (
        // A failed capture-window rollup must not read as a believable zero.
        // The record stays mounted and keeps every control; the degraded flag
        // masks only the surfaces that rollup feeds.
        <div
          className={`f9-watchdetail-record${data.captureWindowDegraded ? " is-capture-window-degraded" : ""}`}
        >
          {data.captureWindowDegraded ? (
            <p className="f9-watchdetail-aggregate-unavailable" role="status">
              Recent aggregate totals are unavailable. Saved check history and management controls
              below are still available.
            </p>
          ) : null}
          {/* Zero-noise record: the period's truthful finding sits above the
              feed. Quiet is a finding (checked at, nothing changed, no action
              needed); suppressed repeats and failed or pending evidence are
              stated, never hidden. */}
          {triageRecord ? (
            <QuietLine
              stamp={
                triageRecord.stampIso ? (
                  <LocalTime iso={triageRecord.stampIso} />
                ) : null
              }
              copy={
                <>
                  <strong>{triageRecord.label}</strong> — {triageRecord.line}
                  {triageRecord.reasons.length > 0 ? (
                    <>
                      {" "}
                      Held back: {triageRecord.reasons.join("; ")}.
                    </>
                  ) : null}
                </>
              }
            />
          ) : null}
          <CompetitorDetail
            activeTab={activeTab}
            canConfigureDelivery={canConfigureDelivery}
            canConfigureDigestSettings={canConfigureDigestSettings}
            canEmailDelivery={canEmailDelivery}
            canExport={canExport}
            canInstantAlert={canInstantAlert}
            canRefresh={canRefresh}
            canReport={canReport}
            canShare={canShare}
            capturedChanges={data.captureWindowDegraded ? 0 : selectedCapturedChanges}
            captureWindowDegraded={data.captureWindowDegraded}
            data={{ ...data, selectedWatchlist }}
            discoveryRecovery={discoveryStatus.recovery ?? null}
            // The board counts hard failures since the last success in SQL; the
            // detail uses the same rollup so one competitor never reports two
            // different failure counts on one page.
            failedChecks={selectedFailedChecks}
            lockedCapabilities={lockedCapabilities}
            nextScanLabel={nextScanLabel}
            renderedAt={renderedAt}
            showSlackDelivery={showSlackDelivery}
            showTeamsDelivery={showTeamsDelivery}
            sourceCanSchedule={sourceCanSchedule}
            trackingPresentation={trackingPresentation}
            watchlist={selectedWatchlist}
            windowDays={captureWindow.windowDays}
            pauseAction={renderPauseAction(selectedWatchlist)}
            checksExpanded={searchParams.get("checks") === "all"}
          />
        </div>
      ) : hasCompetitors ? (
        <>
          <BulkSelectBar
            onClear={clearBulkSelection}
            onPause={() => submitBulk("pause")}
            onResume={() => submitBulk("resume")}
            pending={bulkPending}
            pendingAction={bulkFetcher.formData?.get("bulkAction")}
            selectedCount={selectedBulkIds.length}
          />

          <div className="f9-wk-split is-single">
            <div className="f9-wk-split-list">
              <RuledList aria-label="Competitors" flush>
                {visibleRows.map((row) => (
                  <RuledRow
                    key={row.id}
                    lead={
                      selectable ? (
                        <label>
                          <span className="f9-sr-only">Select {row.name}</span>
                          <input
                            checked={selectedBulkIds.includes(row.id)}
                            disabled={bulkPending}
                            onChange={() => toggleBulkSelection(row.id)}
                            type="checkbox"
                          />
                        </label>
                      ) : null
                    }
                    name={row.name}
                    off={!row.isActive}
                    pending={pendingWatchlistId === row.id}
                    say={row.line}
                    selected={false}
                    status={row.statusLabel}
                    statusTone={row.statusTone}
                    time={
                      row.lastScannedAt ? (
                        <LocalTime iso={row.lastScannedAt} mode="date" />
                      ) : (
                        "—"
                      )
                    }
                    to={watchlistDetailTabHref(row.id)}
                  />
                ))}
                {visibleRows.length === 0 ? (
                  <p className="f9-wk-empty-filter">
                    No competitor is in this state right now.{" "}
                    <Link to={filterHref("all")}>Show all {filterCounts.all}</Link>.
                  </p>
                ) : null}
              </RuledList>
            </div>
          </div>
        </>
      ) : (
        /* An empty board is not an occasion for a dimmed specimen panel with
           a caps-mono "BAND 01 — RESERVED" plate: that is the v3 ornament
           habit, and a customer who has nothing tracked needs a sentence and
           a way in, not a diagram of the thing they do not have yet. The
           page's one filled button already sits in the header. */
        <section aria-labelledby="competitors-empty-title" className="f9-wk-sec">
          <p className="f9-wk-kick" id="competitors-empty-title">
            Nothing tracked yet
          </p>
          <p className="f9-wk-lede">
            Add your first competitor and its first check starts immediately. We scan
            their Meta ads and their landing page, then email you the moment their
            offer, creative, or CTA changes.
          </p>
          <div className="f9-wk-acts">
            <Link className="f9-wk-lnk" to="/#demo">
              See a proof brief <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        </section>
      )}

      {/* Q5: bulk competitor import lives on the board, not only in onboarding.
          One click to expand the paste/CSV details, a second to preview — the
          import path itself is the existing `app/lib/competitor-import.ts`. */}
      {!selectedWatchlist ? (
        <CompetitorImportForm
          actionData={importActionData}
          hasWatchlistCapacity={hasWatchlistCapacity}
          importSurface="watchlists"
          upgradePath="/app/billing?source=watchlists#plans"
        />
      ) : null}

      {/* PR-5a: Presence lives inside Watch — an entity is a tracked thing,
          not a parallel product. The deep merge lands with the Watch
          rebuild; until then this is the doorway. */}
      {data.showPresenceNav && !selectedWatchlist ? (
        <section aria-labelledby="watch-presence-title" className="f9-wk-sec">
          <p className="f9-wk-kick" id="watch-presence-title">
            Your brand
          </p>
          <RuledList aria-label="Presence tracking">
            <RuledRow
              name="Presence"
              say="Track your own brand and entities across declared sources."
              status="Included"
              time=""
              to="/app/presence"
            />
          </RuledList>
        </section>
      ) : null}

      <div className="f9-wk-opline">
        <span>
          {rows.length} {rows.length === 1 ? "competitor" : "competitors"}
        </span>
        <span>Next check {nextScanLabel}</span>
        {/* The deep view compresses source health into its working-header
            context. The board keeps it here, linked only when access blocks
            the next check. */}
        {selectedWatchlist ? null : sourceCanSchedule &&
          trackingPresentation.statusLabel !== "Needs source access" ? (
            <span>{trackingPresentation.statusLabel}</span>
          ) : (
            <span>
              <Link className="f9-wk-lnk f9-wk-lnk--quiet" to="/app/source-access">
                {trackingPresentation.statusLabel}
              </Link>
            </span>
          )}
      </div>
    </DashboardPage>
  );
}
