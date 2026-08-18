import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import {
  DashboardRouteError,
  DashboardRouteLoading,
} from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { SetupChecklistCard } from "~/components/setup-checklist-card";
import { SpecimenEmptyState } from "~/components/evidence/specimen-empty-state";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { useFirstCapturePolling } from "~/components/workspace/use-first-capture-polling";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { toPublicDeliveryTarget } from "~/lib/delivery-target-public";
import { isSecretishMemoryString } from "~/lib/agent-redaction";
import {
  firstChangeMark,
  firstLandingPageEvidence,
  type LandingPageEvidence,
} from "~/lib/change-mark";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import { buildMarketDeskBrief } from "~/lib/market-desk-brief";
import { buildOvernightSentence } from "~/lib/overnight-sentence";
import { pendingBlockingSetupItems } from "~/lib/setup-checklist";
import { buildSearchParams } from "~/lib/normalize";
import { formatNextScanLabel } from "~/lib/schedule-display";
import { formatMachineTokenLabel } from "~/lib/landing-page-display";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { AppEnv } from "~/lib/env.server";
import type { AgentActionAuditRecord, WatchEventRecord } from "~/lib/types";
import type { WorkspaceReadiness } from "~/lib/workspace-readiness.server";

export const meta = () => [{ title: "Today | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Today" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

const COUNTER_MOVE_AUDIT_PAGE_LIMIT = 30;
const COUNTER_MOVE_AUDIT_MAX_PAGES = 10;
const COUNTER_MOVE_FOLLOW_UP_DISPLAY_LIMIT = 3;
const COUNTER_MOVE_FOLLOW_UP_AUDIT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

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
    listFirstScanRunStates,
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
  // Same-session first value: only workspaces with an active competitor that
  // has never been scanned ask about first-scan run state, and that state is
  // what lets the Overview say "running now" instead of a static queued claim.
  const firstScanStatesPromise = watchlistsPromise.then((allWatchlists) =>
    allWatchlists.some(
      (watchlist) => watchlist.isActive && !watchlist.lastScannedAt,
    )
      ? optionalSection(
          "firstScan",
          listFirstScanRunStates(env, workspaceUserId),
          [],
        )
      : [],
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
    firstScanStates,
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
    firstScanStatesPromise,
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
    setupCreatedCount: readSetupCreatedCount(requestUrl),
    firstScanStates,
    awaitingFirstScan: firstScanStates.some(
      (state) => state.status === "pending" || state.status === "running",
    ),
  };
}

function readSetupCreatedCount(requestUrl: URL) {
  const value = Number(requestUrl.searchParams.get("created"));
  return Number.isInteger(value) && value > 0 ? value : 0;
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
  const revalidator = useRevalidator();
  // Same-session first value: while any competitor is still waiting on its
  // first live scan, the Overview keeps refreshing itself so the first
  // mini-brief lands without a manual reload. Bounded (≈10 minutes of 30s
  // polls) and it stops the moment nothing is waiting.
  const awaitingFirstScan = Boolean(
    data.awaitingFirstScan ??
      (data.firstScanStates ?? []).some(
        (state) => state.status === "pending" || state.status === "running",
      ),
  );
  useFirstCapturePolling(awaitingFirstScan);
  const setupCreatedCount = data.setupCreatedCount ?? 0;
  const recentEvents = data.recentEvents ?? [];
  const recentProofCaptures = data.recentProofCaptures ?? [];
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
    firstScanStates: data.firstScanStates,
  });
  const sourceNeedsRecovery =
    Boolean(data.metaStatus) && data.metaStatus?.status !== "healthy";
  const latestDigest = digests[0] ?? null;
  // A competitor name, not an event title, is what the row is about — the
  // Bricolage face means "a watched entity" and nothing else.
  const watchlistNameById = new Map(
    watchlists.map((watchlist) => [watchlist.id, watchlist.name]),
  );
  const changedWatchlistCount = new Set(
    visibleRecentEvents.map((event) => event.watchlistId),
  ).size;
  // Honest degrade: the strip NAMES what could not be read, so "temporarily
  // unavailable" is never mistaken for "no stored evidence exists".
  const sectionWarningCopy = formatOverviewSectionWarnings(data.sectionWarnings ?? []);
  const lastCheckAt = watchlists.reduce<string | null>((latest, watchlist) => {
    if (!watchlist.lastScannedAt) return latest;
    return !latest || watchlist.lastScannedAt > latest ? watchlist.lastScannedAt : latest;
  }, null);

  // Only a confirmed event may lead the Overnight sentence or carry the green
  // mark — a detected event is provisional and cannot render a proven diff.
  // The feed itself already excludes suppressed/invalidated at the query.
  const confirmedRecentEvents = visibleRecentEvents.filter(
    (event) => event.status === "confirmed",
  );
  const overnight = buildOvernightSentence({
    briefTitle: marketDeskBrief.title,
    briefSummary: marketDeskBrief.summary,
    changeCount: confirmedRecentEvents.length,
    headline: confirmedRecentEvents[0]?.title ?? null,
    mark: firstChangeMark(confirmedRecentEvents)?.mark ?? null,
    quietCompetitors: Math.max(0, activeWatchlists - changedWatchlistCount),
  });
  // The evidence card carries what the token mark cannot: long landing-page
  // values and the stored before/after screenshot pair, each in its own
  // honest proof state.
  const landingEvidence = firstLandingPageEvidence(confirmedRecentEvents);

  return (
    <DashboardPage className="f9-wk-page f9-overview">
      <WorkingHeader
        action={
          hasBlockingSetupGaps
            ? null
            : { label: marketDeskBrief.action.label, to: marketDeskBrief.action.href }
        }
        context={
          <>
            Welcome back.{" "}
            {latestDigest ? (
              <>
                Your latest brief was filed{" "}
                <LocalTime iso={latestDigest.createdAt} mode="date" />.
              </>
            ) : (
              "No brief has been filed yet."
            )}
          </>
        }
        title="Today"
      />

      {sectionWarningCopy ? (
        <FeedbackStrip label="Partial overview" tone="bad">
          {sectionWarningCopy} Everything else shown here is current — refresh to load the
          rest.
        </FeedbackStrip>
      ) : null}

      {hasPaymentIssue ? (
        <FeedbackStrip
          actions={
            <Link className="f9-wk-lnk" to="/app/billing">
              Plan &amp; billing <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          }
          label="Payment issue"
          tone="bad"
        >
          Your last renewal payment didn&apos;t go through. Billing reported a payment
          issue. Review the current status and payment method from your provider receipt,
          or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&apos;ll help before
          anything is interrupted.
        </FeedbackStrip>
      ) : null}

      {proofUsage.warningLevel !== "ok" ? (
        <FeedbackStrip
          actions={
            <Link className="f9-wk-lnk" to="/app/billing?source=evidence#top-ups">
              Review proof capture packs <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          }
          label="Evidence usage"
          tone="bad"
        >
          {proofUsage.warningLevel === "exhausted"
            ? "You've used all your proof captures. "
            : "You've used over 80% of your proof captures. "}
          {proofUsage.used} of {proofUsage.limit} proof captures used in the current billing period.
          {proofUsage.upgradeTarget
            ? ` Move to ${proofUsage.upgradeTarget} or add an overflow pack before the next busy campaign.`
            : " Add an overflow pack before the next busy campaign."}
        </FeedbackStrip>
      ) : null}

      <div className="f9-wk-sec">
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
        <ActionFeedback data={actionData} intent="close-counter-move" />
      </div>

      {setupCreatedCount > 0 || awaitingFirstScan ? (
        <div className="f9-wk-sec">
          <FeedbackStrip
            actions={
              <Link className="f9-wk-lnk" to="/app/watchlists">
                Open Competitors{" "}
                <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
              </Link>
            }
            label={awaitingFirstScan ? "First scan live" : "Setup complete"}
          >
            {setupCreatedCount > 0 ? (
              awaitingFirstScan ? (
                <>
                  Created {setupCreatedCount} competitor{" "}
                  {setupCreatedCount === 1 ? "watchlist" : "watchlists"} — the
                  first live scan is running now. This page refreshes
                  automatically, and your first mini-brief lands here the
                  moment it completes.
                </>
              ) : (
                <>
                  Created {setupCreatedCount} competitor{" "}
                  {setupCreatedCount === 1 ? "watchlist" : "watchlists"} — the
                  first live scan has started. Your first mini-brief lands in
                  the brief below as soon as it completes.
                </>
              )
            ) : (
              <>
                Your first scan is running now. This page refreshes
                automatically — the first mini-brief and any proof-backed
                evidence land here the moment the scan completes.
              </>
            )}
          </FeedbackStrip>
        </div>
      ) : null}

      {readinessUnavailable ? (
        <div className="f9-wk-sec" id="setup-checklist">
          <SpecimenEmptyState
            copy="The workspace is still available, but setup progress could not be checked. Retry before assuming activation is complete."
            headline="Setup status is temporarily unavailable"
            primaryAction={{
              label: "Retry setup status",
              // A same-page link never re-runs the loader; a real retry
              // revalidates the route data (Sol's PR-3 review, item 1).
              onClick: () => revalidator.revalidate(),
            }}
            specimenLabel="SETUP CHECKS — RETRY REQUIRED"
            stateLabel="SETUP · STATUS UNAVAILABLE"
          />
        </div>
      ) : workspaceReadiness && hasBlockingSetupGaps ? (
        <div className="f9-wk-sec">
          <SetupChecklistCard
            actionData={actionData}
            prefillCountry={data.setupPrefillCountry}
            prefillWebsite={data.setupPrefillWebsite}
            readiness={workspaceReadiness}
          />
          {digests.length > 0 ? (
            <p className="f9-wk-note">
              <Link className="f9-wk-lnk" to="/app/digests?firstrun=1">
                Read latest brief <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="overview-overnight-title" className="f9-wk-sec">
        <p className="f9-wk-kick" id="overview-overnight-title">
          Overnight
        </p>
        <p className="f9-wk-lede">
          {overnight.lead}
          {overnight.mark ? (
            <>
              <s className="f9-wk-del">{overnight.mark.from}</s> &rarr;{" "}
              <ins className="f9-wk-ins">{overnight.mark.to}</ins>
            </>
          ) : null}
          {overnight.tail}
        </p>
        {landingEvidence ? (
          <LandingPageEvidenceCard
            event={landingEvidence.event}
            evidence={landingEvidence.evidence}
            timeZone={data.workspaceDeliveryTimezone}
          />
        ) : null}
      </section>

      <section aria-labelledby="overview-changes-title" className="f9-wk-sec">
        <p className="f9-wk-kick" id="overview-changes-title">
          What changed
        </p>
        {visibleRecentEvents.length > 0 ? (
          <RuledList aria-label="What changed">
            {visibleRecentEvents.slice(0, 3).map((event) => (
              <RuledRow
                key={event.id}
                name={watchlistNameById.get(event.watchlistId) ?? event.title}
                say={event.summary}
                status={
                  event.status === "confirmed"
                    ? "Caught"
                    : event.status === "proof_failed"
                      ? "Check failed"
                      : "Needs review"
                }
                statusTone={
                  event.status === "confirmed"
                    ? "on"
                    : event.status === "proof_failed"
                      ? "bad"
                      : "quiet"
                }
                time={<LocalTime iso={event.createdAt} mode="date" />}
                to={`/app/watchlists?watchlist=${encodeURIComponent(event.watchlistId)}&event=${encodeURIComponent(event.id)}`}
              />
            ))}
          </RuledList>
        ) : (
          <p className="f9-wk-note">
            {recentChangesUnavailable
              ? "Change history is temporarily unavailable. Refresh before deciding that the latest check was quiet."
              : activeWatchlists === 0 && competitorCount > 0
                ? "Monitoring is paused. Resume a competitor before expecting a new check."
                : allActiveWatchlistsHaveScanHistory
                  ? "Every active competitor has scan history. No change events are filed in the recent feed."
                  : competitorCount > 0
                    ? "The first check is still pending for at least one active competitor. Changes will appear after a successful scan."
                    : "Nothing filed yet — add a competitor and the first capture starts the evidence trail."}
          </p>
        )}

        {counterMoveFollowUps.length > 0 ? (
          <RuledList aria-label="Responses waiting on you">
            {counterMoveFollowUps.map((followUp) => (
              <RuledRow
                key={followUp.id}
                name={followUp.title}
                plain
                say={`${followUp.ownerLabel} · ${followUp.channelLabel}`}
                status={
                  followUp.status === "needs_review"
                    ? `${followUp.openCount} open`
                    : formatMachineTokenLabel(followUp.status)
                }
                time={
                  followUp.expiresAt ? (
                    <LocalTime iso={followUp.expiresAt} mode="date" />
                  ) : null
                }
                to={
                  followUp.watchlistId
                    ? `/app/watchlists?watchlist=${followUp.watchlistId}`
                    : undefined
                }
                trail={
                  followUp.eventId ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="close-counter-move" />
                      <input name="auditId" type="hidden" value={followUp.id} />
                      <input name="eventId" type="hidden" value={followUp.eventId} />
                      <SubmitButton
                        className="f9-wk-lnk"
                        intent="close-counter-move"
                        match={{ auditId: followUp.id }}
                        pendingLabel="Saving…"
                      >
                        Mark done
                      </SubmitButton>
                    </Form>
                  ) : null
                }
              />
            ))}
          </RuledList>
        ) : null}
      </section>

      <section aria-labelledby="overview-running-title" className="f9-wk-sec">
        <p className="f9-wk-kick" id="overview-running-title">
          Still running
        </p>
        <RuledList aria-label="Still running">
          <RuledRow
            name="Competitors"
            plain
            say={
              competitorCount === 0
                ? "Nothing is being watched yet. Add a competitor and its first check starts immediately."
                : activeWatchlists === 0
                  ? "Every competitor is paused. No checks run until you resume one."
                  : `${activeWatchlists} being checked${
                      competitorCount - activeWatchlists > 0
                        ? `, ${competitorCount - activeWatchlists} paused`
                        : ""
                    }. Next check ${nextScanLabel}.`
            }
            status={String(competitorCount)}
            to="/app/watchlists"
          />
          <RuledRow
            name="Evidence captures"
            plain
            say={
              proofUsage.limit
                ? `${proofUsage.used} of ${proofUsage.limit} proof captures used in the current billing period.`
                : `${successfulProofs} proof captures have succeeded so far.`
            }
            status={
              proofUsage.limit
                ? `${proofUsage.remaining ?? 0} left this month`
                : `${successfulProofs} succeeded`
            }
            to="/app/billing?source=evidence#top-ups"
          />
          {sourceNeedsRecovery ? (
            <RuledRow
              name="Source access"
              plain
              say={
                commercialSourceSummary(data.metaStatus) ??
                "Live ad checks need attention before this brief can be trusted."
              }
              status={formatCommercialSourceStatus(data.metaStatus?.status ?? "")}
              statusTone="bad"
              to="/app/source-access"
            />
          ) : null}
          {collections.length > 0 ? (
            <RuledRow
              name="Saved examples"
              plain
              say="Ads and captures you filed for later."
              status={`${collections.length} saved`}
              to="/app/collections"
            />
          ) : null}
          {retentionMoves.slice(0, 3).map((nudge) => (
            <RuledRow
              key={nudge.id}
              name={nudge.title}
              plain
              say={nudge.detail}
              to={nudge.href}
            />
          ))}
        </RuledList>
      </section>

      {!hasBlockingSetupGaps ? (
        <section aria-labelledby="overview-search-title" className="f9-wk-sec">
          <p className="f9-wk-kick" id="overview-search-title">
            Check a competitor now
          </p>
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
              className="f9-evidence-cta f9-evidence-cta--rank2"
              getAction="/search"
              pendingLabel="Searching…"
            >
              Search ads
            </SubmitButton>
          </Form>
        </section>
      ) : null}

      <div className="f9-wk-opline">
        <span>
          Last check{" "}
          {lastCheckAt ? <LocalTime iso={lastCheckAt} mode="date" /> : "not yet"}
        </span>
        <span>Next check {nextScanLabel}</span>
        <span>
          {proofUsage.limit
            ? `${proofUsage.remaining ?? 0} proof captures left this period`
            : `${successfulProofs} proof captures saved`}
        </span>
      </div>
    </DashboardPage>
  );
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

/**
 * BL-030 — the partial-overview strip names what it could not read.
 *
 * "Capture history is temporarily unavailable" and "no stored evidence
 * exists" are different claims, and the customer's whole reason for paying is
 * that we never conflate them. Each degraded section gets its own sentence.
 */
const OVERVIEW_SECTION_LABELS: Record<string, string> = {
  readiness: "Setup status",
  recentChanges: "Change history",
  recentProof: "Capture history",
  recentRuns: "Check history",
  collections: "Saved examples",
  digests: "Brief history",
};

export function formatOverviewSectionWarnings(
  warnings: readonly { section: string }[],
): string | null {
  if (warnings.length === 0) return null;
  const labels = [
    ...new Set(
      warnings.map(
        (warning) => OVERVIEW_SECTION_LABELS[warning.section] ?? "Part of this overview",
      ),
    ),
  ];
  return labels
    .map((label) => `${label} is temporarily unavailable.`)
    .join(" ");
}

// Viewer-local greeting: SSR renders a neutral fallback, the browser swaps in
// the time-of-day version after mount (same hydration-safe pattern as LocalTime).



/**
 * BL-030 extension — the landing-page evidence card.
 *
 * The one green mark is a token that refuses paragraphs; this card is where a
 * landing-page rewrite stays readable. It always names the changed region and
 * the exact source, shows the before/after screenshot pair ONLY when both
 * stored artifact URLs are valid HTTPS images, and otherwise says plainly that
 * screenshot proof is pending or unavailable — never a broken image.
 */
export function LandingPageEvidenceCard(props: {
  event: WatchEventRecord;
  evidence: LandingPageEvidence;
  timeZone?: string | null;
}) {
  const { event, evidence, timeZone } = props;
  const intelligence = buildChangeIntelligenceSummary(event, timeZone);
  const from = evidence.from;
  const to = evidence.to;
  return (
    <div
      aria-label="Landing page evidence"
      className="f9-wk-landing-evidence f9-wk-evidence-split"
    >
      <p className="f9-wk-note f9-wk-mt0">
        <strong>Landing page evidence</strong> · {evidence.changedField} changed ·{" "}
        {event.summary}
      </p>
      {from || to ? (
        <p className="f9-wk-note f9-wk-evidence-note">
          Before: &ldquo;{from ?? "not stored"}&rdquo;
          <br />
          After: &ldquo;{to ?? "not stored"}&rdquo;
        </p>
      ) : null}
      {evidence.proofState === "screenshot_proof" ? (
        <div
          className="f9-wk-evidence-grid"
        >
          <figure className="f9-wk-m0">
            <figcaption className="f9-wk-note f9-wk-mt0">
              Before
            </figcaption>
            <img
              alt="Landing page before the change"
              src={evidence.beforeImageUrl ?? undefined}
              className="f9-wk-img-frame"
            />
          </figure>
          <figure className="f9-wk-m0">
            <figcaption className="f9-wk-note f9-wk-mt0">
              After
            </figcaption>
            <img
              alt="Landing page after the change"
              src={evidence.afterImageUrl ?? undefined}
              className="f9-wk-img-frame"
            />
          </figure>
        </div>
      ) : (
        <p className="f9-wk-note f9-wk-evidence-note">
          {evidence.proofState === "proof_pending"
            ? "Screenshot proof pending — the stored before/after pair is incomplete, so no screenshot is shown."
            : "No screenshots stored for this change — the stored text and source are the evidence on file."}
        </p>
      )}
      {evidence.sourceUrl ? (
        <p className="f9-wk-note f9-wk-evidence-note">
          Source: {evidence.sourceUrl}
        </p>
      ) : null}
      {evidence.beforeCapturedAt || evidence.capturedAt ? (
        <p className="f9-wk-note f9-wk-evidence-note">
          Before: <LocalTime iso={evidence.beforeCapturedAt} mode="datetime" />
          {evidence.capturedAt ? (
            <>
              {" "}
              · After: <LocalTime iso={evidence.capturedAt} mode="datetime" />
            </>
          ) : null}
        </p>
      ) : null}
      <p className="f9-wk-note f9-wk-evidence-note">
        Recommended: {intelligence.recommendedAction}
      </p>
    </div>
  );
}
