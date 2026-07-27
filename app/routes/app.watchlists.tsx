import { useEffect, useState } from "react";
import {
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { CopyButton } from "~/components/copy-button";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { TertiaryAction } from "~/components/evidence/cta";
import { SpecimenEmptyState } from "~/components/evidence/specimen-empty-state";
import { BulkSelectBar } from "~/components/watchlists/bulk-select-bar";
import { CompetitorDetail } from "~/components/watchlists/competitor-detail";
import { WatchBoard, toWatchBoardBandSummaries } from "~/components/watchlists/watch-board";
import { WatchBoardStatus } from "~/components/watchlists/watch-board-status";
import { WatchBoardTicker } from "~/components/watchlists/watch-board-ticker";
import { toCustomerDiscoveryStatus } from "~/lib/discovery-customer-copy";
import {
  isSlackDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { formatNextScanLabel } from "~/lib/schedule-display";
import type { WatchlistRunRecord } from "~/lib/types";
import { countHardFailuresSinceLastSuccess } from "~/lib/watchlist-detail-display";
import {
  resolveWatchlistDetailTab,
  WATCHLIST_DETAIL_TAB_PARAM,
} from "~/lib/watchlist-detail-tabs";
import {
  buildWatchBoardTickerItems,
  firstScanPollingKey,
  resolveEmptyWatchlistEventCopy,
  resolveWatchlistListScanPresentation,
  resolveWatchlistRunCustomerError,
  resolveWatchlistRunTiming,
  resolveWatchlistTrackingPresentation,
  summarizeWatchBoard,
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

export const meta = () => [{ title: "Competitors | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Competitors" />;
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

export default function WatchlistsRoute() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  // Tabs are navigation, not state (brief §6.4/§11): the active panel is read
  // off the URL, so deep links, the back button and SSR all agree.
  const activeTab = resolveWatchlistDetailTab(searchParams.get(WATCHLIST_DETAIL_TAB_PARAM));

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
  const showSlackDelivery = isSlackDeliveryCustomerFacing();
  const canExport = canUsePlanFeature(data.plan, "export_csv") && canUsePlanFeature(data.plan, "export_json");
  const canReport = canUsePlanFeature(data.plan, "client_reports");
  const canShare = canUsePlanFeature(data.plan, "share_links");
  const canRefresh = data.plan !== "free";
  // Toolbar de-gauntlet: collapse every locked action into ONE upgrade nudge
  // instead of stacking a separate "Upgrade for X" button beside each real
  // action. Computed from the same capability flags, so paid tiers keep every
  // real button and never see this.
  const lockedToolbarCapabilities = [
    !canReport ? "reports" : null,
    !canExport ? "exports" : null,
    !canShare ? "sharing" : null,
    data.selectedWatchlist?.isActive && !canRefresh ? "fresh checks" : null,
  ].filter((label): label is string => label !== null);
  const lockedToolbarUpgradeLabel =
    lockedToolbarCapabilities.length === 0
      ? null
      : lockedToolbarCapabilities.length === 1
        ? `Upgrade to unlock ${lockedToolbarCapabilities[0]}`
        : `Upgrade to unlock ${lockedToolbarCapabilities
            .slice(0, -1)
            .join(", ")} & ${lockedToolbarCapabilities[lockedToolbarCapabilities.length - 1]}`;
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
  // WP-C2 Beat 3 — only carry the Wire arc during the first-run window, i.e.
  // before any competitor in the workspace has ever completed a scan (its first
  // readable brief). Derived from existing records; no parallel status source.
  const firstRunWindow = !data.watchlists.some((watchlist) =>
    Boolean(watchlist.lastScannedAt),
  );

  // ---- watch board (brief §6.1, §6.3, §7) --------------------------------
  const captureWindow = data.captureWindow ?? {
    endDate: data.renderedAt.slice(0, 10),
    windowDays: 30,
    days: {},
    capturedChanges: {},
    totalCapturedChanges: 0,
    failedChecks: {},
  };
  const boardBands = toWatchBoardBandSummaries(
    data.watchlists,
    captureWindow.capturedChanges,
    captureWindow.failedChecks,
  );
  const boardSummary = summarizeWatchBoard(boardBands);
  const hasCompetitors = boardBands.length > 0;
  const nextScanLabel = formatNextScanLabel(
    data.plan,
    renderedAt,
    data.effectiveDeliveryConfig.timezone,
  );
  /**
   * One pause/resume control, used by every band and by the opened
   * competitor's action row. `aria-busy` and the pending label are per
   * watchlist — a reviewer's finding on BL-006: the old detail button lit up
   * whenever ANY band was pausing. The disabled state stays global on purpose:
   * there is a single fetcher, so a second submit would cancel the first.
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

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        {hasCompetitors ? (
          <WatchBoardTicker
            items={buildWatchBoardTickerItems(boardBands, captureWindow.windowDays)}
          />
        ) : null}

        {/* No Rank-1 here: the workspace shell's "+ Add competitor" already
            carries this screen's one action, and two ink primaries 200px
            apart is the collision brief §5 forbids. Zero Rank-1s on a screen
            is legitimate (cta.tsx §5). The empty state below still carries
            one, because the shell button is the only other way in. */}
        <DashboardPageHeader
          kicker="Monitoring"
          lead="Monitor competitor ads over time and get alerted when messaging, creative, or landing pages change."
          title="Competitors"
        />

      {actionData?.message ? (
        <p
          aria-live="polite"
          className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}
          role="status"
        >
          {actionData.ok && actionData.message.startsWith("http") ? (
            <>
              <a href={actionData.message} rel="noreferrer" target="_blank">
                {actionData.message}
              </a>{" "}
              <CopyButton value={actionData.message} />
            </>
            ) : (
              actionData.message
            )}
          {!actionData.ok && (actionData.error === "plan_limit_exceeded" || actionData.error === "plan_gated") ? (
            <>
              {" "}
              <Link to="/app/billing?source=watchlists#plans">View plans</Link> to unlock this control.
            </>
          ) : null}
        </p>
      ) : null}

      {hasCompetitors ? (
        <>
          {/* Brief §6.3: the status strip is the ONLY place page-level status
              renders. With a competitor open, the page is about that
              competitor, so its strip is the page strip and the workspace
              rollup stands down — two five-cell strips 200px apart was the
              same duplication §6.3 exists to delete. The board surface
              (`/app/watchlists` with nothing open) is unchanged. */}
          {selectedWatchlist ? null : (
            <WatchBoardStatus
              nextScanLabel={nextScanLabel}
              sourceCanSchedule={sourceCanSchedule}
              summary={boardSummary}
              trackingStatusLabel={trackingPresentation.statusLabel}
              windowDays={captureWindow.windowDays}
            />
          )}

          <BulkSelectBar
            onClear={clearBulkSelection}
            onPause={() => submitBulk("pause")}
            onResume={() => submitBulk("resume")}
            pending={bulkPending}
            pendingAction={bulkFetcher.formData?.get("bulkAction")}
            selectedCount={selectedBulkIds.length}
          />

          <WatchBoard
            canReport={canReport}
            captureWindow={captureWindow}
            onToggleSelect={toggleBulkSelection}
            openWatchlistId={data.selectedWatchlist?.id ?? null}
            openWatchlistRun={(data.runs[0] as WatchlistRunRecord | undefined) ?? null}
            pendingWatchlistId={pendingWatchlistId}
            plan={data.plan}
            renderPauseAction={renderPauseAction}
            selectable={data.watchlists.length > 1}
            selectedIds={selectedBulkIds}
            selectionDisabled={bulkPending}
            watchlists={data.watchlists}
          />
        </>
      ) : (
        <SpecimenEmptyState
          copy="Paste your website or a competitor's — we scan their Meta ads and landing page, then email you the moment their offer, creative, or CTA changes."
          headline="Add your first competitor"
          primaryAction={{ label: "Add competitor", to: "/search" }}
          secondaryAction={{ label: "See a sample brief", to: "/#demo" }}
          specimenLabel="BAND 01 — RESERVED"
          stateLabel="WATCH BOARD · NOTHING TRACKED YET"
        />
      )}

      {selectedWatchlist ? (
        <CompetitorDetail
          activeTab={activeTab}
          canConfigureDelivery={canConfigureDelivery}
          canConfigureDigestSettings={canConfigureDigestSettings}
          canEmailDelivery={canEmailDelivery}
          canExport={canExport}
          canInstantAlert={canInstantAlert}
          canRefresh={canRefresh}
          canShare={canShare}
          capturedChanges={captureWindow.capturedChanges[selectedWatchlist.id] ?? 0}
          data={{ ...data, selectedWatchlist }}
          discoveryRecovery={discoveryStatus.recovery ?? null}
          // The board counts hard failures since the last success in SQL; the
          // detail now counts them the same way over the loaded runs, and
          // prefers the board's rollup so one competitor never reports two
          // different failure counts on one page.
          failedChecks={
            captureWindow.failedChecks?.[selectedWatchlist.id] ??
            countHardFailuresSinceLastSuccess(data.runs)
          }
          firstRunWindow={firstRunWindow}
          lockedToolbarUpgradeLabel={lockedToolbarUpgradeLabel}
          nextScanLabel={nextScanLabel}
          renderedAt={renderedAt}
          showSlackDelivery={showSlackDelivery}
          sourceCanSchedule={sourceCanSchedule}
          trackingPresentation={trackingPresentation}
          watchlist={selectedWatchlist}
          windowDays={captureWindow.windowDays}
          checksExpanded={searchParams.get("checks") === "all"}
        />
      ) : null}
      </section>
    </DashboardPage>
  );
}
