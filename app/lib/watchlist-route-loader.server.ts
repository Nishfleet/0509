import type { LoaderFunctionArgs } from "react-router";

import {
  toPublicDeliveryAttemptSummary,
  type PublicDeliveryAttemptSummary,
} from "~/lib/delivery-attempt-public";
import { toPublicDeliveryTarget, type PublicDeliveryTargetRecord } from "~/lib/delivery-target-public";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";
import {
  buildProofSummary,
  emptyProofSummary,
  isVisibleDeliveryChannel,
  maskDormantDeliveryConfig,
  resolveWatchlistRunCustomerError,
  sortByCreatedAtDesc,
  sortByUpdatedAtDesc,
  visibleDeliveryChannels,
} from "~/lib/watchlist-display";
import type { SuggestedCompetitorsPanelData } from "~/lib/auto-competitor-suggested-loader.server";

/**
 * `/app/watchlists` loader (BL-007 extraction).
 *
 * Moved out of `app/routes/app.watchlists.tsx` verbatim when the tabbed
 * competitor detail pushed that route past the 800-line ceiling. Behaviour is
 * unchanged: same queries, same payload, same honest-degrade paths. The route
 * re-exports it as `loader`, so every existing loader test still drives it
 * through `~/routes/app.watchlists`.
 */

const WATCHLIST_DELIVERY_TARGET_DISPLAY_LIMIT = 12;
const WORKSPACE_DELIVERY_TARGET_DISPLAY_LIMIT = 8;
const RECENT_DELIVERY_ATTEMPT_DISPLAY_LIMIT = 16;

/**
 * Capture attempts for the latest run, shaped for the evidence UI (issue
 * #1289). A serializable subset of `CaptureAttempt` — the component renders
 * the public reason code and a one-line label, never the internal token.
 */
export type LatestRunCaptureAttempt = {
  id: string;
  status: "succeeded" | "capture_failed" | "skipped_due_to_budget";
  reasonCode: string | null;
  urlChecked: string | null;
  checkedAt: string;
};

async function loadLatestRunCaptureAttempts(
  env: import("~/lib/env.server").AppEnv,
  run: { watchlistId: string; startedAt: string; finishedAt: string | null },
): Promise<LatestRunCaptureAttempt[]> {
  try {
    const { listCaptureAttemptsForRun } = await import(
      "~/lib/data/watchlist-run-capture-attempts.server"
    );
    const attempts = await listCaptureAttemptsForRun(env, run);
    return attempts.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      reasonCode: attempt.reasonCode,
      urlChecked: attempt.urlChecked,
      checkedAt: attempt.checkedAt,
    }));
  } catch {
    // D1 absent or read failure degrades to an empty list — the evidence
    // tab still renders the run history and refusal rows it already had.
    return [];
  }
}

