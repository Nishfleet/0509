import type { ComponentProps, ReactNode } from "react";
import { Form, Link } from "react-router";

import { CompetitorDossierPanel } from "~/components/competitor-dossier";
import { CreativeWall } from "~/components/creative-wall";
import { SecondaryAction, TertiaryAction } from "~/components/evidence/cta";
import { StatusStrip, type StatusCell } from "~/components/evidence/status-strip";
import { LocalTime } from "~/components/local-time";
import { Pill } from "~/components/pill";
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
} from "~/lib/watchlist-detail-display";
import {
  WATCHLIST_DETAIL_TABS,
  watchlistDetailTabHref,
  type WatchlistDetailTabId,
} from "~/lib/watchlist-detail-tabs";
import {
  buildLastAttemptByEventId,
  resolveWatchBandState,
  type resolveWatchlistTrackingPresentation,
} from "~/lib/watchlist-display";
import { watchlistLiveSearchHref, watchlistSavedAdsHref } from "~/lib/watchlist-links";
import {
  formatWatchlistTargetNoun,
  formatWatchlistTrackingRole,
  normalizeWatchlistTrackingRole,
} from "~/lib/watchlist-role";

/**
 * The opened competitor — brief §6.4 (anchor tab bar), §6.3 (status strip),
 * §6.6 (fact rail), §7 (detail composition).
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
  canShare: boolean;
  canRefresh: boolean;
  canConfigureDelivery: boolean;
  canConfigureDigestSettings: boolean;
  canInstantAlert: boolean;
  canEmailDelivery: boolean;
  showSlackDelivery: boolean;
  lockedToolbarUpgradeLabel: string | null;
  /** URL-driven disclosure for quiet-line collapse (brief §6.7, §11). */
  checksExpanded?: boolean;
}

const RANK2 = "f9-ed-cta f9-ed-cta--rank2";

