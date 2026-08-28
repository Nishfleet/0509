import { useEffect, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Form, Link } from "react-router";

import { CompetitorDossierPanel } from "~/components/competitor-dossier";
import { CreativeWall } from "~/components/creative-wall";
import { SecondaryAction, TertiaryAction } from "~/components/evidence/cta";
import { ProofGlossary } from "~/components/proof-glossary";
import { SubmitButton } from "~/components/submit-button";
import { WatchlistTrends } from "~/components/watchlist-trends";
import { CandidateHistory } from "~/components/watchlists/candidate-history";
import { CompetitorRail } from "~/components/watchlists/competitor-rail";
import { DeliverySettingsCard } from "~/components/watchlists/delivery-settings-card";
import { DeliveryTargetsSection } from "~/components/watchlists/delivery-targets-section";
import { DetailTabBar } from "~/components/watchlists/detail-tab-bar";
import { EventChangesSection } from "~/components/watchlists/event-changes-section";
import { FirstScanBanner } from "~/components/watchlists/first-scan-banner";
import { RecentChecksSection } from "~/components/watchlists/recent-checks-section";
import { RecentEvidenceChecksCard } from "~/components/watchlists/recent-evidence-checks-card";
import { WatchlistSetupCard } from "~/components/watchlists/watchlist-setup-card";
import type { PublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { WatchlistRecord } from "~/lib/types";
import {
  buildCompetitorDeliveryLines,
  buildCompetitorFactRows,
  formatCaughtNote,
  formatCaughtNumber,
  formatLastCheck,
} from "~/lib/watchlist-detail-display";
import { createReportId } from "~/lib/report";
import {
  WATCHLIST_DETAIL_TABS,
  watchlistDetailTabHref,
  type WatchlistDetailTabId,
} from "~/lib/watchlist-detail-tabs";
import {
  buildLastAttemptByEventId,
  type resolveWatchlistTrackingPresentation,
} from "~/lib/watchlist-display";
import { watchlistLiveSearchHref, watchlistSavedAdsHref } from "~/lib/watchlist-links";
import {
  formatWatchlistTargetNoun,
  formatWatchlistTrackingRole,
  normalizeWatchlistTrackingRole,
} from "~/lib/watchlist-role";

/**
 * The opened competitor — brief §6.4 (anchor tab bar), §6.6 (fact rail),
 * §7 (detail composition), re-adjudicated into the BL-035 working surface.
 *
 * BL-006 turned the list into a board; this is the other half of that split.
 * The detail used to be one 9,814px mobile scroll that stacked the change
 * feed, creative wall, trends, intelligence, glossary, evidence cards,
 * delivery forms, recipient lists, run history and the setup form. It is now
 * five URL-addressable surfaces plus a rail of exactly three objects.
 *
 * Everything that is page STATE — the first-scan arc and a run of failed
 * checks — stays above the tab bar, because state is not a section you can
 * navigate away from.
 */

type DetailData = ComponentProps<typeof EventChangesSection>["data"] &
  ComponentProps<typeof RecentEvidenceChecksCard>["data"] &
  ComponentProps<typeof DeliverySettingsCard>["data"] &
  ComponentProps<typeof DeliveryTargetsSection>["data"] & {
    selectedWatchlist: WatchlistRecord;
    eventCandidates: ComponentProps<typeof CandidateHistory>["candidates"];
    creativeWall: ComponentProps<typeof CreativeWall>["items"];
    trendDailyActivity: ComponentProps<typeof WatchlistTrends>["dailyActivity"];
    dossier: ComponentProps<typeof CompetitorDossierPanel>["dossier"] | null;
    aggression: ComponentProps<typeof CompetitorDossierPanel>["aggression"];
    counterBrief: ComponentProps<typeof CompetitorDossierPanel>["counterBrief"];
    counterBriefLocked: boolean;
    recentDeliveryAttempts: PublicDeliveryAttemptSummary[];
    showPresenceNav: boolean;
    latestRunCaptureAttempts?: ComponentProps<typeof RecentChecksSection>["latestRunCaptureAttempts"];
  };

export interface CompetitorDetailProps {
  data: DetailData;
  watchlist: WatchlistRecord;
  activeTab: WatchlistDetailTabId;
  renderedAt: Date;
  /** Confirmed changes inside the board's capture window (brief §6.2). */
  capturedChanges: number;
  windowDays: number;
  /** Hard failures since the last success — the board's definition (§6.1). */
  failedChecks: number;
  nextScanLabel: string;
  sourceCanSchedule: boolean;
  trackingPresentation: ReturnType<typeof resolveWatchlistTrackingPresentation>;
  discoveryRecovery: string | null;
  canExport: boolean;
  canReport: boolean;
  canShare: boolean;
  canRefresh: boolean;
  canConfigureDelivery: boolean;
  canConfigureDigestSettings: boolean;
  canInstantAlert: boolean;
  canEmailDelivery: boolean;
  showSlackDelivery: boolean;
  showTeamsDelivery: boolean;
  /** Capabilities named by the one page-level upgrade action. */
  lockedCapabilities: string[];
  /** The capture-window rollup failed; aggregate counts must not become zero/quiet. */
  captureWindowDegraded?: boolean;
  /**
   * Pause lives with Monitoring in Setup for an active competitor. Resume is
   * promoted to the page header when paused; the route keeps the fetcher's
   * per-watchlist busy state unchanged in both placements.
   */
  pauseAction?: ReactNode;
  /** URL-driven disclosure for quiet-line collapse (brief §6.7, §11). */
  checksExpanded?: boolean;
}

export function CompetitorDetail(props: CompetitorDetailProps) {
  const { data, watchlist, activeTab } = props;
  const captureWindowDegraded = Boolean(props.captureWindowDegraded);
  const trackingRole = normalizeWatchlistTrackingRole(watchlist.trackingRole);
  const targetNoun = formatWatchlistTargetNoun(trackingRole);
  const deliveryHref = watchlistDetailTabHref(watchlist.id, "delivery");
  const latestRun = data.runs[0] ?? null;
  const panelLabel =
    WATCHLIST_DETAIL_TABS.find((tab) => tab.id === activeTab)?.panelLabel ?? "What changed";

  const factRows = buildCompetitorFactRows({
    targetLabel: watchlist.targetLabel,
    targetCountry: watchlist.targetCountry,
    trackingRole,
    isActive: watchlist.isActive,
    plan: data.plan,
    createdAt: watchlist.createdAt,
    lastScannedAt: watchlist.lastScannedAt,
    lastCheckValue: watchlist.lastScannedAt ? (
      <LiveLastCheck iso={watchlist.lastScannedAt} initialNow={props.renderedAt} />
    ) : null,
    now: props.renderedAt,
    proofSummary: data.proofSummary,
    storedChanges: data.events.length,
  });

  const deliveryLines = buildCompetitorDeliveryLines({
    emailEnabled: data.effectiveDeliveryConfig.emailEnabled,
    canEmailDelivery: props.canEmailDelivery,
    instantEnabled: data.effectiveDeliveryConfig.instantEnabled,
    digestEnabled: data.effectiveDeliveryConfig.digestEnabled,
    quietHours: data.effectiveDeliveryConfig.quietHours ?? null,
    timezone: data.effectiveDeliveryConfig.timezone ?? null,
    targetCount: data.deliveryTargets.length,
    canManageDelivery: data.canManageDelivery,
  });

  return (
    <article
      aria-label={`${watchlist.name} — opened ${targetNoun}`}
      className="f9-watchdetail-detail"
      id="competitor-detail"
    >
      <h2 className="f9-sr-only">
        {watchlist.name} · {watchlist.targetLabel} ·{" "}
        {formatWatchlistTrackingRole(trackingRole)}
      </h2>

      <DetailTabBar
        activeTab={activeTab}
        capturedChanges={props.capturedChanges}
        watchlistId={watchlist.id}
      />

      {watchlist.isActive && !watchlist.lastScannedAt ? (
        <FirstScanBanner plan={data.plan} run={latestRun} watchlistId={watchlist.id} />
      ) : null}

      {props.failedChecks >= 3 ? (
        <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
          <p>
            We're having trouble checking this {targetNoun} — the last {props.failedChecks} checks
            failed. We keep retrying every night; recent errors are listed under Evidence. If this
            persists for a few days, email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll dig
            in.
          </p>
        </div>
      ) : null}

      <div className="f9-wk-split is-wide f9-watchdetail-split">
        <div
          aria-label={panelLabel}
          className="f9-watchdetail-main"
          id={`competitor-panel-${activeTab}`}
          role="region"
        >
          {renderPanel(props, { targetNoun })}
        </div>

        <CompetitorRail
          caughtNote={
            captureWindowDegraded
              ? "Unavailable — refresh to try again. Recent change totals are unavailable."
              : formatCaughtNote({
                  capturedChanges: props.capturedChanges,
                  windowDays: props.windowDays,
                  lastScannedAt: watchlist.lastScannedAt,
                  isActive: watchlist.isActive,
                })
          }
          caughtValue={captureWindowDegraded ? "Unavailable" : formatCaughtNumber(props.capturedChanges)}
          deliveryHref={deliveryHref}
          deliveryLines={deliveryLines}
          factRows={factRows}
          windowDays={props.windowDays}
        />
      </div>
    </article>
  );
}

function LiveLastCheck({ iso, initialNow }: { iso: string; initialNow: Date }) {
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return <time dateTime={iso}>{formatLastCheck(iso, now) ?? "not recorded"}</time>;
}

function renderPanel(props: CompetitorDetailProps, context: { targetNoun: string }): ReactNode {
  const { data, watchlist } = props;

  if (props.activeTab === "creative") {
    return (
      <>
        <CreativeWall items={data.creativeWall} plan={data.plan} />
        <WatchlistTrends
          dailyActivity={data.trendDailyActivity}
          items={data.creativeWall}
          plan={data.plan}
        />
      </>
    );
  }

  if (props.activeTab === "delivery") {
    return (
      <>
        <DeliverySettingsCard
          canConfigureDigestSettings={props.canConfigureDigestSettings}
          canEmailDelivery={props.canEmailDelivery}
          canInstantAlert={props.canInstantAlert}
          data={data}
          showSlackDelivery={props.showSlackDelivery}
          showTeamsDelivery={props.showTeamsDelivery}
          watchlistId={watchlist.id}
        />
        <DeliveryTargetsSection
          canConfigureDelivery={props.canConfigureDelivery}
          canEmailDelivery={props.canEmailDelivery}
          data={data}
          watchlistId={watchlist.id}
        />
      </>
    );
  }

  if (props.activeTab === "setup") {
    return (
      <>
        <section aria-labelledby="competitor-monitoring-title" className="f9-watchdetail-section">
          <h3 id="competitor-monitoring-title">Monitoring</h3>
          <p className="f9-wk-dim">
            {!watchlist.isActive
              ? "Watching is paused. The evidence already on file stays here."
              : props.sourceCanSchedule
                ? `Automatic checks are on. The next one is ${props.nextScanLabel}.`
                : "Automatic checks are waiting for source access. The evidence already on file stays here."}
          </p>
          {watchlist.isActive ? (
            <div className="f9-watchdetail-local-actions">
              {/* Lower paid plans keep Upgrade as the header's Rank-1 action,
                  so their entitled manual refresh settles here as quiet
                  Setup work. Agency uses Refresh in the header and must not
                  duplicate it in this panel. */}
              {props.canRefresh && props.lockedCapabilities.length > 0 ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="refresh-watchlist" />
                  <input name="watchlistId" type="hidden" value={watchlist.id} />
                  <SubmitButton
                    className="f9-evidence-cta f9-evidence-cta--rank3"
                    intent="refresh-watchlist"
                    pendingLabel="Checking…"
                  >
                    Refresh now
                  </SubmitButton>
                </Form>
              ) : null}
              {props.pauseAction}
            </div>
          ) : null}
        </section>

        <WatchlistSetupCard
          data={{ selectedWatchlist: watchlist }}
          selectedTrackingRole={normalizeWatchlistTrackingRole(watchlist.trackingRole)}
        />

        <section aria-label="How tracking works" className="f9-evidence-panel">
          <p className="f9-evidence-micro">How tracking works</p>
          <h3>{props.trackingPresentation.headline}</h3>
          <p className="f9-wk-dim">{props.trackingPresentation.summary}</p>
          <p className="f9-wk-dim">
            {!watchlist.isActive
              ? "Watching is paused. The evidence already on file stays here."
              : props.sourceCanSchedule
                ? `Automatic checks are on. The next one is ${props.nextScanLabel}. Recent results remain available when checks are delayed.`
                : "Automatic checks are waiting for source access. The evidence already on file stays here."}
          </p>
          {props.discoveryRecovery ? (
            <p className="f9-wk-dim">{props.discoveryRecovery}</p>
          ) : null}
          <div className="f9-evidence-action-row">
            <SecondaryAction to="/app/source-access">Check source access</SecondaryAction>
            {data.showPresenceNav ? (
              <TertiaryAction to="/app/presence">Open Presence</TertiaryAction>
            ) : null}
          </div>
        </section>

        <p className="f9-crosslink-row">
          <Link className="f9-wk-lnk" to={watchlistLiveSearchHref(watchlist)}>
            Search their ads live
          </Link>
          <Link className="f9-wk-lnk" to={watchlistSavedAdsHref(watchlist)}>
            Saved ads from this {context.targetNoun}
          </Link>
        </p>
      </>
    );
  }

  if (props.activeTab === "evidence") {
    return (
      <>
        <EvidenceHandoff props={props} />
        {data.dossier ? (
          <CompetitorDossierPanel
            aggression={data.aggression}
            counterBrief={data.counterBrief}
            counterBriefLocked={data.counterBriefLocked}
            dossier={data.dossier}
            watchlistId={watchlist.id}
          />
        ) : null}
        <div className="f9-panel-toolbar">
          <div>
            <p className="f9-evidence-micro">Evidence and delivery</p>
            <h3 className="f9-wk-mt0">Evidence and alerts</h3>
          </div>
        </div>
        <RecentEvidenceChecksCard
          checksExpanded={props.checksExpanded}
          data={data}
          watchlistId={watchlist.id}
        />
        <RecentChecksSection
          checksExpanded={props.checksExpanded}
          runs={data.runs}
          watchlistId={watchlist.id}
          latestRunCaptureAttempts={data.latestRunCaptureAttempts}
        />
        <CandidateHistory candidates={data.eventCandidates} />
        <details className="f9-evidence-report-glossary">
          <summary className="f9-evidence-micro">Evidence labels</summary>
          <ProofGlossary />
        </details>
      </>
    );
  }

  return (
    <>
      <EventChangesSection
        checksExpanded={props.checksExpanded}
        data={data}
        lastAttemptByEventId={buildLastAttemptByEventId(data.recentDeliveryAttempts)}
        proofCapturesById={
          new Map(data.recentProofCaptures.map((capture) => [capture.id, capture]))
        }
        recentProofCaptures={data.recentProofCaptures}
        renderedAt={props.renderedAt}
        sourceCanSchedule={props.sourceCanSchedule}
        watchlistId={watchlist.id}
      />
      <p className="f9-watchdetail-after-panel">
        <Link className="f9-wk-lnk" to={watchlistDetailTabHref(watchlist.id, "evidence")}>
          Open the capture <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
        </Link>
        {props.canReport && watchlist.lastScannedAt ? (
          <Link
            className="f9-wk-lnk"
            to={`/app/reports/${createReportId("watchlist", watchlist.id)}`}
          >
            Package for client
            <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
          </Link>
        ) : null}
      </p>
    </>
  );
}