export async function loadWatchlistsRoute({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { toCustomerDiscoveryStatus } = await import("~/lib/discovery-customer-copy");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getWatchlist,
    getWatchlistDeliveryConfig,
    getWorkspaceDeliveryConfig,
    listCollections,
    listDeliveryAttempts,
    listDeliveryTargets,
    listEventCandidates,
    listRecentProofCapturesForWatchlist,
    listWatchEvents,
    listWatchlistRuns,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { emptyWatchBoardCaptureWindow, loadWatchBoardCaptureWindow } = await import(
    "~/lib/watchlist-board.server"
  );
  const { resolveDeliveryConfig } = await import("~/lib/delivery-policy.server");
  const { listCreativeWallAds } = await import("~/lib/watchlist-ads.server");
  const { listWatchlistDailyActivity } = await import("~/lib/watchlist-trends.server");
  const { buildCompetitorDossier, insufficientCompetitorDossier } = await import(
    "~/lib/competitor-dossier.server"
  );
  const { computeAggressionScore } = await import("~/lib/aggression-score");
  const { buildCounterBrief } = await import("~/lib/counter-brief.server");
  const { isPaidPlanFamily } = await import("~/lib/plan-entitlements");
  const { loadSuggestedCompetitorsPanel } = await import(
    "~/lib/auto-competitor-suggested-loader.server"
  );
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const { getUserPlan } = await import("~/lib/plan.server");
  const { isUserEmailVerified } = await import("~/lib/email-verification.server");
  const { isWhatsAppProviderConfigured } = await import("~/lib/env.server");
  const { presenceNavVisible } = await import("~/lib/presence-internal-access.server");
  const {
    isSlackWebhookDeliveryCustomerFacing,
    isTeamsWebhookDeliveryCustomerFacing,
    isWhatsAppDeliveryCustomerFacing,
  } = await import("~/lib/ga-customer-surface");
  const showSlackDelivery = isSlackWebhookDeliveryCustomerFacing();
  const showTeamsDelivery = isTeamsWebhookDeliveryCustomerFacing();
  const whatsappAvailable = isWhatsAppDeliveryCustomerFacing() && isWhatsAppProviderConfigured(env);
  const url = new URL(request.url);
  // WP-24: deep-link target from alert/digest emails (`?event=<id>`).
  const highlightedEventId = url.searchParams.get("event")?.trim() || null;
  const requestedWatchlistId = url.searchParams.get("watchlist")?.trim() || null;
  // BL-006 list/detail split (brief §7): `/app/watchlists` IS the watch board.
  // A competitor's detail only loads when a band is opened (`?watchlist=<id>`),
  // so the default view no longer pays for twelve detail queries — or renders
  // a 9,000px scroll — to show a board. BL-007 turns this seam into
  // `/app/watchlists/:id`.
  const watchlistsPromise = listWatchlists(env, workspaceUserId, { includeInactive: true });
  const selectedWatchlistPromise = requestedWatchlistId
    ? getWatchlist(env, requestedWatchlistId, workspaceUserId)
    : Promise.resolve(null);
  // Workspace memory activation (#1557): the competitor detail's Library tab
  // surfaces "save captured ad to collection" and "add external evidence
  // link", so the loader carries the workspace's collections on every load.
  // Best-effort — a failure degrades to an empty list, never a 500.
  const collectionsPromise = listCollections(env, workspaceUserId).catch(() => [] as Awaited<ReturnType<typeof listCollections>>);
  const now = new Date();
  const captureWindowResult = loadWatchBoardCaptureWindow(
    env,
    workspaceUserId,
    { now },
  ).then(
    (captureWindow) => ({ captureWindow, degraded: false }),
    () => ({
      captureWindow: emptyWatchBoardCaptureWindow(now),
      degraded: true,
    }),
  );
  const [
    watchlists,
    discoveryStatus,
    plan,
    showPresenceNav,
    emailVerified,
    selectedWatchlist,
    captureWindowResultValue,
    workspaceDeliveryConfigRecord,
    collections,
  ] = await Promise.all([
    watchlistsPromise,
    resolveCommercialAdSourceStatus(env).then(toCustomerDiscoveryStatus),
    getUserPlan(env, workspaceUserId),
    presenceNavVisible(env, workspaceUserId),
    isUserEmailVerified(env, session.user.id),
    selectedWatchlistPromise,
    // Three workspace-scoped rollups feed every band's capture strip and its
    // failure state (§6.2). A board must never take the page down, so a
    // failure degrades to an all-unchecked window rather than an error
    // boundary.
    captureWindowResult,
    // The board is the DEFAULT view, so it needs the workspace delivery
    // timezone too: without it "Next check" would render in UTC while "Last
    // check" renders in the viewer's zone, and the two would disagree with
    // /app/dashboard.
    getWorkspaceDeliveryConfig(env, workspaceUserId),
    collectionsPromise,
  ]);
  const captureWindow = captureWindowResultValue.captureWindow;
  const captureWindowDegraded = captureWindowResultValue.degraded;
  const verifiedAccountEmail = emailVerified ? session.user.email : null;
  const renderedAt = now.toISOString();
  const workspaceDeliveryConfig =
    workspaceDeliveryConfigRecord ??
    buildLegacyWorkspaceConfig(workspaceUserId, Boolean(session.user.email));

  // Auto-competitor-watch Phase 2: the suggested-competitors panel is
  // paid-tier only. The loader is best-effort — a seed failure degrades to
  // an empty panel (NOT a 500), and free plans get `null` so the panel
  // omits itself cleanly. Loaded in parallel with the rest of the page
  // budget so the panel never blocks the board render.
  const suggestedCompetitorsPanelPromise: Promise<SuggestedCompetitorsPanelData | null> =
    loadSuggestedCompetitorsPanel(env, workspaceUserId, plan).catch(
      () => null,
    );

  if (!selectedWatchlist) {
    const suggestedCompetitorsPanel = await suggestedCompetitorsPanelPromise;
    return {
      renderedAt,
      captureWindow,
      captureWindowDegraded,
      watchlists,
      selectedWatchlist: null,
      highlightedEventId: null as string | null,
      eventCandidates: [] as EventCandidateRecord[],
      events: [] as WatchEventRecord[],
      runs: [],
      workspaceDeliveryConfig: maskDormantDeliveryConfig(workspaceDeliveryConfig, {
        showSlackDelivery,
        showTeamsDelivery,
        whatsappAvailable,
      }),
      watchlistDeliveryConfig: null,
      effectiveDeliveryConfig: maskDormantDeliveryConfig(
        resolveDeliveryConfig({ workspaceConfig: workspaceDeliveryConfig, watchlistConfig: null }),
        { showSlackDelivery, showTeamsDelivery, whatsappAvailable },
      ),
      deliveryTargets: [] as PublicDeliveryTargetRecord[],
      workspaceDeliveryTargets: [] as PublicDeliveryTargetRecord[],
      recentDeliveryAttempts: [] as PublicDeliveryAttemptSummary[],
      recentProofCaptures: [] as ProofCaptureRecord[],
      proofSummary: emptyProofSummary(),
      latestRunCaptureAttempts: [] as LatestRunCaptureAttempt[],
      suggestedCompetitorsPanel,
      discoveryStatus,
      plan,
      whatsappAvailable,
      showPresenceNav,
      collections,
      creativeWall: [] as Awaited<ReturnType<typeof listCreativeWallAds>>,
      trendDailyActivity: [] as Awaited<ReturnType<typeof listWatchlistDailyActivity>>,
      dossier: null as Awaited<ReturnType<typeof buildCompetitorDossier>> | null,
      aggression: null as ReturnType<typeof computeAggressionScore>,
      counterBrief: null as Awaited<ReturnType<typeof buildCounterBrief>>,
      counterBriefLocked: !isPaidPlanFamily(plan),
      canManageDelivery: !isMember,
      verifiedAccountEmail,
      deliveryTestRequestTokens: {} as Record<string, string>,
    };
  }

  const visibleDelivery = { showSlackDelivery, showTeamsDelivery, whatsappAvailable };
  const deliveryChannels = visibleDeliveryChannels(visibleDelivery);
  const [
    eventCandidates,
    events,
    runs,
    watchlistDeliveryConfig,
    watchlistDeliveryTargetsByChannel,
    workspaceDeliveryTargetsByChannel,
    recentDeliveryAttemptsByChannel,
    recentProofCaptures,
    creativeWall,
    trendDailyActivity,
    dossier,
  ] = await Promise.all([
    listEventCandidates(env, selectedWatchlist.id, 12),
    listWatchEvents(env, selectedWatchlist.id, 24),
    listWatchlistRuns(env, selectedWatchlist.id, 12),
    getWatchlistDeliveryConfig(env, selectedWatchlist.id),
    Promise.all(deliveryChannels.map((channel) =>
      listDeliveryTargets(env, workspaceUserId, {
        watchlistId: selectedWatchlist.id,
        channel,
        limit: WATCHLIST_DELIVERY_TARGET_DISPLAY_LIMIT,
      }),
    )),
    Promise.all(deliveryChannels.map((channel) =>
      listDeliveryTargets(env, workspaceUserId, {
        watchlistId: null,
        channel,
        limit: WORKSPACE_DELIVERY_TARGET_DISPLAY_LIMIT,
      }),
    )),
    Promise.all(deliveryChannels.map((channel) =>
      listDeliveryAttempts(env, {
        userId: workspaceUserId,
        watchlistId: selectedWatchlist.id,
        channel,
        limit: RECENT_DELIVERY_ATTEMPT_DISPLAY_LIMIT,
      }),
    )),
    listRecentProofCapturesForWatchlist(env, selectedWatchlist.id, 12),
    listCreativeWallAds(env, selectedWatchlist.id),
    listWatchlistDailyActivity(env, selectedWatchlist.id),
    // Dossier failure degrades to the honest not-enough-history state — it
    // must never take the watchlist page down with it.
    buildCompetitorDossier(env, selectedWatchlist.id, workspaceUserId).catch(() =>
      insufficientCompetitorDossier(),
    ),
  ]);

  // Counter-Brief plan gate: paid plans only. Computed per page load with no
  // persistence — the loader caps generation at 4s (below the module's 10s
  // default) so a hung Workers AI call cannot stall a paid page load; the
  // never-throw contract degrades to the no-brief state instead. Typical cost
  // is ~1-2s on the small shared model; tradeoff documented in
  // counter-brief.server.ts. Free plans get the upgrade line instead.
  const counterBriefEligible = isPaidPlanFamily(plan);
  const counterBrief = counterBriefEligible
    ? await buildCounterBrief(env, dossier, { timeoutMs: 4000 }).catch(() => null)
    : null;

  const effectiveDeliveryConfig = resolveDeliveryConfig({
    workspaceConfig: workspaceDeliveryConfig,
    watchlistConfig: watchlistDeliveryConfig,
  });
  const watchlistDeliveryTargets = sortByUpdatedAtDesc(watchlistDeliveryTargetsByChannel.flat())
    .slice(0, WATCHLIST_DELIVERY_TARGET_DISPLAY_LIMIT);
  const workspaceDeliveryTargets = sortByUpdatedAtDesc(workspaceDeliveryTargetsByChannel.flat())
    .slice(0, WORKSPACE_DELIVERY_TARGET_DISPLAY_LIMIT);
  const recentDeliveryAttempts = sortByCreatedAtDesc(recentDeliveryAttemptsByChannel.flat())
    .slice(0, RECENT_DELIVERY_ATTEMPT_DISPLAY_LIMIT);
  const publicWatchlistDeliveryTargets = isMember
    ? []
    : watchlistDeliveryTargets
        .filter((target) => isVisibleDeliveryChannel(target.channel, visibleDelivery))
        .map((target) => toPublicDeliveryTarget(target, { verifiedAccountEmail }));

  // Issue #1289: capture attempts for the latest run, so the evidence tab
  // can show what the most recent check actually checked — including failed
  // and skipped captures with a public reason code. Loaded only for the
  // latest run to keep the page load bounded; older runs stay as quiet lines.
  const latestRunForCaptureAttempts = runs[0] ?? null;
  const latestRunCaptureAttempts = latestRunForCaptureAttempts
    ? await loadLatestRunCaptureAttempts(env, latestRunForCaptureAttempts)
    : [];
  const suggestedCompetitorsPanel = await suggestedCompetitorsPanelPromise;

  return {
    renderedAt,
    captureWindow,
    captureWindowDegraded,
    watchlists,
    selectedWatchlist,
    highlightedEventId,
    eventCandidates,
    events,
    runs: runs.map((run) => ({
      ...run,
      errorMessage: resolveWatchlistRunCustomerError(run, plan),
    })),
    workspaceDeliveryConfig: maskDormantDeliveryConfig(workspaceDeliveryConfig, visibleDelivery),
    watchlistDeliveryConfig: watchlistDeliveryConfig
      ? maskDormantDeliveryConfig(watchlistDeliveryConfig, visibleDelivery)
      : null,
    effectiveDeliveryConfig: maskDormantDeliveryConfig(effectiveDeliveryConfig, visibleDelivery),
    deliveryTargets: publicWatchlistDeliveryTargets,
    workspaceDeliveryTargets: isMember
      ? []
      : workspaceDeliveryTargets
          .filter((target) => isVisibleDeliveryChannel(target.channel, visibleDelivery))
          .map((target) => toPublicDeliveryTarget(target, { verifiedAccountEmail })),
    recentDeliveryAttempts: recentDeliveryAttempts
      .filter((attempt) => isVisibleDeliveryChannel(attempt.channel, visibleDelivery))
      .map(toPublicDeliveryAttemptSummary),
    recentProofCaptures,
    proofSummary: buildProofSummary(recentProofCaptures),
    latestRunCaptureAttempts,
    suggestedCompetitorsPanel,
    discoveryStatus,
    plan,
    whatsappAvailable,
    showPresenceNav,
    collections,
    creativeWall,
    trendDailyActivity,
    dossier,
    // Deterministic, public-formula score — computed server-side so SSR and
    // hydration share one "now".
    aggression: computeAggressionScore(dossier),
    counterBrief,
    counterBriefLocked: !counterBriefEligible,
    canManageDelivery: !isMember,
    verifiedAccountEmail,
    deliveryTestRequestTokens: Object.fromEntries(
      publicWatchlistDeliveryTargets
        .filter((target) => target.channel === "email")
        .map((target) => [target.id, crypto.randomUUID()]),
    ),
  };
}

export function buildLegacyWorkspaceConfig(
  userId: string,
  hasEmail: boolean,
): WorkspaceDeliveryConfigRecord {
  return {
    id: `legacy-workspace-${userId}`,
    userId,
    sensitivityMode: "balanced",
    // FIX-6: legacy UI fallback matches stored defaults (instant off until a
    // real config row exists; new workspaces get an explicit true snapshot).
    instantEnabled: false,
    digestEnabled: true,
    digestCadencePreference: "plan_default",
    emailEnabled: hasEmail,
    whatsappEnabled: false,
    slackEnabled: false,
    teamsEnabled: false,
    quietHours: null,
    timezone: null,
    createdAt: "",
    updatedAt: "",
  };
}