export function CompetitorDetail(props: CompetitorDetailProps) {
  const { data, watchlist, activeTab } = props;
  const trackingRole = normalizeWatchlistTrackingRole(watchlist.trackingRole);
  const targetNoun = formatWatchlistTargetNoun(trackingRole);
  const deliveryHref = watchlistDetailTabHref(watchlist.id, "delivery");
  const stamp = resolveWatchBandState({
    isActive: watchlist.isActive,
    lastScannedAt: watchlist.lastScannedAt,
    capturedChanges: props.capturedChanges,
    failedChecks: props.failedChecks,
  });
  const latestRun = data.runs[0] ?? null;
  const panelLabel =
    WATCHLIST_DETAIL_TABS.find((tab) => tab.id === activeTab)?.panelLabel ?? "What changed";

  const statusCells: StatusCell[] = [
    {
      key: "State",
      value: (
        <Pill state={stamp.pillState} variant="stamp">
          {stamp.label}
        </Pill>
      ),
    },
    {
      key: "Last check",
      value: watchlist.lastScannedAt ? <LocalTime iso={watchlist.lastScannedAt} /> : null,
      missingLabel: "no completed check yet",
    },
    {
      key: "Next check",
      value: !watchlist.isActive
        ? null
        : props.canRefresh
          ? props.sourceCanSchedule
            ? props.nextScanLabel
            : null
          : `weekly — ${props.nextScanLabel}`,
      missingLabel: !watchlist.isActive
        ? "paused — no checks run"
        : "After source access is ready",
    },
    {
      key: "Ad source",
      value: props.trackingPresentation.statusLabel,
    },
  ];

  const factRows = buildCompetitorFactRows({
    targetLabel: watchlist.targetLabel,
    targetCountry: watchlist.targetCountry,
    trackingRole,
    isActive: watchlist.isActive,
    plan: data.plan,
    createdAt: watchlist.createdAt,
    now: props.renderedAt,
    proofSummary: data.proofSummary,
    storedChanges: data.events.length,
  });

  const deliveryLines = buildCompetitorDeliveryLines({
    emailEnabled: data.effectiveDeliveryConfig.emailEnabled,
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
      className="f9-ed-opened-detail"
      id="competitor-detail"
    >
      {/* §6.1 open state: the detail attaches directly beneath its band, and
          that band already carries the name, the target, the market and the
          watch age. Repeating them here was 105px of mobile scroll saying
          nothing new, so the heading stays for assistive tech only and the
          head is the action line. */}
      <header className="f9-ed-detail-head">
        <h2 className="f9-sr-only">
          {watchlist.name} · {watchlist.targetLabel} ·{" "}
          {formatWatchlistTrackingRole(trackingRole)}
        </h2>
        <div className="f9-ed-action-row">
          {watchlist.isActive && props.canRefresh ? (
            <Form method="post">
              <input name="intent" type="hidden" value="refresh-watchlist" />
              <input name="watchlistId" type="hidden" value={watchlist.id} />
              <SubmitButton className={RANK2} intent="refresh-watchlist" pendingLabel="Scanning live…">
                Refresh now
              </SubmitButton>
            </Form>
          ) : null}
          {/* "Package for client" and pause/resume are NOT repeated here: the
              open band sits directly above and already carries both (§6.1
              right cell). Two identical buttons 60px apart is the toolbar
              gauntlet the audit flagged. */}
          {props.canShare ? (
            <Form method="post">
              <input name="intent" type="hidden" value="share-watchlist" />
              <input name="watchlistId" type="hidden" value={watchlist.id} />
              <SubmitButton
                className="f9-ed-cta f9-ed-cta--rank3"
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
          {props.lockedToolbarUpgradeLabel ? (
            <TertiaryAction to="/app/billing?source=watchlists#plans">
              {props.lockedToolbarUpgradeLabel}
            </TertiaryAction>
          ) : null}
        </div>
      </header>

      <StatusStrip
        action={
          props.sourceCanSchedule && props.trackingPresentation.statusLabel !== "Needs source access"
            ? { label: "Alert delivery", to: deliveryHref }
            : { label: "Source access", to: "/app/source-access" }
        }
        ariaLabel="Competitor status"
        cells={statusCells}
      />

      {watchlist.isActive && !watchlist.lastScannedAt ? (
        <FirstScanBanner plan={data.plan} run={latestRun} watchlistId={watchlist.id} />
      ) : null}

      {props.failedChecks >= 3 ? (
        <div aria-live="assertive" className="f9-message is-error" role="alert">
          <p>
            We're having trouble checking this {targetNoun} — the last {props.failedChecks} checks
            failed. We keep retrying every night; recent errors are listed under Evidence. If this
            persists for a few days, email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll dig
            in.
          </p>
        </div>
      ) : null}

      <DetailTabBar
        activeTab={activeTab}
        capturedChanges={props.capturedChanges}
        watchlistId={watchlist.id}
      />

      <div className="f9-ed-detail-body">
        <div
          aria-label={panelLabel}
          className="f9-ed-detail-main"
          id={`competitor-panel-${activeTab}`}
          role="region"
        >
          {renderPanel(props, { targetNoun })}
        </div>

        <CompetitorRail
          caughtNote={formatCaughtNote({
            capturedChanges: props.capturedChanges,
            windowDays: props.windowDays,
            lastScannedAt: watchlist.lastScannedAt,
            isActive: watchlist.isActive,
          })}
          caughtValue={formatCaughtNumber(props.capturedChanges)}
          deliveryHref={deliveryHref}
          deliveryLines={deliveryLines}
          factRows={factRows}
          windowDays={props.windowDays}
        />
      </div>
    </article>
  );
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
        <WatchlistSetupCard
          data={{ selectedWatchlist: watchlist }}
          selectedTrackingRole={normalizeWatchlistTrackingRole(watchlist.trackingRole)}
        />

        <section aria-label="How tracking works" className="f9-ed-panel">
          <p className="f9-ed-micro">How tracking works</p>
          <h3>{props.trackingPresentation.headline}</h3>
          <p className="f9-muted-copy">{props.trackingPresentation.summary}</p>
          <p className="f9-muted-copy">
            Five to Nine checks public ad signals and shows Recent results when live checks are
            delayed.
          </p>
          {props.discoveryRecovery ? (
            <p className="f9-muted-copy">{props.discoveryRecovery}</p>
          ) : null}
          <div className="f9-ed-action-row">
            <SecondaryAction to="/app/source-access">Check source access</SecondaryAction>
            {data.showPresenceNav ? (
              <TertiaryAction to="/app/presence">Open Presence</TertiaryAction>
            ) : null}
          </div>
        </section>

        <p className="f9-crosslink-row">
          <Link className="f9-text-link" to={watchlistLiveSearchHref(watchlist)}>
            Search their ads live
          </Link>
          <Link className="f9-text-link" to={watchlistSavedAdsHref(watchlist)}>
            Saved ads from this {context.targetNoun}
          </Link>
        </p>
      </>
    );
  }

  if (props.activeTab === "evidence") {
    return (
      <>
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
            <p className="f9-ed-micro">Evidence and delivery</p>
            <h3 style={{ marginTop: 0 }}>Evidence and alerts</h3>
          </div>
        </div>
        <RecentEvidenceChecksCard data={data} />
        <RecentChecksSection
          checksExpanded={props.checksExpanded}
          runs={data.runs}
          watchlistId={watchlist.id}
        />
        <CandidateHistory candidates={data.eventCandidates} />
        <details className="f9-ed-report-glossary">
          <summary className="f9-ed-micro">Evidence labels</summary>
          <ProofGlossary />
        </details>
      </>
    );
  }

  return (
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
  );
}
