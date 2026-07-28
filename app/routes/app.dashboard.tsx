import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  DashboardPage,
  DashboardPageHeader,
} from "~/components/dashboard-page";
import {
  DashboardRouteError,
  DashboardRouteLoading,
} from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { SetupChecklistCard } from "~/components/setup-checklist-card";
import { SpecimenEmptyState } from "~/components/evidence/specimen-empty-state";
import { DiffPlate } from "~/components/evidence/diff-plate";
import { FactRail } from "~/components/evidence/fact-rail";
import { QuietLine } from "~/components/evidence/quiet-line";
import {
  PrimaryAction,
  SecondaryAction,
  TertiaryAction,
} from "~/components/evidence/cta";
import { LocalTime } from "~/components/local-time";
import { Pill } from "~/components/pill";
import { SubmitButton } from "~/components/submit-button";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { toPublicDeliveryTarget } from "~/lib/delivery-target-public";
import { isSecretishMemoryString } from "~/lib/agent-redaction";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import { buildMarketDeskBrief } from "~/lib/market-desk-brief";
import { pendingBlockingSetupItems } from "~/lib/setup-checklist";
import { buildSearchParams } from "~/lib/normalize";
import { classifyWatchEventSource } from "~/lib/proof-classification";
import { formatNextScanLabel } from "~/lib/schedule-display";
import { formatMachineTokenLabel } from "~/lib/landing-page-display";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { AppEnv } from "~/lib/env.server";
import type {
  AgentActionAuditRecord,
  ProofCaptureRecord,
  WatchEventRecord,
} from "~/lib/types";
import type { WorkspaceReadiness } from "~/lib/workspace-readiness.server";

