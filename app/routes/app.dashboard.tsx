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

import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { toPublicDeliveryTarget } from "~/lib/delivery-target-public";
import { buildSearchParams } from "~/lib/normalize";
import { formatNextScanLabel } from "~/lib/schedule-display";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const meta = () => [{ title: "Dashboard | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCustomerMetaConnection,
    listAgentMemory,
    listCollections,
    listDeliveryTargets,
    listDigests,
    listRecentWorkspaceProofCaptures,
    listSavedQueries,
    listWatchEvents,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { safeAgentMemoryRecord, summarizeAgentMemoryValue } = await import("~/lib/agent-memory.server");
  const { getProofUsageSummary } = await import("~/lib/plan.server");
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  const { getSuccessfulProofCaptureStatsForUser, getSuccessfulRunStatsForUserBetween, getUserPlanBillingInfo } = await import(
    "~/lib/data.server"
  );
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
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
    agentMemories,
  ] = await Promise.all([
    listSavedQueries(env, workspaceUserId),
    listCollections(env, workspaceUserId),
    listWatchlists(env, workspaceUserId),
    listDigests(env, workspaceUserId),
    resolveCommercialAdSourceStatus(env),
    getCustomerMetaConnection(env, workspaceUserId),
    getProofUsageSummary(env, workspaceUserId),
    getUserPlanBillingInfo(env, workspaceUserId),
    listWorkspaceMembers(env, workspaceUserId),
    getWorkspaceReadiness(env, workspaceUserId),
    listAgentMemory(env, workspaceUserId, { limit: 5 }),
  ]);
  const plan = billingInfo.plan;
  const hasPaymentIssue =
    plan !== "free" &&
    (billingInfo.dodoStatus === "subscription.failed" ||
      billingInfo.dodoStatus === "subscription.on_hold");
  const overnightSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [recentEvents, recentProofCaptures, deliveryTargets, overnightStats, successfulProofStats] = await Promise.all([
    Promise.all(watchlists.slice(0, 6).map((watchlist) => listWatchEvents(env, watchlist.id, 6))).then((groups) =>
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
    agentMemories: agentMemories.map((memory) => {
      const safeMemory = safeAgentMemoryRecord(memory);
      return {
        id: safeMemory.id,
        key: safeMemory.key,
        scope: safeMemory.scope,
        preview: summarizeAgentMemoryValue(safeMemory.value),
        updatedAt: safeMemory.updatedAt,
      };
    }),
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
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { createWatchlist, getSavedQuery, touchSavedQueryRun } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "run-saved-query") {
    const savedQueryId = String(formData.get("savedQueryId") ?? "");
    const savedQuery = await getSavedQuery(env, savedQueryId, workspaceUserId);

    if (!savedQuery) {
      return {
        ok: false,
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
        message: "Saved query not found.",
      };
    }

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    if (!watchlistLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: "You have reached your competitor tracking limit.",
      };
    }

    const watchlist = await createWatchlist(env, workspaceUserId, {
      name: `${savedQuery.name} watch`,
      targetType: "saved_query",
      targetId: savedQuery.id,
      targetFingerprint: savedQuery.fingerprint,
      targetLabel: savedQuery.name,
      targetCountry: savedQuery.normalizedQuery.filters.country,
    });

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);

    return {
      ok: true,
      message: `Now tracking ${savedQuery.name}. First scan is running now.`,
    };
  }

  return {
    ok: false,
    message: "Unknown dashboard action.",
  };
}