function EvidenceHandoff({ props }: { props: CompetitorDetailProps }) {
  const { watchlist } = props;
  const lockedCopy =
    props.lockedCapabilities.length > 0
      ? `This plan does not include ${formatCapabilityList(
          props.lockedCapabilities,
        )}. Use Upgrade plan above to compare options.`
      : null;

  return (
    <section aria-labelledby="competitor-handoff-title" className="f9-watchdetail-section">
      <h3 id="competitor-handoff-title">Share this record</h3>
      <p className="f9-wk-dim">
        Send the stored evidence without changing the capture on file.
      </p>
      <div className="f9-watchdetail-local-actions">
        {props.canShare ? (
          <Form method="post">
            <input name="intent" type="hidden" value="share-watchlist" />
            <input name="watchlistId" type="hidden" value={watchlist.id} />
            <SubmitButton
              className="f9-evidence-cta f9-evidence-cta--rank3"
              intent="share-watchlist"
              pendingLabel="Sharing…"
            >
              Share summary
            </SubmitButton>
          </Form>
        ) : null}
        {props.canExport ? (
          <>
            <TertiaryAction href={`/export/watchlist/${watchlist.id}`}>Export CSV</TertiaryAction>
            <TertiaryAction href={`/export/watchlist/${watchlist.id}?format=json`}>
              Export JSON
            </TertiaryAction>
          </>
        ) : null}
        {props.canReport && watchlist.lastScannedAt ? (
          <TertiaryAction
            to={`/app/reports/${createReportId("watchlist", watchlist.id)}`}
          >
            Package for client
          </TertiaryAction>
        ) : null}
      </div>
      {lockedCopy ? <p className="f9-watchdetail-lock-note">{lockedCopy}</p> : null}
    </section>
  );
}

function formatCapabilityList(capabilities: string[]): string {
  if (capabilities.length <= 1) return capabilities[0] ?? "";
  if (capabilities.length === 2) return capabilities.join(" and ");
  return `${capabilities.slice(0, -1).join(", ")}, and ${
    capabilities[capabilities.length - 1]
  }`;
}