export const meta = () => [{ title: "Overview | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Overview" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

const COUNTER_MOVE_AUDIT_PAGE_LIMIT = 30;
const COUNTER_MOVE_AUDIT_MAX_PAGES = 10;
const COUNTER_MOVE_FOLLOW_UP_DISPLAY_LIMIT = 3;
const COUNTER_MOVE_FOLLOW_UP_AUDIT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

type OverviewProofPair = {
  eventId: string;
  current: ProofCaptureRecord;
  previous: ProofCaptureRecord | null;
};

type OverviewRunTimestamp = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
};

type ListRecentAgentActionAudits = (
  env: AppEnv,
  userId: string,
  options: {
    actionName?: string | null;
    status?: "succeeded" | null;
    resourceType?: string | null;
    limit?: number;
    offset?: number;
  },
) => Promise<AgentActionAuditRecord[]>;

export function unavailableWorkspaceReadiness(options: {
  workspaceUserId: string;
  isMember: boolean;
  billingOwnerName: string | null;
}): WorkspaceReadiness {
  return {
    status: "attention",
    readyCount: 0,
    totalCount: 0,
    value: {
      hasFirstValue: false,
      hasRecurringPaidCadence: false,
      hasRetainedReadiness: false,
    },
    workspace: {
      ...options,
      canManageBilling: !options.isMember,
    },
    billing: {
      plan: "free",
      billingInterval: null,
      dodoStatus: null,
      nextBillingAt: null,
      planUpdatedAt: null,
      hasPaymentIssue: false,
      proofUsage: {
        used: 0,
        baseLimit: 0,
        extraCredits: 0,
        limit: 0,
        remaining: 0,
        warningLevel: "ok",
        periodStart: null,
        periodEnd: null,
        nextPeriodStart: null,
        includedRemaining: null,
        topUpRemaining: 0,
        topUpRetainedWhileInactive: 0,
        canSpendTopUps: null,
      },
      topUpGrants: [],
    },
    items: [],
    counts: {
      competitors: 0,
      activeWatchlists: 0,
      completedScans: 0,
      noChangeBaselines: 0,
      successfulProofs: 0,
      sentDigests: 0,
      deliveryTargets: 0,
      activeApiKeys: 0,
      actionEnabledApiKeys: 0,
      teamMembers: 0,
      agentMemoryEntries: 0,
      clientRooms: 0,
    },
    nudges: [],
  };
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } =
    await import("~/lib/ad-source.server");
  const { toCustomerDiscoveryStatus } =
    await import("~/lib/discovery-customer-copy");
  const { getEnv } = await import("~/lib/context.server");
  const {
    listCollections,
    listDeliveryTargets,
    listDigests,
    listProofCapturePairsForEventIds,
    listRecentAgentActionAudits,
    listRecentWorkspaceWatchEvents,
    listSavedQueries,
    listWatchlistRunPairsForEventIds,
    getWorkspaceDeliveryConfig,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { getProofUsageSummary } = await import("~/lib/plan.server");
  const { getWorkspaceReadiness } =
    await import("~/lib/workspace-readiness.server");
  const {
    getSuccessfulProofCaptureStatsForUser,
    getSuccessfulRunStatsForUserBetween,
    getUserPlanBillingInfo,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const requestUrl = new URL(request.url);
  const { workspaceUserId, isMember, ownerName } =
    await requireWorkspaceSession(env, request);
  const { listWorkspaceMembers } = await import("~/lib/workspace.server");
  const sectionWarnings: Array<{ section: string; message: string }> = [];
  const optionalSection = async <T,>(
    section: string,
    promise: Promise<T>,
    fallback: T,
  ) => {
    try {
      return await promise;
    } catch {
      sectionWarnings.push({
        section,
        message: "We couldn't load this section.",
      });
      return fallback;
    }
  };
  const overnightSince = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();
  // Single parallel wave: every section query is independent of the others
  // except recentChanges, which only needs the watchlists list to know
  // whether any watchlist is active — so it chains off the same in-flight
  // promise instead of waiting for the whole first wave to settle.
  const watchlistsPromise = listWatchlists(env, workspaceUserId, {
    includeInactive: true,
  });
  const recentEventsPromise = optionalSection(
    "recentChanges",
    watchlistsPromise.then((allWatchlists) =>
      allWatchlists.some((watchlist) => watchlist.isActive)
        ? listRecentWorkspaceWatchEvents(env, workspaceUserId, 8)
        : [],
    ),
    [],
  );
  const overviewEventIdsPromise = recentEventsPromise.then((events) =>
    events.slice(0, 3).map((event) => event.id),
  );
  const recentProofPairsPromise = overviewEventIdsPromise.then((eventIds) =>
    optionalSection(
      "recentProof",
      listProofCapturePairsForEventIds(env, workspaceUserId, eventIds),
      [],
    ),
  );
  const recentEventRunsPromise = overviewEventIdsPromise.then((eventIds) =>
    optionalSection(
      "recentRuns",
      listWatchlistRunPairsForEventIds(env, workspaceUserId, eventIds),
      [],
    ),
  );
  const [
    savedQueries,
    collections,
    watchlists,
    digests,
    metaStatus,
    proofUsage,
    billingInfo,
    workspaceMembers,
    workspaceReadiness,
    counterMoveFollowUps,
    workspaceDeliveryConfig,
    recentEvents,
    recentProofPairs,
    recentEventRuns,
    deliveryTargets,
    overnightStats,
    successfulProofStats,
  ] = await Promise.all([
    optionalSection("savedQueries", listSavedQueries(env, workspaceUserId), []),
    optionalSection("collections", listCollections(env, workspaceUserId), []),
    watchlistsPromise,
    optionalSection("digests", listDigests(env, workspaceUserId), []),
    optionalSection(
      "sourceStatus",
      resolveCommercialAdSourceStatus(env).then(toCustomerDiscoveryStatus),
      toCustomerDiscoveryStatus({
        status: "disabled",
        summary:
          "We couldn't load the source status. Open Source access before relying on fresh results.",
        lastCheckedAt: null,
      }),
    ),
    optionalSection("proofUsage", getProofUsageSummary(env, workspaceUserId), {
      warningLevel: "ok",
      used: 0,
      limit: 0,
      remaining: 0,
      plan: "free",
    } as Awaited<ReturnType<typeof getProofUsageSummary>>),
    getUserPlanBillingInfo(env, workspaceUserId),
    optionalSection("team", listWorkspaceMembers(env, workspaceUserId), []),
    optionalSection(
      "readiness",
      getWorkspaceReadiness(env, workspaceUserId, {
        isMember,
        billingOwnerName: ownerName,
        canManageBilling: !isMember,
      }),
      unavailableWorkspaceReadiness({
        workspaceUserId,
        isMember,
        billingOwnerName: ownerName,
      }),
    ),
    optionalSection(
      "followUps",
      listActionableCounterMoveFollowUps(
        env,
        workspaceUserId,
        listRecentAgentActionAudits,
      ),
      [],
    ),
    optionalSection(
      "deliveryTimezone",
      getWorkspaceDeliveryConfig(env, workspaceUserId),
      null,
    ),
    recentEventsPromise,
    recentProofPairsPromise,
    recentEventRunsPromise,
    optionalSection(
      "delivery",
      listDeliveryTargets(env, workspaceUserId, { limit: 12 }),
      [],
    ),
    optionalSection(
      "overnightStats",
      getSuccessfulRunStatsForUserBetween(
        env,
        workspaceUserId,
        overnightSince,
        new Date().toISOString(),
      ),
      { runs: 0, watchlistsChecked: 0, adsSeen: 0, noChangeRuns: 0 },
    ),
    optionalSection(
      "proofStats",
      getSuccessfulProofCaptureStatsForUser(env, workspaceUserId),
      { count: 0, latestAt: null },
    ),
  ]);
  const recentProofCaptures = recentProofPairs.flatMap((pair) =>
    pair.previous ? [pair.current, pair.previous] : [pair.current],
  );
  const plan = billingInfo.plan;
  const hasPaymentIssue =
    plan !== "free" &&
    (billingInfo.dodoStatus === "payment.failed" ||
      billingInfo.dodoStatus === "subscription.failed" ||
      billingInfo.dodoStatus === "subscription.on_hold");

  return {
    savedQueries,
    collections,
    watchlists,
    digests,
    recentEvents,
    recentProofCaptures,
    recentProofPairs,
    recentEventRuns,
    deliveryTargets: deliveryTargets.map((target) => toPublicDeliveryTarget(target)),
    metaStatus,
    proofUsage,
    overnightStats,
    successfulProofStats,
    workspaceReadiness,
    counterMoveFollowUps,
    plan,
    teamMemberCount: workspaceMembers.filter((member) => {
      if (member.status === "active" || !member.tokenExpiresAt) {
        return true;
      }
      const expiresAt = Date.parse(member.tokenExpiresAt);
      return !Number.isFinite(expiresAt) || expiresAt > Date.now();
    }).length,
    nextScanLabel: (await import("~/lib/schedule-display")).formatNextScanLabel(
      plan,
      new Date(),
      workspaceDeliveryConfig?.timezone,
    ),
    workspaceDeliveryTimezone: workspaceDeliveryConfig?.timezone ?? null,
    hasPaymentIssue,
    sectionWarnings,
    setupPrefillWebsite: requestUrl.searchParams.get("website")?.trim() ?? "",
    setupPrefillCountry: requestUrl.searchParams.get("country")?.trim() ?? "",
  };
}

export async function action(args: ActionFunctionArgs) {
  const { context, request } = args;
  const { getEnv } = await import("~/lib/context.server");
  const { withWorkspace, planLimitExceededActionResult } =
    await import("~/lib/with-workspace.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { createWatchlistWithinLimit, getSavedQuery, touchSavedQueryRun } =
    await import("~/lib/data.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const workspace = await withWorkspace(request, env);
  if (!workspace.ok) {
    return workspace.result;
  }
  const { workspaceUserId } = workspace;
  let setupActionModule:
    | typeof import("~/lib/setup-checklist-action.server")
    | undefined;
  if (
    request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("multipart/form-data")
  ) {
    setupActionModule = await import(
      "~/lib/setup-checklist-action.server"
    );
    const { COMPETITOR_IMPORT_MAX_BYTES } = await import(
      "~/lib/competitor-import"
    );
    if (
      setupActionModule.oversizedMultipartImportMessage(
        request,
        COMPETITOR_IMPORT_MAX_BYTES,
      )
    ) {
      return setupActionModule.handleSetupChecklistAction(args);
    }
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (
    intent === "create-watchlist" ||
    intent === "preview-market-desk-import" ||
    intent === "create-market-desk-import" ||
    intent === "finish"
  ) {
    setupActionModule ??= await import("~/lib/setup-checklist-action.server");
    return setupActionModule.handleSetupChecklistAction(args, formData);
  }

  if (intent === "run-saved-query") {
    const savedQueryId = String(formData.get("savedQueryId") ?? "");
    const savedQuery = await getSavedQuery(env, savedQueryId, workspaceUserId);

    if (!savedQuery) {
      return {
        ok: false,
        intent,
        message: "We couldn't find that saved search. Refresh the page and try again.",
      };
    }

    await touchSavedQueryRun(env, savedQuery.id);
    throw redirect(
      `/search?${buildSearchParams(savedQuery.normalizedQuery).toString()}`,
    );
  }

  if (intent === "track-saved-query") {
    const savedQueryId = String(formData.get("savedQueryId") ?? "");
    const savedQuery = await getSavedQuery(env, savedQueryId, workspaceUserId);

    if (!savedQuery) {
      return {
        ok: false,
        intent,
        message: "We couldn't find that saved search. Refresh the page and try again.",
      };
    }

    const watchlistLimit = await checkPlanLimit(
      env,
      workspaceUserId,
      "watchlists",
    );
    const { requireVerifiedEmailForRetention, emailUnverifiedActionResult } =
      await import("~/lib/email-verification.server");
    const verification = await requireVerifiedEmailForRetention(
      env,
      workspaceUserId,
    );
    if (!verification.ok) {
      return { ...emailUnverifiedActionResult(), intent };
    }

    const result = await createWatchlistWithinLimit(
      env,
      workspaceUserId,
      {
        name: `${savedQuery.name} watch`,
        targetType: "saved_query",
        targetId: savedQuery.id,
        targetFingerprint: savedQuery.fingerprint,
        targetLabel: savedQuery.name,
        targetCountry: savedQuery.normalizedQuery.filters.country,
      },
      watchlistLimit.limit,
    );

    if (result.status === "over_cap") {
      return {
        ...planLimitExceededActionResult({
          limit: result.limit,
          current: result.current,
          message:
            result.limit <= 1
              ? "Free includes 1 watchlist with a weekly check and weekly email brief. Upgrade for 3–6 hour checks and more competitors."
              : "You've reached your competitor tracking limit — pause another watchlist first.",
        }),
        intent,
      };
    }

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    const watchlist = result.watchlist;
    let firstScanQueued = false;
    try {
      firstScanQueued = await queueFirstWatchlistScan(env, cloudflare?.ctx, watchlist);
    } catch {
      return {
        ok: true,
        intent,
        message: `Now tracking ${savedQuery.name}. The activation scan hit a delay, so we're retrying it automatically — open Competitors to follow along.`,
      };
    }

    return {
      ok: true,
      intent,
      message: firstScanQueued
        ? `Now tracking ${savedQuery.name}. The activation scan starts now, then free checks weekly; paid plans check every 3–6 hours.`
        : `Now tracking ${savedQuery.name}. Open Competitors for the latest activation scan status.`,
    };
  }

  if (intent === "close-counter-move") {
    const { closeCounterMoveFollowUp } = await import("~/lib/data.server");
    const auditId = String(formData.get("auditId") ?? "").trim();
    const eventId = String(formData.get("eventId") ?? "").trim();
    if (!auditId || !eventId) {
      return {
        ok: false,
        intent,
        message: "We couldn't mark that follow-up done. Refresh and try again.",
      };
    }

    const result = await closeCounterMoveFollowUp(env, {
      auditId,
      eventId,
      userId: workspaceUserId,
    });

    if (!result.ok) {
      return {
        ok: false,
        intent,
        message: "That follow-up is no longer open.",
      };
    }

    return { ok: true, intent, message: "Marked done." };
  }

  return {
    ok: false,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

export default function AppDashboardRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const collections = data.collections ?? [];
  const watchlists = data.watchlists ?? [];
  const digests = data.digests ?? [];
  const recentEvents = data.recentEvents ?? [];
  const recentProofCaptures = data.recentProofCaptures ?? [];
  const recentProofPairs = data.recentProofPairs ?? [];
  const recentEventRuns = data.recentEventRuns ?? [];
  const proofUsage = data.proofUsage ?? {
    warningLevel: "ok",
    used: 0,
    limit: 0,
    remaining: 0,
    plan: "free",
  };
  const plan = data.plan ?? "free";
  const nextScanLabel =
    data.nextScanLabel ??
    formatNextScanLabel(plan, new Date(), data.workspaceDeliveryTimezone);
  const hasPaymentIssue = Boolean(data.hasPaymentIssue);
  const competitorCount = watchlists.length;
  const activeWatchlists = watchlists.filter(
    (watchlist) => watchlist.isActive,
  ).length;
  const visibleRecentEvents = activeWatchlists > 0 ? recentEvents : [];
  const recentSuccessfulProofs = recentProofCaptures.filter(
    (capture) => capture.status === "succeeded",
  ).length;
  const successfulProofs =
    data.successfulProofStats?.count ?? recentSuccessfulProofs;
  const counterMoveFollowUps = data.counterMoveFollowUps ?? [];
  const workspaceReadiness = data.workspaceReadiness;
  const readinessUnavailable =
    data.sectionWarnings?.some((warning) => warning.section === "readiness") ??
    false;
  const recentChangesUnavailable =
    data.sectionWarnings?.some(
      (warning) => warning.section === "recentChanges",
    ) ?? false;
  const allActiveWatchlistsHaveScanHistory =
    activeWatchlists > 0 &&
    watchlists
      .filter((watchlist) => watchlist.isActive)
      .every((watchlist) => Boolean(watchlist.lastScannedAt));
  const proofHistoryUnavailable =
    data.sectionWarnings?.some((warning) => warning.section === "recentProof") ??
    false;
  const runHistoryUnavailable =
    data.sectionWarnings?.some((warning) => warning.section === "recentRuns") ??
    false;
  const readinessGaps = workspaceReadiness
    ? pendingBlockingSetupItems(workspaceReadiness)
    : [];
  const hasBlockingSetupGaps =
    readinessUnavailable || readinessGaps.length > 0;
  const retentionMoves = (workspaceReadiness?.nudges ?? []).filter(
    (nudge) => nudge.priority !== "low",
  );
  const marketDeskBrief = buildMarketDeskBrief({
    watchlists,
    recentEvents: visibleRecentEvents,
    counterMoveFollowUps,
    digests,
    proofUsage,
    overnightStats: data.overnightStats,
    successfulProofCount: successfulProofs,
    nextScanLabel,
    plan,
    sourceStatus: data.metaStatus?.status,
  });
  const statusCards = marketDeskBrief.metrics;
  const hasDashboardMetrics = marketDeskBrief.hasMetrics;
  const overviewMetrics = statusCards
    .filter((card) => card.label !== "Moves found")
    .slice(0, 3);
  const sourceNeedsRecovery =
    Boolean(data.metaStatus) && data.metaStatus?.status !== "healthy";

  return (
    <DashboardPage className="f9-overview">
      <section className="f9-app-stack">
        <DashboardPageHeader
          kicker={
            <>
              <WakeGreeting /> · Overview · {marketDeskBrief.kicker}
            </>
          }
          lead={marketDeskBrief.summary}
          title={marketDeskBrief.title}
        />

        {data.sectionWarnings?.length ? (
          <article aria-live="polite" className="f9-ed-panel f9-overview-notice" role="status">
            <p className="f9-app-kicker">Partial overview</p>
            <h2>We couldn't load part of this overview</h2>
            <p className="f9-muted-copy">
              Everything shown here is current. Refresh to load the rest.
            </p>
          </article>
        ) : null}

        {hasPaymentIssue ? (
          <article className="f9-checkout-banner is-pending" aria-live="polite">
            <div>
              <span className="f9-app-kicker">Payment issue</span>
              <h2>Your last renewal payment didn't go through.</h2>
              <p>
                Billing reported a payment issue. Review the current status and
                payment method from your provider receipt, or email{" "}
                <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll help
                before anything is interrupted.
              </p>
            </div>
            <div className="f9-checkout-banner-actions">
              <SecondaryAction to="/app/billing">
                Plan &amp; billing
              </SecondaryAction>
            </div>
          </article>
        ) : null}

        {readinessUnavailable ? (
          <div id="setup-checklist">
            <SpecimenEmptyState
              copy="The workspace is still available, but setup progress could not be checked. Retry before assuming activation is complete."
              headline="Setup status is temporarily unavailable"
              primaryAction={{
                label: "Retry setup status",
                href: "/app?retrySetup=1#setup-checklist",
              }}
              specimenLabel="SETUP CHECKS — RETRY REQUIRED"
              stateLabel="SETUP · STATUS UNAVAILABLE"
            />
          </div>
        ) : workspaceReadiness ? (
          <SetupChecklistCard
            actionData={actionData}
            prefillCountry={data.setupPrefillCountry}
            prefillWebsite={data.setupPrefillWebsite}
            readiness={workspaceReadiness}
          />
        ) : null}

        {digests.length > 0 && hasBlockingSetupGaps ? (
          <div className="f9-overview-setup-companion">
            <SecondaryAction to="/app/digests?firstrun=1">
              Read latest brief
            </SecondaryAction>
          </div>
        ) : null}

        <section aria-labelledby="overview-changes-title" className="f9-overview-section">
          <header className="f9-overview-section-head">
            <div>
              <span className="f9-app-kicker">Latest stored changes</span>
              <h2 id="overview-changes-title">What changed</h2>
            </div>
            {visibleRecentEvents.length > 0 ? (
              <SecondaryAction to="/app/watchlists">Open competitors</SecondaryAction>
            ) : null}
          </header>
          {visibleRecentEvents.length > 0 ? (
            <div className="f9-overview-change-list">
              {visibleRecentEvents.slice(0, 3).map((event) => (
                <OverviewChangePlate
                  event={event}
                  key={event.id}
                  proofHistoryUnavailable={proofHistoryUnavailable}
                  proofPairs={recentProofPairs}
                  runHistoryUnavailable={runHistoryUnavailable}
                  runs={recentEventRuns}
                />
              ))}
            </div>
          ) : (
            <QuietLine
              copy={
                recentChangesUnavailable
                  ? "Change history is temporarily unavailable. Refresh before deciding that the latest check was quiet."
                  : activeWatchlists === 0 && competitorCount > 0
                    ? "Monitoring is paused. Resume a competitor before expecting a new check."
                  : allActiveWatchlistsHaveScanHistory
                    ? "Every active competitor has scan history. No change events are filed in the recent feed."
                  : competitorCount > 0
                    ? "The first check is still pending for at least one active competitor. Changes will appear after a successful scan."
                  : "Nothing filed yet — add a competitor and the first capture starts the evidence trail."
              }
              stamp="Latest check"
            />
          )}
        </section>

        {retentionMoves.length > 0 ? (
          <article className="f9-ed-panel f9-overview-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Next moves</span>
                <h2>Keep your overview useful</h2>
              </div>
            </div>
            <div className="f9-work-list is-compact">
              {retentionMoves.slice(0, 4).map((nudge) => (
                <article className="f9-work-row" key={nudge.id}>
                  <div>
                    <h3>{nudge.title}</h3>
                    <p className="f9-muted-copy">{nudge.detail}</p>
                  </div>
                  <SecondaryAction to={nudge.href}>
                    Open
                  </SecondaryAction>
                </article>
              ))}
            </div>
          </article>
        ) : null}

        <ActionFeedback data={actionData} intent="close-counter-move" />
        {counterMoveFollowUps.length > 0 ? (
          <article className="f9-ed-panel f9-overview-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Follow-ups</span>
                <h2>Responses waiting on you</h2>
              </div>
              <SecondaryAction to="/app/watchlists">
                Review changes
              </SecondaryAction>
            </div>
            <div className="f9-work-list is-compact">
              {counterMoveFollowUps.map((followUp) => (
                <article className="f9-work-row" key={followUp.id}>
                  <div>
                    <h3>
                      {followUp.watchlistId ? (
                        <Link
                          to={`/app/watchlists?watchlist=${followUp.watchlistId}`}
                        >
                          {followUp.title}
                        </Link>
                      ) : (
                        followUp.title
                      )}
                    </h3>
                    <p className="f9-muted-copy">
                      {followUp.ownerLabel} · {followUp.channelLabel}
                      {followUp.expiresAt ? (
                        <>
                          {" "}
                          · expires{" "}
                          <LocalTime iso={followUp.expiresAt} mode="date" />
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="f9-inline-actions">
                    {followUp.eventId ? (
                      <Form method="post">
                        <input
                          name="intent"
                          type="hidden"
                          value="close-counter-move"
                        />
                        <input
                          name="auditId"
                          type="hidden"
                          value={followUp.id}
                        />
                        <input
                          name="eventId"
                          type="hidden"
                          value={followUp.eventId}
                        />
                        <SubmitButton
                          className="f9-ed-cta f9-ed-cta--rank3"
                          intent="close-counter-move"
                          match={{ auditId: followUp.id }}
                          pendingLabel="Saving…"
                        >
                          Mark done
                        </SubmitButton>
                      </Form>
                    ) : null}
                    <Pill>
                      {followUp.status === "needs_review"
                        ? `${followUp.openCount} open`
                        : formatMachineTokenLabel(followUp.status)}
                    </Pill>
                  </div>
                </article>
              ))}
            </div>
          </article>
        ) : null}

        {proofUsage.warningLevel !== "ok" ? (
          <article
            className={`f9-ed-panel f9-proof-usage-alert is-${proofUsage.warningLevel}`}
          >
            <div>
              <span className="f9-app-kicker">Evidence usage</span>
              <h2>
                {proofUsage.warningLevel === "exhausted"
                  ? "You've used all your evidence checks"
                  : "You've used over 80% of your evidence checks"}
              </h2>
            </div>
            <p>
              {proofUsage.used} of {proofUsage.limit} checks used in the current
              billing period.
              {proofUsage.upgradeTarget
                ? ` Move to ${proofUsage.upgradeTarget} or add an overflow pack before the next busy campaign.`
                : " Add an overflow pack before the next busy campaign."}
            </p>
            <SecondaryAction to="/app/billing?source=evidence#top-ups">
              Review check packs
            </SecondaryAction>
          </article>
        ) : null}

        <ActionFeedback
          data={actionData}
          fallback
          planLimitTo="/app/billing?source=dashboard-limit#plans"
        />
        <ActionFeedback
          data={actionData}
          intent={["run-saved-query", "track-saved-query"]}
          planLimitTo="/app/billing?source=dashboard-limit#plans"
        />

        <section aria-labelledby="overview-watch-title" className="f9-overview-section">
          <header className="f9-overview-section-head">
            <div>
              <span className="f9-app-kicker">Watch board summary</span>
              <h2 id="overview-watch-title">Being watched</h2>
              <p className="f9-muted-copy">
                {plan === "free"
                  ? `Next weekly check: ${formatNextScanLabel(plan, new Date(), data.workspaceDeliveryTimezone)}. Paid plans check every 3–6 hours.`
                  : `Next scheduled scan: ${formatNextScanLabel(plan, new Date(), data.workspaceDeliveryTimezone)}`}
              </p>
            </div>
            {watchlists.length > 0 ? (
              <SecondaryAction to="/app/watchlists">Open competitors</SecondaryAction>
            ) : null}
          </header>

          {hasDashboardMetrics ? (
            <div
              aria-label="Account summary"
              className="f9-overview-stat-band"
              data-count={overviewMetrics.length}
            >
              {overviewMetrics.map((card) => (
                <article key={card.label}>
                  <span className="f9-app-kicker">{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.detail}</small>
                </article>
              ))}
            </div>
          ) : null}

          {watchlists.length > 0 ? (
            <div className="f9-overview-watchlist">
              {watchlists.slice(0, 5).map((watchlist) => (
                <article className="f9-overview-watch-row" key={watchlist.id}>
                  <div>
                    <h3>{watchlist.name}</h3>
                    <p>{watchlist.targetLabel}</p>
                  </div>
                  <small>
                    {watchlist.lastScannedAt ? (
                      <>
                        Last scan <LocalTime iso={watchlist.lastScannedAt} mode="date" />
                      </>
                    ) : (
                      "Not scanned yet"
                    )}
                  </small>
                </article>
              ))}
            </div>
          ) : null}

          <FactRail
            rows={[
              {
                key: "Source access",
                value: sourceNeedsRecovery ? (
                  <TertiaryAction to="/app/source-access">
                    {formatCommercialSourceStatus(data.metaStatus?.status ?? "")}
                  </TertiaryAction>
                ) : (
                  "Live source ready"
                ),
              },
              {
                key: "Source note",
                value: commercialSourceSummary(data.metaStatus),
                missingLabel: "we could not read this one",
              },
              {
                key: "Watch state",
                value:
                  competitorCount === 0
                    ? null
                    : activeWatchlists > 0
                      ? "Watching"
                      : "Paused",
                missingLabel: "none yet",
              },
              {
                key: "Saved examples",
                value:
                  collections.length > 0 ? (
                    <TertiaryAction to="/app/collections">
                      {collections.length} saved
                    </TertiaryAction>
                  ) : null,
                missingLabel: "none yet",
              },
              {
                key: "Next check",
                value: nextScanLabel,
              },
            ]}
            title="Workspace facts"
          />

          {!hasBlockingSetupGaps ? (
            <Form action="/search" className="f9-overview-search" method="get">
              <label className="f9-field" htmlFor="dashboard-market-search">
                <span>Competitor website</span>
                <input
                  autoComplete="url"
                  id="dashboard-market-search"
                  inputMode="url"
                  name="website"
                  placeholder="https://competitor.com"
                  spellCheck={false}
                  type="text"
                />
              </label>
              <SubmitButton
                className="f9-ed-cta f9-ed-cta--rank2"
                getAction="/search"
                pendingLabel="Searching…"
              >
                Search ads
              </SubmitButton>
            </Form>
          ) : null}
        </section>

        {!hasBlockingSetupGaps ? (
          <div className="f9-overview-primary">
            <PrimaryAction to={marketDeskBrief.action.href}>
              {marketDeskBrief.action.label}
            </PrimaryAction>
          </div>
        ) : null}
      </section>
    </DashboardPage>
  );
}

function OverviewChangePlate({
  event,
  proofHistoryUnavailable,
  proofPairs,
  runHistoryUnavailable,
  runs,
}: {
  event: WatchEventRecord;
  proofHistoryUnavailable: boolean;
  proofPairs: OverviewProofPair[];
  runHistoryUnavailable: boolean;
  runs: OverviewRunTimestamp[];
}) {
  const captures = resolveOverviewDiffCaptures(event, proofPairs, runs);
  const evidenceHistoryUnavailable = event.proofCaptureId
    ? proofHistoryUnavailable
    : runHistoryUnavailable;
  const hasStoredComparisonValues = Boolean(
    readOverviewMetadataString(event.metadata, ["from"]) &&
      readOverviewMetadataString(event.metadata, ["to"]),
  );
  const intelligence = buildChangeIntelligenceSummary(event);
  const classification = classifyWatchEventSource(event);
  const urgency =
    intelligence.priorityScore === null
      ? intelligence.priorityBand
      : `${intelligence.priorityBand} · ${intelligence.priorityScore}/100`;

  return (
    <DiffPlate
      actions={
        <SecondaryAction
          to={`/app/watchlists?watchlist=${encodeURIComponent(event.watchlistId)}&event=${encodeURIComponent(event.id)}`}
        >
          Open the capture
        </SecondaryAction>
      }
      before={captures?.before ?? { capturedAt: null }}
      caughtLabel={formatCaughtLabel(event.createdAt)}
      degradeCopy={
        captures
          ? undefined
          : !hasStoredComparisonValues
            ? `Checked. ${event.title}. ${event.summary} This change has no stored before-and-after field values to compare.`
          : evidenceHistoryUnavailable
            ? `${event.title}. ${event.summary} Capture history is temporarily unavailable, so the before-and-after cannot be verified right now.`
            : `Checked. ${event.title}. ${event.summary} We do not have two stored capture times, so there is no before-and-after to show.`
      }
      degradeStamp={<LocalTime iso={event.createdAt} />}
      delivery={`Next action: ${intelligence.recommendedAction}`}
      field={event.eventType.replaceAll("_", " ")}
      headline={event.title}
      now={captures?.now ?? { capturedAt: null }}
      verification={`${classification.label} · ${urgency}`}
      why={event.summary}
    />
  );
}

function resolveOverviewDiffCaptures(
  event: WatchEventRecord,
  proofPairs: OverviewProofPair[],
  runs: OverviewRunTimestamp[],
) {
  const from = readOverviewMetadataString(event.metadata, ["from"]);
  const to = readOverviewMetadataString(event.metadata, ["to"]);
  const proofPair = event.proofCaptureId
    ? proofPairs.find((pair) => pair.eventId === event.id)
    : undefined;
  const currentCapture = proofPair?.current;
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const currentRun = runsById.get(event.runId);
  const baselineRun = event.baselineFromRunId
    ? runsById.get(event.baselineFromRunId)
    : undefined;
  const nowCapturedAt = event.proofCaptureId
    ? event.confirmedAt ??
      currentCapture?.succeededAt ??
      currentCapture?.attemptedAt ??
      null
    : currentRun?.finishedAt ?? currentRun?.startedAt ?? null;
  const nowTime = nowCapturedAt ? Date.parse(nowCapturedAt) : Number.NaN;
  const previousCapture = proofPair?.previous;
  const previousCapturedAt =
    previousCapture?.succeededAt ?? previousCapture?.attemptedAt ?? null;
  const beforeCapturedAt =
    previousCapturedAt ??
    baselineRun?.finishedAt ??
    baselineRun?.startedAt ??
    null;
  const beforeTime = beforeCapturedAt ? Date.parse(beforeCapturedAt) : Number.NaN;

  if (
    !from ||
    !to ||
    !beforeCapturedAt ||
    !nowCapturedAt ||
    Number.isNaN(beforeTime) ||
    Number.isNaN(nowTime) ||
    beforeTime >= nowTime
  ) {
    return null;
  }

  return {
    before: {
      capturedAt: beforeCapturedAt,
      note: "Earlier stored capture",
      quote: from,
      value: from,
    },
    now: {
      capturedAt: nowCapturedAt,
      note: "Current stored capture",
      quote: to,
      value: to,
    },
  };
}

function readOverviewMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: readonly string[],
) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function formatCaughtLabel(iso: string | null | undefined) {
  if (!iso || Number.isNaN(Date.parse(iso))) return "Caught";
  return `Caught ${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso))} UTC`;
}

function mapCounterMoveFollowUpAudits(audits: AgentActionAuditRecord[]) {
  return audits
    .map(readCounterMoveFollowUpSummary)
    .filter((summary): summary is NonNullable<typeof summary> =>
      Boolean(summary),
    );
}

function formatCommercialSourceStatus(status: string) {
  switch (status) {
    case "healthy":
      return "Live source ready";
    case "cache_only":
      return "Using recent source results";
    case "demo":
      return "Source setup needed";
    case "disabled":
      return "Source unavailable";
    case "degraded":
    default:
      return "Source access needs attention";
  }
}

function commercialSourceSummary(
  status:
    | {
        status?: string | null;
        summary?: string | null;
      }
    | null
    | undefined,
) {
  if (!status) return null;
  if (status.status === "healthy") return "Live ad checks are ready.";
  if (status.status === "demo") {
    return "Live ad checks aren't configured yet, so searches show labeled sample data.";
  }
  if (status.status === "disabled") {
    return "Live ad checks are unavailable right now. Review source access before relying on fresh results.";
  }
  return (
    status.summary?.trim() ||
    "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover."
  );
}

async function listActionableCounterMoveFollowUps(
  env: AppEnv,
  workspaceUserId: string,
  listRecentAgentActionAudits: ListRecentAgentActionAudits,
) {
  const followUps: ReturnType<typeof mapCounterMoveFollowUpAudits> = [];

  for (let page = 0; page < COUNTER_MOVE_AUDIT_MAX_PAGES; page += 1) {
    const audits = await listRecentAgentActionAudits(env, workspaceUserId, {
      actionName: "counter_move_brief.create",
      status: "succeeded",
      resourceType: "watchlist",
      limit: COUNTER_MOVE_AUDIT_PAGE_LIMIT,
      offset: page * COUNTER_MOVE_AUDIT_PAGE_LIMIT,
    });

    followUps.push(...mapCounterMoveFollowUpAudits(audits));
    if (
      followUps.length >= COUNTER_MOVE_FOLLOW_UP_DISPLAY_LIMIT ||
      audits.length < COUNTER_MOVE_AUDIT_PAGE_LIMIT
    ) {
      break;
    }
  }

  return followUps.slice(0, COUNTER_MOVE_FOLLOW_UP_DISPLAY_LIMIT);
}

function readCounterMoveFollowUpSummary(audit: AgentActionAuditRecord) {
  const result = readRecord(audit.result);
  const brief = readRecord(result?.brief);
  const workflow = readRecord(brief?.workflow);
  if (!brief || !workflow) {
    return null;
  }

  const followUps = readRecordArray(workflow?.followUps);
  const openFollowUps = followUps.filter(
    (followUp) => readStringValue(followUp.status) !== "closed",
  );
  const openCount = Math.max(
    0,
    Math.floor(readNumberValue(workflow?.openCount) ?? openFollowUps.length),
  );
  const status = readWorkflowStatus(workflow?.status, openCount);
  const firstFollowUp = openFollowUps[0] ?? followUps[0] ?? null;
  const expiresAt =
    readIsoString(workflow?.expiresAt) ??
    readIsoString(firstFollowUp?.expiresAt);
  if (
    status !== "needs_review" ||
    openCount === 0 ||
    isExpiredIso(expiresAt) ||
    (!expiresAt && isStaleCounterMoveAudit(audit.updatedAt))
  ) {
    return null;
  }
  const targetLabel = safeDashboardText(
    readStringValue(brief.targetLabel),
    "Competitive response",
  );
  const title = safeDashboardText(
    readStringValue(firstFollowUp?.title) ?? readStringValue(brief.summary),
    `${targetLabel} follow-up`,
  );

  return {
    id: audit.id,
    eventId: readStringValue(firstFollowUp?.eventId),
    watchlistId: readStringValue(brief.watchlistId),
    title,
    status,
    openCount,
    ownerLabel: safeDashboardText(
      readStringValue(workflow?.ownerLabel) ??
        readStringValue(firstFollowUp?.ownerLabel),
      "Account owner",
    ),
    channelLabel: formatFollowUpChannel(
      readStringValue(workflow?.channel) ??
        readStringValue(firstFollowUp?.channel),
    ),
    expiresAt,
    updatedAt: audit.updatedAt,
  };
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map(readRecord)
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
}

function readStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readIsoString(value: unknown) {
  const normalized = readStringValue(value);
  return normalized && Number.isFinite(Date.parse(normalized))
    ? normalized
    : null;
}

function isExpiredIso(value: string | null) {
  return Boolean(value && Date.parse(value) <= Date.now());
}

function isStaleCounterMoveAudit(value: string) {
  const updatedAt = Date.parse(value);
  return (
    !Number.isFinite(updatedAt) ||
    updatedAt + COUNTER_MOVE_FOLLOW_UP_AUDIT_FRESHNESS_MS <= Date.now()
  );
}

function readWorkflowStatus(value: unknown, openCount: number) {
  const normalized = readStringValue(value);
  if (normalized === "needs_review" || normalized === "quiet") {
    return normalized;
  }
  return openCount > 0 ? "needs_review" : "quiet";
}

function safeDashboardText(value: string | null, fallback: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized || isSecretishMemoryString(normalized)) {
    return fallback;
  }
  return normalized.length > 120
    ? `${normalized.slice(0, 117)}...`
    : normalized;
}

function formatFollowUpChannel(value: string | null) {
  switch (value) {
    case "email":
      return "Email";
    case "slack":
      return "Slack";
    case "client_room":
      return "Client room";
    default:
      return "In app";
  }
}

// Viewer-local greeting: SSR renders a neutral fallback, the browser swaps in
// the time-of-day version after mount (same hydration-safe pattern as LocalTime).
function WakeGreeting() {
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 5) setGreeting("Working late");
    else if (hour < 12) setGreeting("Good morning");
    else if (hour < 17) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, []);

  return <>{greeting}</>;
}
