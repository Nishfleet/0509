import { useEffect, useMemo, useState } from "react";
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
import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { PartialDataNotice } from "~/components/partial-data-notice";
import { useQuickAdd } from "~/components/quick-add-context";
import { TertiaryAction } from "~/components/evidence/cta";
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
} from "~/lib/competitor-list-display";
import { toCustomerDiscoveryStatus } from "~/lib/discovery-customer-copy";
import {
  isSlackDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { createReportId } from "~/lib/report";
import { formatNextScanLabel } from "~/lib/schedule-display";
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

export const meta = () => [{ title: "Competitors | Five to Nine" }];

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
  const packageForClientAction =
    canReport && selectedWatchlist?.lastScannedAt ? (
      <Link
        className="f9-wk-lnk"
        to={`/app/reports/${createReportId("watchlist", selectedWatchlist.id)}`}
      >
        Package for client <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
      </Link>
    ) : null;
  const actionShareLink = actionData?.ok ? resolveSafeShareLink(actionData.message) : null;

  return (
    <DashboardPage className="f9-wk-page">
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
        context={
          selectedWatchlist ? (
            <>
              <Link className="f9-wk-lnk" to="/app/watchlists">
                All competitors
              </Link>
              <span aria-hidden="true"> &rsaquo; </span>
              {selectedWatchlist.targetLabel} · {selectedStatusLabel} ·{" "}
              {sourceCanSchedule && trackingPresentation.statusLabel !== "Needs source access" ? (
                trackingPresentation.statusLabel
              ) : (
                <Link className="f9-wk-lnk f9-wk-lnk--quiet" to="/app/source-access">
                  {trackingPresentation.statusLabel}
                </Link>
              )}
            </>
          ) : data.captureWindowDegraded && rows.length > 0
            ? `${rows.length} ${rows.length === 1 ? "competitor" : "competitors"}. Recent totals are unavailable.`
            : formatCompetitorContextLine({ rows, windowDays: captureWindow.windowDays })
        }
        title={selectedWatchlist?.name ?? "Competitors"}
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

      {selectedWatchlist ? (
        <div
          className={`f9-wk-record${data.captureWindowDegraded ? " is-capture-window-degraded" : ""}`}
        >
          {data.captureWindowDegraded ? (
            <p className="f9-wk-aggregate-unavailable" role="status">
              Recent aggregate totals are unavailable. Saved check history and management controls
              below are still available.
            </p>
          ) : null}
          <CompetitorDetail
            activeTab={activeTab}
            canConfigureDelivery={canConfigureDelivery}
            canConfigureDigestSettings={canConfigureDigestSettings}
            canEmailDelivery={canEmailDelivery}
            canExport={canExport}
            canInstantAlert={canInstantAlert}
            canRefresh={canRefresh}
            canShare={canShare}
            capturedChanges={data.captureWindowDegraded ? 0 : selectedCapturedChanges}
            captureWindowDegraded={data.captureWindowDegraded}
            data={{ ...data, selectedWatchlist }}
            discoveryRecovery={discoveryStatus.recovery ?? null}
            // The board counts hard failures in SQL; the detail keeps the same
            // rollup while masking only the unavailable capture-window totals.
            failedChecks={selectedFailedChecks}
            lockedToolbarUpgradeLabel={lockedToolbarUpgradeLabel}
            nextScanLabel={nextScanLabel}
            packageForClientAction={packageForClientAction}
            renderedAt={renderedAt}
            showSlackDelivery={showSlackDelivery}
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
              See a sample brief <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        </section>
      )}

      <div className="f9-wk-opline">
        <span>
          {rows.length} {rows.length === 1 ? "competitor" : "competitors"}
        </span>
        <span>Next check {nextScanLabel}</span>
        {/* Source state is told ONCE per screen. With a competitor open its
            own status strip carries it, so the board line stands down rather
            than repeating the same words 400px apart. On the board it stays a
            LINK when something is actually blocking the next check — the
            deleted status strip carried that link, and a label you cannot act
            on is a worse answer than the one we shipped. */}
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
