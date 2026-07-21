import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
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
import { LocalTime } from "~/components/local-time";
import { Pill } from "~/components/pill";
import { SubmitButton } from "~/components/submit-button";
import { toPublicDeliveryTarget } from "~/lib/delivery-target-public";
import { isSecretishMemoryString } from "~/lib/agent-redaction";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import { buildMarketDeskBrief } from "~/lib/market-desk-brief";
import { buildSearchParams } from "~/lib/normalize";
import { classifyWatchEventSource } from "~/lib/proof-classification";
import { formatNextScanLabel } from "~/lib/schedule-display";
import { formatMachineTokenLabel } from "~/lib/landing-page-display";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import type { AppEnv } from "~/lib/env.server";
import type {
  AgentActionAuditRecord,
  CommercialDiscoveryStatus,
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
    listRecentAgentActionAudits,
    listRecentWorkspaceProofCaptures,
    listRecentWorkspaceWatchEvents,
    listSavedQueries,
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
  const { workspaceUserId, isMember, ownerName } =
    await requireWorkspaceSession(env, request);
  const checkoutReturn =
    new URL(request.url).searchParams.get("checkout") === "dodo";
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
    recentProofCaptures,
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
    optionalSection(
      "recentChanges",
      watchlistsPromise.then((allWatchlists) =>
        allWatchlists.some((watchlist) => watchlist.isActive)
          ? listRecentWorkspaceWatchEvents(env, workspaceUserId, 8)
          : [],
      ),
      [],
    ),
    optionalSection(
      "recentProof",
      listRecentWorkspaceProofCaptures(env, workspaceUserId, 8),
      [],
    ),
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
    checkoutReturn,
    sectionWarnings,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { withWorkspace, planLimitExceededActionResult } =
    await import("~/lib/with-workspace.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { createWatchlistWithinLimit, getSavedQuery, touchSavedQueryRun } =
    await import("~/lib/data.server");
  const env = getEnv(context);
  const workspace = await withWorkspace(request, env);
  if (!workspace.ok) {
    return workspace.result;
  }
  const { workspaceUserId } = workspace;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "run-saved-query") {
    const savedQueryId = String(formData.get("savedQueryId") ?? "");
    const savedQuery = await getSavedQuery(env, savedQueryId, workspaceUserId);

    if (!savedQuery) {
      return {
        ok: false,
        intent,
        message: "Saved query not found.",
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
        message: "Saved query not found.",
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
              : "You've reached your competitor tracking limit.",
        }),
        intent,
      };
    }

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    const watchlist = result.watchlist;
    let firstScanQueued = false;
    try {
      firstScanQueued = await queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);
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
    message: "Unknown dashboard action.",
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
  const checkoutReturn = Boolean(data.checkoutReturn);
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
  const readinessGaps =
    workspaceReadiness?.items.filter(
      (item) => item.status !== "ready" && item.status !== "not_applicable",
    ) ?? [];
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

  return (
    <DashboardPage>
      <section className="f9-app-stack f9-dashboard-clean">
        <DashboardPageHeader
          kicker={<WakeGreeting />}
          lead="Your brief, competitor watchlists, and what needs attention next."
          title="Overview"
        />

        {data.sectionWarnings?.length ? (
          <article aria-live="polite" className="f9-app-panel" role="status">
            <p className="f9-app-kicker">Partial overview</p>
            <h2>We couldn't load part of this overview</h2>
            <p className="f9-muted-copy">
              Everything shown here is current. Refresh to load the rest.
            </p>
          </article>
        ) : null}

        {checkoutReturn ? <CheckoutReturnBanner plan={plan} /> : null}
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
              <Link className="f9-secondary-button" to="/app/billing">
                Plan &amp; billing
              </Link>
            </div>
          </article>
        ) : null}

        {plan === "free" && competitorCount === 0 ? (
          <article className="f9-checkout-banner is-pending" aria-live="polite">
            <div>
              <span className="f9-app-kicker">
                Free weekly watch
              </span>
              <h2>Watch your first competitor free — one weekly email brief.</h2>
              <p>
                Free includes one watchlist with an activation scan, a weekly
                check, and a weekly email brief. Upgrade for 3–6 hour checks,
                daily briefs, and saved evidence.
              </p>
            </div>
            <div className="f9-checkout-banner-actions">
              <Link
                className="f9-primary-button"
                to="/app/billing?source=dashboard#plans"
              >
                View plans
              </Link>
              <Link className="f9-secondary-button" to="/search">
                Search competitors
              </Link>
            </div>
          </article>
        ) : null}

        <article className="f9-app-panel f9-dashboard-hero">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">{marketDeskBrief.kicker}</span>
              <h2>{marketDeskBrief.title}</h2>
              <p className="f9-muted-copy">{marketDeskBrief.summary}</p>
            </div>
            <Link
              className="f9-primary-button"
              to={marketDeskBrief.action.href}
            >
              {marketDeskBrief.action.label}
            </Link>
          </div>

          <CommercialSourceStatus status={data.metaStatus} />

          {marketDeskBrief.items.length > 0 ? (
            <div
              className="f9-brief-snapshot"
              aria-label="Brief details"
            >
              {marketDeskBrief.items.map((item) => (
                <article key={`${item.label}:${item.title}`}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          ) : null}

          <Form action="/search" className="f9-dashboard-search" method="get">
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
              className="f9-primary-button"
              getAction="/search"
              pendingLabel="Searching…"
            >
              Search ads
            </SubmitButton>
          </Form>
        </article>

        {readinessGaps.length > 0 ? (
          <article className="f9-app-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Setup</span>
                <h2>
                  {workspaceReadiness.readyCount} of{" "}
                  {workspaceReadiness.totalCount} checks complete
                </h2>
              </div>
              <Link className="f9-secondary-button" to="/status">
                Platform status
              </Link>
            </div>
            <div className="f9-work-list is-compact">
              {readinessGaps.slice(0, 5).map((item) => (
                <article className="f9-work-row" key={item.id}>
                  <div>
                    <h3>{item.label}</h3>
                    <p className="f9-muted-copy">{item.detail}</p>
                  </div>
                  {item.action ? (
                    <Link className="f9-secondary-button" to={item.action.href}>
                      {item.action.label}
                    </Link>
                  ) : (
                    <Pill>
                      {formatMachineTokenLabel(item.status)}
                    </Pill>
                  )}
                </article>
              ))}
            </div>
          </article>
        ) : null}

        {retentionMoves.length > 0 ? (
          <article className="f9-app-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Next moves</span>
                <h2>Keep the Market Desk useful</h2>
              </div>
            </div>
            <div className="f9-work-list is-compact">
              {retentionMoves.slice(0, 4).map((nudge) => (
                <article className="f9-work-row" key={nudge.id}>
                  <div>
                    <h3>{nudge.title}</h3>
                    <p className="f9-muted-copy">{nudge.detail}</p>
                  </div>
                  <Link className="f9-secondary-button" to={nudge.href}>
                    Open
                  </Link>
                </article>
              ))}
            </div>
          </article>
        ) : null}

        {hasDashboardMetrics ? (
          <div className="f9-dashboard-metrics" aria-label="Account summary">
            {statusCards.map((card) => (
              <article className="f9-app-panel" key={card.label}>
                <span className="f9-app-kicker">{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.detail}</small>
              </article>
            ))}
          </div>
        ) : null}

        <ActionFeedback data={actionData} intent="close-counter-move" />
        {counterMoveFollowUps.length > 0 ? (
          <article className="f9-app-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Follow-ups</span>
                <h2>Responses waiting on you</h2>
              </div>
              <Link className="f9-secondary-button" to="/app/watchlists">
                Review changes
              </Link>
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
                          className="f9-secondary-button"
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
            className={`f9-app-panel f9-proof-usage-alert is-${proofUsage.warningLevel}`}
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
            <Link
              className="f9-secondary-button"
              to="/app/billing?source=evidence#top-ups"
            >
              Review check packs
            </Link>
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

        {visibleRecentEvents.length > 0 ? (
          <article className="f9-app-panel f9-activity-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Recent changes</span>
                <h2>What changed</h2>
              </div>
              <Link className="f9-secondary-button" to="/app/watchlists">
                Manage tracking
              </Link>
            </div>

            <div className="f9-work-list">
              {visibleRecentEvents.map((event) => {
                const intelligence = buildChangeIntelligenceSummary(event);
                const classification = classifyWatchEventSource(event);
                const urgency =
                  intelligence.priorityScore === null
                    ? intelligence.priorityBand
                    : `${intelligence.priorityBand} · ${intelligence.priorityScore}/100`;
                return (
                  <article className="f9-work-row" key={event.id}>
                    <div>
                      <h3>{event.title}</h3>
                      <p className="f9-muted-copy">
                        <strong>Why it matters:</strong> {event.summary}
                      </p>
                      <p className="f9-muted-copy">
                        {urgency} · {classification.label} · Source:{" "}
                        {classification.sourceTypeLabel}
                      </p>
                      <p className="f9-muted-copy">
                        Next action: {intelligence.recommendedAction}
                      </p>
                      <small>
                        {event.eventType.replaceAll("_", " ")} · Last seen{" "}
                        <LocalTime iso={event.createdAt} />
                      </small>
                    </div>
                    <Pill>
                      {classification.label}
                    </Pill>
                  </article>
                );
              })}
            </div>
          </article>
        ) : null}

        <div className="f9-dashboard-grid">
          {watchlists.length > 0 ? (
            <article className="f9-app-panel">
              <div className="f9-panel-toolbar">
                <div>
                  <span className="f9-app-kicker">Competitors</span>
                  <h2>Being watched</h2>
                  <p className="f9-muted-copy">
                    {plan === "free"
                      ? `Next weekly check: ${formatNextScanLabel(plan, new Date(), data.workspaceDeliveryTimezone)}. Paid plans check every 3–6 hours.`
                      : `Next scheduled scan: ${formatNextScanLabel(plan, new Date(), data.workspaceDeliveryTimezone)}`}
                  </p>
                </div>
                <Link className="f9-secondary-button" to="/app/watchlists">
                  Open watchlists
                </Link>
              </div>
              <div className="f9-work-list is-compact">
                {watchlists.slice(0, 5).map((watchlist) => (
                  <div className="f9-work-row" key={watchlist.id}>
                    <div>
                      <h3>{watchlist.name}</h3>
                      <p className="f9-muted-copy">{watchlist.targetLabel}</p>
                    </div>
                    <small>
                      {watchlist.lastScannedAt ? (
                        <>
                          Last scan{" "}
                          <LocalTime
                            iso={watchlist.lastScannedAt}
                            mode="date"
                          />
                        </>
                      ) : (
                        "Not scanned yet"
                      )}
                    </small>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {collections.length > 0 ? (
            <article className="f9-app-panel">
              <div className="f9-panel-toolbar">
                <div>
                  <span className="f9-app-kicker">Saved evidence</span>
                  <h2>Useful examples</h2>
                </div>
                <Link className="f9-secondary-button" to="/app/collections">
                  Open collections
                </Link>
              </div>
              <div className="f9-work-list is-compact">
                {collections.slice(0, 4).map((collection) => (
                  <div className="f9-work-row" key={collection.id}>
                    <div>
                      <h3>{collection.name}</h3>
                      <p className="f9-muted-copy">
                        {collection.description || "Saved for reuse."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </div>
      </section>
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

function CommercialSourceStatus({
  status,
}: {
  status:
    | {
        status: CommercialDiscoveryStatus;
        summary?: string | null;
        lastCheckedAt?: string | null;
      }
    | null
    | undefined;
}) {
  if (!status) {
    return null;
  }

  const label = formatCommercialSourceStatus(status.status);
  const needsRecovery = status.status !== "healthy";
  const summary =
    status.status === "healthy"
      ? (customerDiscoverySummary(status.summary) ??
        "Live ad checks are ready.")
      : status.status === "demo"
        ? "Live ad checks aren't configured yet, so searches show labeled sample data."
        : status.status === "disabled"
          ? "Live ad checks are unavailable right now. Review source access before relying on fresh results."
          : (customerDiscoverySummary(status.summary) ??
            "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.");

  return (
    <div
      className={`f9-status-strip ${needsRecovery ? "is-warning" : "is-healthy"}`}
      aria-label="Commercial ad source status"
    >
      <div>
        <span className="f9-app-kicker">Commercial ad source</span>
        <strong>{label}</strong>
        <p className="f9-muted-copy">{summary}</p>
      </div>
      {needsRecovery ? (
        <Link className="f9-secondary-button" to="/app/source-access">
          Open Source access
        </Link>
      ) : null}
    </div>
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

const CHECKOUT_ACTIVATION_POLL_LIMIT = 10;

function CheckoutReturnBanner(props: { plan: string }) {
  const revalidator = useRevalidator();
  const planActive = props.plan !== "free";
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (planActive || pollCount >= CHECKOUT_ACTIVATION_POLL_LIMIT) {
      return;
    }

    const timer = setTimeout(() => {
      setPollCount((count) => count + 1);
      revalidator.revalidate();
    }, 3000);
    return () => clearTimeout(timer);
  }, [planActive, pollCount, revalidator]);

  if (planActive) {
    const planLabel = props.plan.charAt(0).toUpperCase() + props.plan.slice(1);
    return (
      <article className="f9-checkout-banner is-active" aria-live="polite">
        <div>
          <span className="f9-app-kicker">Payment received</span>
          <h2>Your {planLabel} plan is live.</h2>
          <p>
            Monitoring, digests, and saved evidence are unlocked. Add your next
            competitor while the trail is warm.
          </p>
        </div>
        <div className="f9-checkout-banner-actions">
          <Link className="f9-primary-button" to="/search">
            Add a competitor
          </Link>
          <Link className="f9-secondary-button" to="/app">
            Dismiss
          </Link>
        </div>
      </article>
    );
  }

  if (pollCount >= CHECKOUT_ACTIVATION_POLL_LIMIT) {
    return (
      <article className="f9-checkout-banner is-pending" aria-live="polite">
        <div>
          <span className="f9-app-kicker">Finishing checkout</span>
          <h2>Activation is taking longer than usual.</h2>
          <p>
            Your payment went through and the plan will activate as soon as Dodo
            confirms it. If this page still shows the free plan in a few
            minutes, email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and
            we'll sort it out.
          </p>
        </div>
        <div className="f9-checkout-banner-actions">
          <Link
            className="f9-secondary-button"
            to="/app/billing?checkout=dodo&kind=plan"
          >
            Check again
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="f9-checkout-banner is-pending" aria-live="polite">
      <div>
        <span className="f9-app-kicker">Finishing checkout</span>
        <h2>
          <span className="f9-checkout-pulse" aria-hidden="true" />
          Activating your plan…
        </h2>
        <p>
          Dodo is confirming the payment. This usually takes under a minute — no
          need to refresh.
        </p>
      </div>
    </article>
  );
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