export default function AppDashboardRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const savedQueries = data.savedQueries ?? [];
  const collections = data.collections ?? [];
  const watchlists = data.watchlists ?? [];
  const digests = data.digests ?? [];
  const recentEvents = data.recentEvents ?? [];
  const recentProofCaptures = data.recentProofCaptures ?? [];
  const deliveryTargets = data.deliveryTargets ?? [];
  const proofUsage = data.proofUsage ?? { warningLevel: "ok", used: 0, limit: 0, remaining: 0, plan: "free" };
  const plan = data.plan ?? "free";
  const nextScanLabel = data.nextScanLabel ?? formatNextScanLabel(plan);
  const hasPaymentIssue = Boolean(data.hasPaymentIssue);
  const teamMemberCount = data.teamMemberCount ?? 0;
  const checkoutReturn = Boolean(data.checkoutReturn);
  const metaHeading =
    data.metaStatus.status === "healthy"
      ? "Ready to track competitors"
      : data.metaStatus.status === "cache_only"
        ? "Recent results available"
      : data.metaStatus.status === "demo"
        ? "Setup needed"
      : data.metaStatus.status === "disabled"
          ? "Tracking unavailable"
        : "Needs attention";
  const competitorCount = watchlists.length;
  const activeWatchlists = watchlists.filter((watchlist) => watchlist.isActive).length;
  const confirmedChanges = recentEvents.filter((event) => event.status === "confirmed" || event.status === "detected").length;
  const overnightCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const overnightMoves = recentEvents.filter(
    (event) =>
      (event.status === "confirmed" || event.status === "detected") &&
      Date.parse(event.createdAt) >= overnightCutoff,
  ).length;
  const recentSuccessfulProofs = recentProofCaptures.filter((capture) => capture.status === "succeeded").length;
  const hasProofAttempts = recentProofCaptures.length > 0;
  const successfulProofs = data.successfulProofStats?.count ?? recentSuccessfulProofs;
  const sentDigests = digests.filter((digest) => digest.delivery?.status === "sent").length;
  const latestScanAt = watchlists
    .map((watchlist) => watchlist.lastScannedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  const hasEmailDelivery = deliveryTargets.some(
    (target) => target.channel === "email" && target.isOptedIn && !target.isPaused && !target.optedOutAt,
  );
  const hasSlackDelivery = deliveryTargets.some(
    (target) =>
      target.channel === "slack" &&
      target.isOptedIn &&
      !target.isPaused &&
      !target.optedOutAt &&
      Boolean(target.lastSuccessfulDeliveryAt),
  );
  const slackNeedsProof = deliveryTargets.some(
    (target) => target.channel === "slack" && !target.isPaused && !target.lastSuccessfulDeliveryAt,
  );
  const deliveryReady = hasEmailDelivery || hasSlackDelivery;
  const deliveryComplete = sentDigests > 0 || hasSlackDelivery;
  const firstCompetitorReady = competitorCount > 0;
  const proofReady = successfulProofs > 0;
  const sourceReady = data.metaStatus.status === "healthy";
  const readinessReviewPaths: Record<string, string> = {
    first_competitor: "/search",
    first_watchlist: "/app/watchlists",
    first_proof: "/app/watchlists",
    first_digest: "/app/digests",
    delivery: "/app/sources",
    billing: "/app/billing",
    team: "/app/team",
    source: "/app/sources",
    api: "/app/sources",
    mcp: "/app/sources",
    memory: "/app/clients",
    client_room: "/app/clients",
  };
  const setupItems = data.workspaceReadiness.items
    .filter((item) => item.status !== "not_applicable")
    .map((item) => ({
      label: item.label,
      detail: item.detail,
      done: item.status === "ready",
      href: item.action?.href ?? readinessReviewPaths[item.id] ?? "/app",
    }));
  const lifecycleNudges = data.workspaceReadiness.nudges ?? [];
  const agentMemories = data.agentMemories ?? [];
  const agentMemoryCount = data.workspaceReadiness.counts?.agentMemoryEntries ?? agentMemories.length;
  const hasAgentMemory = agentMemoryCount > 0;
  const latestAgentMemory = agentMemories[0] ?? null;
  const statusCards = [
    {
      label: "Competitors watched",
      value: competitorCount,
      detail: competitorCount > 0 ? `${activeWatchlists} active` : "Add your first competitor",
    },
    {
      label: "Changes found",
      value: confirmedChanges,
      detail: recentEvents.length > 0 ? "Recent watch events" : "Waiting for first scan",
    },
    {
      label: "Evidence checks",
      value: proofUsage.used ?? successfulProofs,
      detail: proofUsage.limit ? `${proofUsage.remaining} left this month` : `${successfulProofs} recent successes`,
    },
    {
      label: "Digests sent",
      value: sentDigests,
      detail: sentDigests > 0 ? "Email trail active" : "No digest sent yet",
    },
  ];
  const overnightAdsSeen = data.overnightStats?.adsSeen ?? 0;
  const overnightRuns = data.overnightStats?.runs ?? 0;
  const overnightWatchlists = data.overnightStats?.watchlistsChecked ?? 0;
  const hasOvernightCheck = overnightRuns > 0 || overnightWatchlists > 0;
  const overnightCheckScope = overnightWatchlists > 0
    ? `${overnightWatchlists} competitor${overnightWatchlists === 1 ? "" : "s"}`
    : `${overnightRuns} scan${overnightRuns === 1 ? "" : "s"}`;
  const proofCount = successfulProofs;
  const watchedState = activeWatchlists > 0
    ? `${activeWatchlists} active competitor${activeWatchlists === 1 ? "" : "s"}`
    : firstCompetitorReady
      ? "Saved but paused"
      : "Not started";
  const valueLoopItems = [
    {
      label: "Watched",
      state: watchedState,
      detail: firstCompetitorReady
        ? `${competitorCount} competitor${competitorCount === 1 ? "" : "s"} saved for retained monitoring.`
        : "Add one competitor website to start the retained watch.",
      done: activeWatchlists > 0,
      href: "/app/watchlists",
    },
    {
      label: "Checked",
      state: hasOvernightCheck
        ? `${overnightAdsSeen} ad${overnightAdsSeen === 1 ? "" : "s"} checked`
        : activeWatchlists > 0
          ? `Next sweep: ${nextScanLabel}`
          : "Waiting for first sweep",
      detail: hasOvernightCheck
        ? overnightAdsSeen > 0
          ? `Five to Nine looked across ${overnightCheckScope} in the last 24 hours.`
          : `Quiet still counts: Five to Nine looked across ${overnightCheckScope}.`
        : "The first sweep starts after a competitor is under watch.",
      done: hasOvernightCheck,
      href: "/app/watchlists",
    },
    {
      label: "Changed",
      state: confirmedChanges > 0
        ? `${confirmedChanges} move${confirmedChanges === 1 ? "" : "s"} found`
        : "No move yet",
      detail: confirmedChanges > 0
        ? "Recent watch events are ready for review."
        : "Quiet scans keep the market desk clean until a real change appears.",
      done: confirmedChanges > 0,
      href: "/app/watchlists",
    },
    {
      label: "Proved",
      state: proofReady
        ? `${proofCount} evidence check${proofCount === 1 ? "" : "s"}`
        : "Proof waiting",
      detail: proofReady
        ? "Screenshots and landing-page evidence are attached to the trail."
        : hasProofAttempts
          ? "Evidence attempts have run, but no successful proof is attached yet."
        : "The first proof appears after a watchlist catches or confirms a tracked page.",
      done: proofReady,
      href: "/app/watchlists",
    },
    {
      label: "Delivered",
      state: sentDigests > 0
        ? `${sentDigests} digest${sentDigests === 1 ? "" : "s"} sent`
        : hasSlackDelivery
          ? "Slack ready"
          : hasEmailDelivery
            ? "Email ready"
            : slackNeedsProof
              ? "Slack needs proof"
              : "Delivery not set",
      detail: sentDigests > 0
        ? "Proof-backed summaries have already left the app."
        : deliveryReady
          ? "A delivery path exists for future eligible briefs."
          : "Connect email or Slack when the team wants the proof pushed out.",
      done: deliveryComplete,
      href: sentDigests > 0 ? "/app/digests" : "/app/sources",
    },
    {
      label: "Remembered",
      state: hasAgentMemory
        ? `${agentMemoryCount} memory ${agentMemoryCount === 1 ? "entry" : "entries"}`
        : "No context saved",
      detail: hasAgentMemory
        ? "Future reports and briefs can use saved goals, tone, and review preferences."
        : "Save goals, tone, or review cadence so the next agent run has context.",
      done: hasAgentMemory,
      href: "/app/clients",
    },
  ];
  const readyCount = data.workspaceReadiness.readyCount;
  const briefTitle = confirmedChanges > 0
    ? `${confirmedChanges} move${confirmedChanges === 1 ? "" : "s"} to review`
    : firstCompetitorReady
      ? "Watching for the first change"
      : "Add your first competitor";
  const briefSummary = confirmedChanges > 0
    ? recentEvents.slice(0, 3).map((event) => event.title).join(". ")
    : hasOvernightCheck
      ? `All quiet — ${overnightAdsSeen} ad${overnightAdsSeen === 1 ? "" : "s"} checked across ${overnightCheckScope} in the last day. No changes worth your time.`
      : firstCompetitorReady
        ? "Your watchlist is ready. Refresh tracking to capture proof when the landing page or offer changes."
        : "Paste a competitor website and Five to Nine will create the first market watch.";
  const boardRows = recentEvents.length > 0
    ? recentEvents.slice(0, 4).map((event) => ({
        name: event.title,
        change: event.summary,
        source: event.eventType.replaceAll("_", " "),
        state: event.status.replaceAll("_", " "),
      }))
    : watchlists.slice(0, 4).map((watchlist) => ({
        name: watchlist.name,
        change: watchlist.targetLabel,
        source: watchlist.targetType.replaceAll("_", " "),
        state: watchlist.isActive ? "tracking" : "paused",
      }));

  return (
    <section className="f9-app-stack">
      <div className="f9-watch-strip" role="status">
        <span className="f9-watch-dot" aria-hidden="true" />
        <strong>
          {activeWatchlists > 0
            ? `On watch — ${activeWatchlists} competitor${activeWatchlists === 1 ? "" : "s"}`
            : competitorCount > 0
              ? "Watch paused"
              : "Watch idle — add a competitor to start"}
        </strong>
        <span className="f9-watch-strip-detail">
          {hasOvernightCheck
            ? `${overnightAdsSeen} ad${overnightAdsSeen === 1 ? "" : "s"} checked in the last day — quiet means we looked`
            : activeWatchlists > 0
              ? `Next sweep: ${nextScanLabel}`
              : competitorCount > 0
                ? "All watchlists paused — resume one to keep watch"
                : "Your first sweep is scheduled the moment you add one"}
        </span>
      </div>
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
      <section className="f9-market-desk" aria-label="Five to Nine market moves dashboard">
        <div className="f9-market-desk-top">
          <strong>Five to Nine</strong>
          <Form action="/search" className="f9-market-search" method="get">
            <label htmlFor="dashboard-market-search">Competitor website</label>
            <input
	              id="dashboard-market-search"
	              name="website"
	              placeholder="Search market moves or paste competitor website"
	              type="text"
	            />
            <SubmitButton getAction="/search" pendingLabel="Searching…">Track</SubmitButton>
          </Form>
        </div>

        <div className="f9-market-desk-body">
          <aside className="f9-revenue-brief-card" aria-label="Revenue brief">
            <div className="f9-revenue-brief-token" aria-hidden="true">59</div>
            <span>Revenue brief</span>
            <strong>{briefTitle}</strong>
            <p>{briefSummary}</p>
            <div>
              <small>Screenshot</small>
              <em>{proofReady ? "ready" : "waiting"}</em>
            </div>
            <div>
              <small>Landing page</small>
              <em>{firstCompetitorReady ? "watched" : "add site"}</em>
            </div>
            <div>
              <small>Offer</small>
              <em>{confirmedChanges > 0 ? "text changed" : "quiet"}</em>
            </div>
          </aside>

          <div className="f9-market-board">
            <div className="f9-market-board-head">
              <div>
                <span className="f9-app-kicker">
                  <WakeGreeting />
                </span>
                <h2>
                  {overnightMoves > 0
                    ? `${overnightMoves} move${overnightMoves === 1 ? "" : "s"} found while you slept`
                    : firstCompetitorReady
                      ? "Competitor changes"
                      : "Add your first competitor"}
                </h2>
              </div>
              <span className="f9-board-time">05:09</span>
            </div>

            <div className="f9-market-board-metrics">
              {statusCards.map((card) => (
                <article key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.detail}</small>
                </article>
              ))}
            </div>

            <div className="f9-market-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>

            {boardRows.length > 0 ? (
              <div className="f9-market-table">
                {boardRows.map((row) => (
                  <div key={`${row.name}-${row.state}`}>
                    <strong>{row.name}</strong>
                    <span>{row.change}</span>
                    <small>{row.source}</small>
                    <em>{row.state}</em>
                  </div>
                ))}
              </div>
            ) : (
              <div className="f9-market-empty">
                <h3>Add your first competitor.</h3>
                <p>
                  Paste a competitor website above to find their ads and start watching visible offer text, CTA,
                  headline, and form changes.
                </p>
                <Link className="f9-primary-button" to="/search">
                  Start tracking
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="f9-dashboard-setup-row">
      <aside className="f9-setup-card" aria-label="Account setup status">
          <div>
            <span className="f9-app-kicker">Setup checklist</span>
            <h3>{readyCount} of {setupItems.length} ready</h3>
          </div>
          <div className="f9-setup-list">
            {setupItems.map((item) => (
              <div className={item.done ? "is-done" : ""} key={item.label}>
                <span>{item.done ? "Done" : "Next"}</span>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
                <Link to={item.href}>{item.done ? "Review" : "Open"}</Link>
              </div>
            ))}
          </div>
        </aside>

        <div className="f9-dashboard-quick-links">
          <Link to="/search?website=https%3A%2F%2Fnykaa.com">Try Nykaa</Link>
          <Link to="/search?website=https%3A%2F%2Fmamaearth.in">Try Mamaearth</Link>
          {savedQueries.length > 0 ? <Link to="/search">Saved searches</Link> : null}
          <Link to="/app/watchlists">Open watchlists</Link>
          <Link to="/app/clients">Save agent memory</Link>
        </div>
      </section>

      <article className="f9-app-panel f9-value-loop-panel" aria-label="Retained value loop">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Retained value loop</span>
            <h2>What Five to Nine did for you</h2>
            <p className="f9-muted-copy">
              The retained account loop is watched, checked, changed, proved, and delivered.
            </p>
          </div>
          <Link className="f9-secondary-button" to="/app/watchlists">
            Review proof trail
          </Link>
        </div>
        <div className="f9-value-loop-list">
          {valueLoopItems.map((item, index) => (
            <Link className={`f9-value-loop-step ${item.done ? "is-done" : ""}`} key={item.label} to={item.href}>
              <span className="f9-value-loop-index">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
              <em>{item.state}</em>
              <p>{item.detail}</p>
            </Link>
          ))}
        </div>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Lifecycle nudges</span>
            <h2>What to unblock next</h2>
          </div>
        </div>
        <div className="f9-work-list is-compact">
          {lifecycleNudges.map((nudge) => (
            <div className="f9-work-row" key={nudge.title}>
              <div>
                <strong>{nudge.title}</strong>
                <p className="f9-muted-copy">{nudge.detail}</p>
              </div>
              <Link className="f9-secondary-button" to={nudge.href}>
                Open
              </Link>
            </div>
          ))}
        </div>
      </article>

      {proofUsage.warningLevel !== "ok" ? (
        <article className={`f9-app-panel f9-proof-usage-alert is-${proofUsage.warningLevel}`}>
          <div>
            <span className="f9-app-kicker">Proof usage</span>
            <h2>
              {proofUsage.warningLevel === "exhausted"
                ? "Evidence check limit reached."
                : "Evidence check usage is above 80%."}
            </h2>
          </div>
          <p>
            {proofUsage.used} of {proofUsage.limit} evidence checks used in the last 30 days.
            {proofUsage.upgradeTarget
              ? ` Move to ${proofUsage.upgradeTarget} or add an overflow pack before the next noisy launch.`
              : " Add an overflow pack before the next noisy launch."}
          </p>
          <Link className="f9-secondary-button" to="/#pricing">
            Review capacity
          </Link>
        </article>
      ) : null}

      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>
            {actionData.message}
            {"error" in actionData && actionData.error === "plan_limit_exceeded" ? (
              <>
                {" "}
                <Link to="/#pricing">View plans</Link> to raise the limit.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-activity-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Live activity</span>
              <h2>What changed recently</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/watchlists">
              Manage tracking
            </Link>
          </div>

          {recentEvents.length === 0 ? (
            <div className="f9-dashboard-empty">
              <h3>No competitor changes captured yet.</h3>
              <p>
                Add a competitor website, start tracking from the search results, then refresh the watchlist to capture
                the first evidence-backed change trail.
              </p>
              <Link className="f9-primary-button" to="/search">
                Add first competitor
              </Link>
            </div>
          ) : (
            <div className="f9-work-list">
              {recentEvents.map((event) => (
                <article className="f9-work-row" key={event.id}>
                  <div>
                    <h3>{event.title}</h3>
                    <p className="f9-muted-copy">{event.summary}</p>
                    <small>{event.eventType.replaceAll("_", " ")} · <LocalTime iso={event.createdAt} /></small>
                  </div>
                  <span className="f9-status-pill">{event.status.replaceAll("_", " ")}</span>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="f9-app-panel f9-ops-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Operating status</span>
              <h2>Monitoring readiness</h2>
            </div>
          </div>
          <div className="f9-readiness-list">
            <div>
              <span className={`f9-status-dot ${sourceReady ? "is-good" : "is-attention"}`} />
              <strong>{metaHeading}</strong>
              <p>{formatTrackingStatusSummary(data.metaStatus.summary)}</p>
            </div>
            <div>
              <span className={`f9-status-dot ${firstCompetitorReady ? "is-good" : "is-attention"}`} />
              <strong>{firstCompetitorReady ? "Tracking is configured" : "No competitor watch yet"}</strong>
              <p>{latestScanAt ? <>Last scan <LocalTime iso={latestScanAt} />.</> : "Add a competitor to start monitoring."}</p>
            </div>
            <div>
              <span className={`f9-status-dot ${proofUsage.remaining > 0 ? "is-good" : "is-attention"}`} />
              <strong>Evidence checks</strong>
              <p>{proofUsage.limit ? `${proofUsage.remaining} of ${proofUsage.limit} checks left.` : "Evidence checks unlock on a paid plan."}</p>
            </div>
            <div>
              <span className={`f9-status-dot ${hasEmailDelivery ? "is-good" : "is-attention"}`} />
              <strong>{hasEmailDelivery ? "Email alerts ready" : "Email alert target missing"}</strong>
              <p>{hasEmailDelivery ? "Digest and instant alert delivery can use the saved target." : "Add delivery from a watchlist after creating it."}</p>
            </div>
            <div>
              <span className={`f9-status-dot ${hasAgentMemory ? "is-good" : "is-attention"}`} />
              <strong>{hasAgentMemory ? "Agent memory ready" : "Agent memory missing"}</strong>
              <p>
                {latestAgentMemory
                  ? `${latestAgentMemory.key}: ${latestAgentMemory.preview}`
                  : "Save account context before the next report, brief, or client-room handoff."}
              </p>
            </div>
          </div>
          <Link className="f9-secondary-button" to="/app/sources">
            Review tracking access
          </Link>
        </article>
      </div>

      <article className="f9-app-panel f9-callout-panel">
        <span className="f9-app-kicker">Production proof</span>
        <p>
          This checklist shows your account setup. Broad launch proof is separate: recent monitoring, proof capture,
          digest delivery, Slack delivery, Dodo portal confirmation, and external uptime monitoring stay visible on the
          public status page.
        </p>
        <Link className="f9-secondary-button" to="/status">
          Open status
        </Link>
      </article>

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Competitor watches</span>
              <h2>Who is being watched</h2>
              {watchlists.length > 0 ? (
                <p className="f9-muted-copy">
                  Next scheduled scan: {formatNextScanLabel(plan)}
                </p>
              ) : null}
            </div>
            <Link className="f9-secondary-button" to="/app/watchlists">
              Open watchlists
            </Link>
          </div>
          {watchlists.length === 0 ? (
            <div className="f9-dashboard-empty is-compact">
              <h3>No competitors yet.</h3>
              <p>Start with one site. Five to Nine will remember the ads, notes, and page evidence.</p>
            </div>
          ) : (
            <div className="f9-work-list is-compact">
              {watchlists.slice(0, 5).map((watchlist) => (
                <div className="f9-work-row" key={watchlist.id}>
                  <div>
                    <h3>{watchlist.name}</h3>
                    <p className="f9-muted-copy">{watchlist.targetType.replace("_", " ")} · {watchlist.targetLabel}</p>
                  </div>
                  <small>{watchlist.lastScannedAt ? <>Last scan <LocalTime iso={watchlist.lastScannedAt} mode="date" /></> : "Not scanned yet"}</small>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Saved evidence</span>
              <h2>Useful examples for reuse</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/collections">
              Open boards
            </Link>
          </div>
          <div className="f9-work-list is-compact">
            {collections.slice(0, 4).map((collection) => (
              <div className="f9-work-row" key={collection.id}>
                <div>
                  <h3>{collection.name}</h3>
                  <p className="f9-muted-copy">{collection.description || "No description yet."}</p>
                </div>
              </div>
            ))}
            {collections.length === 0 ? (
              <div className="f9-dashboard-empty is-compact">
                <h3>No saved evidence yet.</h3>
                <p>Save ads, notes, and landing-page evidence from search or watchlist results.</p>
              </div>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
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
          <p>Monitoring, digests, and evidence checks are unlocked. Add your next competitor while the trail is warm.</p>
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
          <Link className="f9-secondary-button" to="/app?checkout=dodo">
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
