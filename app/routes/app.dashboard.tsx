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

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { toPublicDeliveryTarget } from "~/lib/delivery-target-public";
import { isSecretishMemoryString } from "~/lib/agent-redaction";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import { buildMarketDeskBrief } from "~/lib/market-desk-brief";
import { buildSearchParams } from "~/lib/normalize";
import { classifyWatchEventSource } from "~/lib/proof-classification";
import { formatNextScanLabel } from "~/lib/schedule-display";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { AppEnv } from "~/lib/env.server";
import type { AgentActionAuditRecord } from "~/lib/types";

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

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCustomerMetaConnection,
    listCollections,
    listDeliveryTargets,
    listDigests,
    listRecentAgentActionAudits,
    listRecentWorkspaceProofCaptures,
    listSavedQueries,
    listWatchEvents,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { getProofUsageSummary } = await import("~/lib/plan.server");
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  const { getSuccessfulProofCaptureStatsForUser, getSuccessfulRunStatsForUserBetween, getUserPlanBillingInfo } = await import(
    "~/lib/data.server"
  );
  const env = getEnv(context);
  const { workspaceUserId, isMember, ownerName } = await requireWorkspaceSession(env, request);
  const checkoutReturn = new URL(request.url).searchParams.get("checkout") === "dodo";
  const { listWorkspaceMembers } = await import("~/lib/workspace.server");
  const [
    savedQueries,
    collections,
    watchlists,
    digests,
    metaStatus,
    customerMetaConnection,
    proofUsage,
    billingInfo,
    workspaceMembers,
    workspaceReadiness,
    counterMoveFollowUps,
  ] = await Promise.all([
    listSavedQueries(env, workspaceUserId),
    listCollections(env, workspaceUserId),
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
    listDigests(env, workspaceUserId),
    resolveCommercialAdSourceStatus(env),
    getCustomerMetaConnection(env, workspaceUserId),
    getProofUsageSummary(env, workspaceUserId),
    getUserPlanBillingInfo(env, workspaceUserId),
    listWorkspaceMembers(env, workspaceUserId),
    getWorkspaceReadiness(env, workspaceUserId, {
      isMember,
      billingOwnerName: ownerName,
      canManageBilling: !isMember,
    }),
    listActionableCounterMoveFollowUps(env, workspaceUserId, listRecentAgentActionAudits),
  ]);
  const plan = billingInfo.plan;
  const hasPaymentIssue =
    plan !== "free" &&
    (billingInfo.dodoStatus === "payment.failed" ||
      billingInfo.dodoStatus === "subscription.failed" ||
      billingInfo.dodoStatus === "subscription.on_hold");
  const overnightSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const activeWatchlistsForEvents = watchlists.filter((watchlist) => watchlist.isActive);
  const [recentEvents, recentProofCaptures, deliveryTargets, overnightStats, successfulProofStats] = await Promise.all([
    Promise.all(activeWatchlistsForEvents.slice(0, 6).map((watchlist) => listWatchEvents(env, watchlist.id, 6))).then((groups) =>
      groups
        .flat()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8),
    ),
    listRecentWorkspaceProofCaptures(env, workspaceUserId, 8),
    listDeliveryTargets(env, workspaceUserId, { limit: 12 }),
    getSuccessfulRunStatsForUserBetween(env, workspaceUserId, overnightSince, new Date().toISOString()),
    getSuccessfulProofCaptureStatsForUser(env, workspaceUserId),
  ]);

  return {
    savedQueries,
    collections,
    watchlists,
    digests,
    recentEvents,
    recentProofCaptures,
    deliveryTargets: deliveryTargets.map(toPublicDeliveryTarget),
    metaStatus,
    proofUsage,
    overnightStats,
    successfulProofStats,
    workspaceReadiness,
    counterMoveFollowUps,
    plan,
    teamMemberCount: workspaceMembers.length,
    nextScanLabel: (await import("~/lib/schedule-display")).formatNextScanLabel(plan),
    hasPaymentIssue,
    checkoutReturn,
    customerMetaConnection: customerMetaConnection
      ? {
          status: customerMetaConnection.status,
          tokenLastFour: customerMetaConnection.tokenLastFour,
          lastCheckedAt: customerMetaConnection.lastCheckedAt,
        }
      : null,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { withWorkspace, planLimitExceededActionResult } = await import(
    "~/lib/with-workspace.server"
  );
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { createWatchlistWithinLimit, getSavedQuery, touchSavedQueryRun } = await import("~/lib/data.server");
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
    throw redirect(`/search?${buildSearchParams(savedQuery.normalizedQuery).toString()}`);
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

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    const { requireVerifiedEmailForRetention, emailUnverifiedActionResult } = await import(
      "~/lib/email-verification.server"
    );
    const verification = await requireVerifiedEmailForRetention(env, workspaceUserId);
    if (!verification.ok) {
			return { ...emailUnverifiedActionResult(), intent };
    }

    const result = await createWatchlistWithinLimit(env, workspaceUserId, {
      name: `${savedQuery.name} watch`,
      targetType: "saved_query",
      targetId: savedQuery.id,
      targetFingerprint: savedQuery.fingerprint,
      targetLabel: savedQuery.name,
      targetCountry: savedQuery.normalizedQuery.filters.country,
    }, watchlistLimit.limit);

    if (result.status === "over_cap") {
			return {
				...planLimitExceededActionResult({
					limit: result.limit,
					current: result.current,
					message:
						result.limit <= 1
							? "Free includes 1 watchlist. Upgrade to track more competitors with scheduled scans and digests."
							: "You have reached your competitor tracking limit.",
				}),
				intent,
			};
    }

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    const watchlist = result.watchlist;
    queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);

    return {
      ok: true,
			intent,
      message: `Now tracking ${savedQuery.name}. First scan is running now.`,
    };
  }

  if (intent === "close-counter-move") {
    const { closeCounterMoveFollowUp } = await import("~/lib/data.server");
    const auditId = String(formData.get("auditId") ?? "").trim();
    const eventId = String(formData.get("eventId") ?? "").trim();
    if (!auditId || !eventId) {
			return { ok: false, intent, message: "Could not mark that follow-up done." };
    }

    const result = await closeCounterMoveFollowUp(env, {
      auditId,
      eventId,
      userId: workspaceUserId,
    });

    if (!result.ok) {
			return { ok: false, intent, message: "That follow-up is no longer open." };
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
  const proofUsage = data.proofUsage ?? { warningLevel: "ok", used: 0, limit: 0, remaining: 0, plan: "free" };
  const plan = data.plan ?? "free";
  const nextScanLabel = data.nextScanLabel ?? formatNextScanLabel(plan);
  const hasPaymentIssue = Boolean(data.hasPaymentIssue);
  const checkoutReturn = Boolean(data.checkoutReturn);
  const competitorCount = watchlists.length;
  const activeWatchlists = watchlists.filter((watchlist) => watchlist.isActive).length;
  const visibleRecentEvents = activeWatchlists > 0 ? recentEvents : [];
  const recentSuccessfulProofs = recentProofCaptures.filter((capture) => capture.status === "succeeded").length;
  const successfulProofs = data.successfulProofStats?.count ?? recentSuccessfulProofs;
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
  });
  const statusCards = marketDeskBrief.metrics;
  const hasDashboardMetrics = marketDeskBrief.hasMetrics;

  return (
    <DashboardPage>
    <section className="f9-app-stack f9-dashboard-clean">
      <DashboardPageHeader
        lead="Your Market Desk Brief, competitor watchlists, and what needs attention next."
        title="Overview"
      />

      {checkoutReturn ? <CheckoutReturnBanner plan={plan} /> : null}
      {hasPaymentIssue ? (
        <article className="f9-checkout-banner is-pending" aria-live="polite">
          <div>
            <span className="f9-app-kicker">Payment issue</span>
            <h2>Your last renewal payment didn't go through.</h2>
            <p>
              Your plan stays active while the payment provider retries. Check the card on your Dodo
              Payments receipt email, or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll
              help before anything is interrupted.
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
            <span className="f9-app-kicker">Plan required for monitoring</span>
            <h2>Search is free. Retained tracking starts on a paid plan.</h2>
            <p>
              Upgrade to Starter or above to keep regular competitor checks, change digests, and saved
              evidence on a watchlist.
            </p>
          </div>
          <div className="f9-checkout-banner-actions">
            <Link className="f9-primary-button" to="/app/billing?source=dashboard#plans">
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
          <Link className="f9-primary-button" to={marketDeskBrief.action.href}>
            {marketDeskBrief.action.label}
          </Link>
        </div>

        {marketDeskBrief.items.length > 0 ? (
          <div className="f9-brief-snapshot" aria-label="Market Desk Brief details">
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
          <SubmitButton className="f9-primary-button" getAction="/search" pendingLabel="Searching…">
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
                {workspaceReadiness.readyCount} of {workspaceReadiness.totalCount} checks complete
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
                  <span className="f9-status-pill">{item.status.replaceAll("_", " ")}</span>
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
                      <Link to={`/app/watchlists?watchlist=${followUp.watchlistId}`}>{followUp.title}</Link>
                    ) : (
                      followUp.title
                    )}
                  </h3>
                  <p className="f9-muted-copy">
                    {followUp.ownerLabel} · {followUp.channelLabel}
                    {followUp.expiresAt ? <> · expires <LocalTime iso={followUp.expiresAt} mode="date" /></> : null}
                  </p>
                </div>
                <div className="f9-inline-actions">
                  {followUp.eventId ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="close-counter-move" />
                      <input name="auditId" type="hidden" value={followUp.id} />
                      <input name="eventId" type="hidden" value={followUp.eventId} />
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
                  <span className="f9-status-pill">
                    {followUp.status === "needs_review"
                      ? `${followUp.openCount} open`
                      : followUp.status.replaceAll("_", " ")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </article>
      ) : null}

      {proofUsage.warningLevel !== "ok" ? (
        <article className={`f9-app-panel f9-proof-usage-alert is-${proofUsage.warningLevel}`}>
          <div>
            <span className="f9-app-kicker">Evidence usage</span>
            <h2>
              {proofUsage.warningLevel === "exhausted"
                ? "Evidence check limit reached."
                : "Evidence check usage is above 80%."}
            </h2>
          </div>
          <p>
            {proofUsage.used} of {proofUsage.limit} checks used in the current billing period.
            {proofUsage.upgradeTarget
              ? ` Move to ${proofUsage.upgradeTarget} or add an overflow pack before the next busy campaign.`
              : " Add an overflow pack before the next busy campaign."}
          </p>
          <Link className="f9-secondary-button" to="/app/billing?source=evidence#top-ups">
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
              const urgency = intelligence.priorityScore === null
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
                      {urgency} · {classification.label} · Source: {classification.sourceTypeLabel}
                    </p>
                    <p className="f9-muted-copy">
                      Next action: {intelligence.recommendedAction}
                    </p>
                    <small>{event.eventType.replaceAll("_", " ")} · Last seen <LocalTime iso={event.createdAt} /></small>
                  </div>
                  <span className="f9-status-pill">{classification.label}</span>
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
                  Next scheduled scan: {formatNextScanLabel(plan)}
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
                  <small>{watchlist.lastScannedAt ? <>Last scan <LocalTime iso={watchlist.lastScannedAt} mode="date" /></> : "Not scanned yet"}</small>
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
                    <p className="f9-muted-copy">{collection.description || "Saved for reuse."}</p>
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
    .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
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
    if (followUps.length >= COUNTER_MOVE_FOLLOW_UP_DISPLAY_LIMIT || audits.length < COUNTER_MOVE_AUDIT_PAGE_LIMIT) {
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
  const openFollowUps = followUps.filter((followUp) => readStringValue(followUp.status) !== "closed");
  const openCount = Math.max(0, Math.floor(readNumberValue(workflow?.openCount) ?? openFollowUps.length));
  const status = readWorkflowStatus(workflow?.status, openCount);
  const firstFollowUp = openFollowUps[0] ?? followUps[0] ?? null;
  const expiresAt = readIsoString(workflow?.expiresAt) ?? readIsoString(firstFollowUp?.expiresAt);
  if (
    status !== "needs_review" ||
    openCount === 0 ||
    isExpiredIso(expiresAt) ||
    (!expiresAt && isStaleCounterMoveAudit(audit.updatedAt))
  ) {
    return null;
  }
  const targetLabel = safeDashboardText(readStringValue(brief.targetLabel), "Competitive response");
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
    ownerLabel: safeDashboardText(readStringValue(workflow?.ownerLabel) ?? readStringValue(firstFollowUp?.ownerLabel), "Account owner"),
    channelLabel: formatFollowUpChannel(readStringValue(workflow?.channel) ?? readStringValue(firstFollowUp?.channel)),
    expiresAt,
    updatedAt: audit.updatedAt,
  };
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(readRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry))
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
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function isExpiredIso(value: string | null) {
  return Boolean(value && Date.parse(value) <= Date.now());
}

function isStaleCounterMoveAudit(value: string) {
  const updatedAt = Date.parse(value);
  return !Number.isFinite(updatedAt) || updatedAt + COUNTER_MOVE_FOLLOW_UP_AUDIT_FRESHNESS_MS <= Date.now();
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
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
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
          <p>Monitoring, digests, and saved evidence are unlocked. Add your next competitor while the trail is warm.</p>
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
            Your payment went through and the plan will activate as soon as Dodo confirms it. If this page still
            shows the free plan in a few minutes, email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll sort
            it out.
          </p>
        </div>
        <div className="f9-checkout-banner-actions">
          <Link className="f9-secondary-button" to="/app/billing?checkout=dodo&kind=plan">
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
        <p>Dodo is confirming the payment. This usually takes under a minute — no need to refresh.</p>
      </div>
    </article>
  );
}

function formatTrackingStatusSummary(summary: string | null | undefined) {
  if (!summary) {
    return "Tracking status will appear after the first check.";
  }

  return summary
    .replace(/Live commercial discovery/gi, "Fresh ad checks")
    .replace(/commercial discovery/gi, "competitor ad checks")
    .replace(/Commercial discovery/gi, "Competitor ad checks")
    .replace(/Browser Run/gi, "visual checks")
    .replace(/Official Meta API/gi, "alternate Meta ad access")
    .replace(/API fallback/gi, "alternate Meta ad results")
    .replace(/workspace Meta access/gi, "alternate Meta ad access")
    .replace(/fresh discovery/gi, "fresh checks")
    .replace(/cached live results/gi, "recent results")
    .replace(/cached results/gi, "recent results")
    .replace(/demo mode/gi, "sample mode");
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
