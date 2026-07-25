import { useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { CompetitorDossierPanel } from "~/components/competitor-dossier";
import { CreativeWall } from "~/components/creative-wall";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { WatchlistTrends } from "~/components/watchlist-trends";
import { BulkSelectBar } from "~/components/watchlists/bulk-select-bar";
import { CandidateHistory } from "~/components/watchlists/candidate-history";
import { DeliverySettingsCard } from "~/components/watchlists/delivery-settings-card";
import { DeliveryTargetsSection } from "~/components/watchlists/delivery-targets-section";
import { EventChangesSection } from "~/components/watchlists/event-changes-section";
import { FirstScanBanner } from "~/components/watchlists/first-scan-banner";
import { FirstRunWaitArc } from "~/components/first-run-wait";
import { RecentChecksSection } from "~/components/watchlists/recent-checks-section";
import { RecentEvidenceChecksCard } from "~/components/watchlists/recent-evidence-checks-card";
import { TrackingStatusCard } from "~/components/watchlists/tracking-status-card";
import { WatchlistSetupCard } from "~/components/watchlists/watchlist-setup-card";
import { CopyButton } from "~/components/copy-button";
import { EmptyState } from "~/components/empty-state";
import { LocalTime } from "~/components/local-time";
import { ProofGlossary } from "~/components/proof-glossary";
import { SubmitButton } from "~/components/submit-button";
import type { AppEnv } from "~/lib/env.server";
import {
  emptyCompetitorWebsite,
  hasInvalidCompetitorWebsite,
  isHttpCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import { toPublicDeliveryTarget, type PublicDeliveryTargetRecord } from "~/lib/delivery-target-public";
import {
  toPublicDeliveryAttemptSummary,
  type PublicDeliveryAttemptSummary,
} from "~/lib/delivery-attempt-public";
import { toCustomerDiscoveryStatus } from "~/lib/discovery-customer-copy";
import { buildWatchlistInsightDepth } from "~/lib/insight-depth";
import { normalizeSavedQuery } from "~/lib/normalize";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { formatNextScanLabel } from "~/lib/schedule-display";
import { normalizeTimeZone, safeTimeZone } from "~/lib/safe-timezone";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import {
  isSlackDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
  slackDeliveryUnavailableMessage,
  whatsappDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";
import { createReportId } from "~/lib/report";
import { watchlistLiveSearchHref, watchlistSavedAdsHref } from "~/lib/watchlist-links";
import {
  formatWatchlistTargetNoun,
  formatWatchlistTrackingRole,
  normalizeWatchlistTrackingRole,
} from "~/lib/watchlist-role";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WorkspaceDeliveryConfigRecord,
  WatchlistRunRecord,
} from "~/lib/types";
import {
  buildLastAttemptByEventId,
  buildProofSummary,
  emptyProofSummary,
  firstScanPollingKey,
  formatWatchlistRefreshFailure,
  isDeliveryTestRequestToken,
  isVisibleDeliveryChannel,
  maskDormantDeliveryConfig,
  normalizeSensitivityMode,
  resolveEmptyWatchlistEventCopy,
  resolveWatchlistListScanPresentation,
  resolveWatchlistRunCustomerError,
  resolveWatchlistRunTiming,
  resolveWatchlistTrackingPresentation,
  sortByCreatedAtDesc,
  sortByUpdatedAtDesc,
  visibleDeliveryChannels,
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
const WATCHLIST_DELIVERY_TARGET_DISPLAY_LIMIT = 12;
const WORKSPACE_DELIVERY_TARGET_DISPLAY_LIMIT = 8;
const RECENT_DELIVERY_ATTEMPT_DISPLAY_LIMIT = 16;
// Hard cap on ids accepted by the bulk pause/resume action. Bounds per-request
// D1 work: `formData.getAll` is unbounded in a raw POST and each id runs a
// scoped write (resume also a lookup + plan-limit count). No legitimate
// workspace selects more than its watchlist count (agency caps active
// watchlists at 75); 200 clears real "select all" use with paused-row headroom.
const MAX_BULK_WATCHLIST_IDS = 200;
const DELIVERY_MANAGEMENT_INTENTS = new Set([
  "save-delivery-config",
  "add-delivery-target",
  "send-test-email",
  "toggle-delivery-target",
]);

export function HydrateFallback() {
  return <DashboardRouteLoading title="Competitors" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { toCustomerDiscoveryStatus } = await import("~/lib/discovery-customer-copy");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getWatchlist,
    getWatchlistDeliveryConfig,
    getWorkspaceDeliveryConfig,
    listDeliveryAttempts,
    listDeliveryTargets,
    listEventCandidates,
    listRecentProofCapturesForWatchlist,
    listWatchEvents,
    listWatchlistRuns,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { resolveDeliveryConfig } = await import("~/lib/delivery-policy.server");
  const { listCreativeWallAds } = await import("~/lib/watchlist-ads.server");
  const { listWatchlistDailyActivity } = await import("~/lib/watchlist-trends.server");
  const { buildCompetitorDossier, insufficientCompetitorDossier } = await import(
    "~/lib/competitor-dossier.server"
  );
  const { computeAggressionScore } = await import("~/lib/aggression-score");
  const { buildCounterBrief } = await import("~/lib/counter-brief.server");
  const { isPaidPlanFamily } = await import("~/lib/plan-entitlements");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const { getUserPlan } = await import("~/lib/plan.server");
  const { isUserEmailVerified } = await import("~/lib/email-verification.server");
  const { isWhatsAppProviderConfigured } = await import("~/lib/env.server");
  const { presenceNavVisible } = await import("~/lib/presence-internal-access.server");
  const showSlackDelivery = isSlackDeliveryCustomerFacing();
  const whatsappAvailable = isWhatsAppDeliveryCustomerFacing() && isWhatsAppProviderConfigured(env);
  const url = new URL(request.url);
  // WP-24: deep-link target from alert/digest emails (`?event=<id>`).
  const highlightedEventId = url.searchParams.get("event")?.trim() || null;
  const requestedWatchlistId = url.searchParams.get("watchlist");
  // Deep links (`?watchlist=<id>`) fetch the selected watchlist concurrently
  // with the list; the default view only needs the list first to know which
  // watchlist is newest, so it chains off the same in-flight promise.
  const watchlistsPromise = listWatchlists(env, workspaceUserId, { includeInactive: true });
  const selectedWatchlistPromise = (async () => {
    const id = requestedWatchlistId ?? (await watchlistsPromise)[0]?.id ?? null;
    return id ? getWatchlist(env, id, workspaceUserId) : null;
  })();
  const [watchlists, discoveryStatus, plan, showPresenceNav, emailVerified, selectedWatchlist] =
    await Promise.all([
      watchlistsPromise,
      resolveCommercialAdSourceStatus(env).then(toCustomerDiscoveryStatus),
      getUserPlan(env, workspaceUserId),
      presenceNavVisible(env, workspaceUserId),
      isUserEmailVerified(env, session.user.id),
      selectedWatchlistPromise,
    ]);
  const verifiedAccountEmail = emailVerified ? session.user.email : null;
  const renderedAt = new Date().toISOString();

  if (!selectedWatchlist) {
    return {
      renderedAt,
      watchlists,
      selectedWatchlist: null,
      highlightedEventId: null as string | null,
      eventCandidates: [] as EventCandidateRecord[],
      events: [] as WatchEventRecord[],
      runs: [],
      workspaceDeliveryConfig: buildLegacyWorkspaceConfig(workspaceUserId, Boolean(session.user.email)),
      watchlistDeliveryConfig: null,
      effectiveDeliveryConfig: buildLegacyWorkspaceConfig(workspaceUserId, Boolean(session.user.email)),
      deliveryTargets: [] as PublicDeliveryTargetRecord[],
      workspaceDeliveryTargets: [] as PublicDeliveryTargetRecord[],
      recentDeliveryAttempts: [] as PublicDeliveryAttemptSummary[],
      recentProofCaptures: [] as ProofCaptureRecord[],
      proofSummary: emptyProofSummary(),
      discoveryStatus,
      plan,
      whatsappAvailable,
      showPresenceNav,
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

  const visibleDelivery = { showSlackDelivery, whatsappAvailable };
  const deliveryChannels = visibleDeliveryChannels(visibleDelivery);
  const [
    eventCandidates,
    events,
    runs,
    workspaceDeliveryConfigRecord,
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
    getWorkspaceDeliveryConfig(env, workspaceUserId),
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

  const workspaceDeliveryConfig =
    workspaceDeliveryConfigRecord ??
    buildLegacyWorkspaceConfig(workspaceUserId, Boolean(session.user.email));
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

  return {
    renderedAt,
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
    discoveryStatus,
    plan,
    whatsappAvailable,
    showPresenceNav,
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

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (isMember && DELIVERY_MANAGEMENT_INTENTS.has(intent)) {
    return data(
      {
        ok: false,
        error: undefined,
        message: "Only the account owner can manage delivery settings and targets for this workspace.",
      },
      { status: 403 },
    );
  }

  if (intent === "refresh-watchlist") {
    const { CommercialDiscoveryError } = await import("~/lib/ad-source.server");
    const { getWatchlist } = await import("~/lib/data.server");
    const { getUserPlan } = await import("~/lib/plan.server");
    const { runWatchlistManual } = await import("~/lib/monitoring.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);

    if (!watchlist || !watchlist.isActive) {
      return { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
    }

    // Manual refresh triggers a usage-billed live scan; without this gate a
    // downgraded account keeps a working paid feature on a 10-minute timer.
    const plan = await getUserPlan(env, workspaceUserId);
    if (plan === "free") {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        message: "Fresh checks are included in paid plans — upgrade to refresh this watchlist.",
      };
    }

    try {
      await runWatchlistManual(env, watchlist);
    } catch (error) {
      if (error instanceof CommercialDiscoveryError) {
        return {
          ok: false,
          message: formatWatchlistRefreshFailure(error.failureClass, error.retryAfterSeconds),
        };
      }

      if (
        error instanceof Error &&
        (error.message.includes("refreshed recently") ||
          error.message.includes("already running") ||
          error.message.includes("could not be resolved"))
      ) {
        return {
          ok: false,
          message: error.message,
        };
      }

      throw error;
    }

    return {
      ok: true,
      message: `Fresh check complete — ${watchlist.name} is up to date.`,
    };
  }

  if (intent === "share-watchlist") {
    const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const shareGate = await requireWorkspacePlanFeature(env, workspaceUserId, "share_links");
    if (!shareGate.ok) {
      return {
        ok: false,
        error: "plan_gated" as const,
        feature: "share_links" as const,
        plan: shareGate.plan,
        message: "Share links are included on Starter and Agency plans.",
      };
    }
    const { createShareLink, getWatchlist } = await import("~/lib/data.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);
    if (!watchlist) {
      return { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
    }
    const share = await createShareLink(
      env,
      { ...session, user: { ...session.user, id: workspaceUserId } },
      {
      resourceType: "watchlist",
      resourceId: watchlist.id,
      isSnapshot: false,
    });

    return {
      ok: true,
      message: `${new URL(`/share/${share.token}`, request.url).toString()}`,
    };
  }

  if (intent === "update-watchlist") {
    const { getWatchlist, updateWatchlist } = await import("~/lib/data.server");
    const watchlist = await getOwnedWatchlist(env, workspaceUserId, formData, getWatchlist);
    const name = readOptionalString(formData.get("name"));
    const targetLabel = readOptionalString(formData.get("targetLabel"));

    if (!watchlist) {
      return { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
    }

    if (!name || (watchlist.targetType !== "saved_query" && !targetLabel)) {
      return {
        ok: false,
        message: "Add both a watchlist name and tracked brand first.",
      };
    }

    const trackingRole = normalizeWatchlistTrackingRole(formData.get("trackingRole") ?? watchlist.trackingRole);
    const competitorWebsite = formData.has("competitorWebsite")
      ? normalizeCompetitorWebsiteInput(String(formData.get("competitorWebsite") ?? ""))
      : isHttpCompetitorWebsite(watchlist.targetId)
        ? normalizeCompetitorWebsiteInput(watchlist.targetId)
        : emptyCompetitorWebsite();
    if (hasInvalidCompetitorWebsite(competitorWebsite)) {
      return {
        ok: false,
        message: competitorWebsite.error,
      };
    }

    const nextTargetLabel = targetLabel ?? watchlist.targetLabel;
    const previousCompetitorWebsite = isHttpCompetitorWebsite(watchlist.targetId)
      ? normalizeCompetitorWebsiteInput(watchlist.targetId)
      : emptyCompetitorWebsite();
    const websiteUnchanged =
      (competitorWebsite.normalizedUrl ?? null) === (previousCompetitorWebsite.normalizedUrl ?? null);
    const labelUnchanged = nextTargetLabel === watchlist.targetLabel;
    const targetFingerprint =
      websiteUnchanged && labelUnchanged
        ? watchlist.targetFingerprint
        : watchlistFingerprint(
            normalizeSavedQuery("advertiser", {
              query: nextTargetLabel,
              // Legacy pre-0025 rows persisted no target_country; migration 0025
              // keeps their original India scan country so refingerprinting stays
              // coherent with the diffs already stored. Not a global-first
              // default — do not "fix" this to the visitor geo.
              country: watchlist.targetCountry ?? "India",
            }),
            competitorWebsite,
          );

    const targetUpdate =
      watchlist.targetType === "saved_query"
        ? {
            targetType: watchlist.targetType,
            targetId: watchlist.targetId,
            targetFingerprint: watchlist.targetFingerprint,
            targetLabel: watchlist.targetLabel,
            targetCountry: watchlist.targetCountry,
            trackingRole,
          }
        : {
            targetType: "advertiser" as const,
            targetId: competitorWebsite.normalizedUrl ?? nextTargetLabel,
            targetFingerprint,
            targetLabel: nextTargetLabel,
            // Retargeting changes the competitor, not the market — the
            // replacement watchlist keeps scanning the same country.
            targetCountry: watchlist.targetCountry,
            trackingRole,
          };

    try {
      const updatedWatchlist = await updateWatchlist(env, workspaceUserId, watchlist.id, {
        name,
        ...targetUpdate,
      });
      if (updatedWatchlist && updatedWatchlist.id !== watchlist.id) {
        throw redirect(`/app/watchlists?watchlist=${updatedWatchlist.id}`);
      }
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }

      if (error instanceof Error && error.message === "watchlist_duplicate_target") {
        return {
          ok: false,
          message: "Another active watchlist already tracks that competitor.",
        };
      }

      throw error;
    }

    return {
      ok: true,
      message: "Watchlist updated.",
    };
  }

  if (intent === "save-delivery-config") {
    const {
      getWatchlistDeliveryConfig,
      getWatchlist,
      getWorkspaceDeliveryConfig,
      upsertWatchlistDeliveryConfig,
    } = await import("~/lib/data.server");
    const { isWhatsAppProviderConfigured } = await import("~/lib/env.server");
    const {
      planFeatureDeniedActionResult,
      requireDeliveryConfigSave,
    } = await import("~/lib/plan-feature-gate.server");
    const watchlist = await getOwnedWatchlist(env, workspaceUserId, formData, getWatchlist);

    if (!watchlist) {
      return { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
    }

    const whatsappDeliveryEditable = isWhatsAppDeliveryCustomerFacing() && isWhatsAppProviderConfigured(env);
    const slackDeliveryEditable = isSlackDeliveryCustomerFacing();
    const deliveryGate = await requireDeliveryConfigSave(env, workspaceUserId, {
      instantEnabled: formData.has("instantEnabled"),
      slackEnabled: slackDeliveryEditable && formData.has("slackEnabled"),
      emailEnabled: formData.has("emailEnabled"),
    });
    if (!deliveryGate.ok) {
      return planFeatureDeniedActionResult(deliveryGate.feature, deliveryGate.plan);
    }
    if (formData.has("digestEnabled") && !canUsePlanFeature(deliveryGate.plan, "weekly_digest")) {
      return planFeatureDeniedActionResult("weekly_digest", deliveryGate.plan);
    }

    if (!slackDeliveryEditable && formData.has("slackEnabled")) {
      return { ok: false, message: slackDeliveryUnavailableMessage() };
    }
    if (!whatsappDeliveryEditable && formData.has("whatsappEnabled")) {
      return { ok: false, message: whatsappDeliveryUnavailableMessage() };
    }

    const workspaceConfig =
      (await getWorkspaceDeliveryConfig(env, workspaceUserId)) ??
      buildLegacyWorkspaceConfig(workspaceUserId, Boolean(session.user.email));
    const existingWatchlistConfig = await getWatchlistDeliveryConfig(env, watchlist.id);
    const baseConfig = existingWatchlistConfig ?? workspaceConfig;
    const sensitivityMode = normalizeSensitivityMode(String(formData.get("sensitivityMode") ?? ""));
    const requestedTimezone = readOptionalString(formData.get("timezone"));
    const normalizedRequestedTimezone = normalizeTimeZone(requestedTimezone);
    if (requestedTimezone && !normalizedRequestedTimezone) {
      return {
        ok: false,
        message: "Enter a valid IANA timezone, such as America/New_York or UTC.",
      };
    }
    const timezone = normalizedRequestedTimezone ?? safeTimeZone(workspaceConfig.timezone);

    await upsertWatchlistDeliveryConfig(env, {
      watchlistId: watchlist.id,
      userId: workspaceUserId,
      sensitivityMode,
      instantEnabled: formData.has("instantEnabled"),
      digestEnabled: formData.has("digestEnabled"),
      emailEnabled: formData.has("emailEnabled"),
      whatsappEnabled: whatsappDeliveryEditable ? formData.has("whatsappEnabled") : baseConfig.whatsappEnabled,
      slackEnabled: slackDeliveryEditable ? formData.has("slackEnabled") : baseConfig.slackEnabled,
      quietHours: parseQuietHours(formData),
      timezone,
    });

    return {
      ok: true,
      message: "Delivery settings updated.",
    };
  }

  if (intent === "add-delivery-target") {
    const { getWatchlist, upsertDeliveryTarget } = await import("~/lib/data.server");
    const {
      planFeatureDeniedActionResult,
      requireDeliveryConfigSave,
    } = await import("~/lib/plan-feature-gate.server");
    const watchlist = await getOwnedWatchlist(env, workspaceUserId, formData, getWatchlist);

    if (!watchlist) {
      return { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
    }

    const requestedChannel = String(formData.get("channel") ?? "");
    if (requestedChannel === "slack" && !isSlackDeliveryCustomerFacing()) {
      return { ok: false, message: slackDeliveryUnavailableMessage() };
    }

    const channel = readDeliveryChannel(formData.get("channel"));
    const targetValue = readOptionalString(formData.get("targetValue"));

    if (!channel || !targetValue) {
      return {
        ok: false,
        message: "Choose a channel and a target first.",
      };
    }
    if (channel === "whatsapp" && !isWhatsAppDeliveryCustomerFacing()) {
      return { ok: false, message: whatsappDeliveryUnavailableMessage() };
    }
    const deliveryGate = await requireDeliveryConfigSave(env, workspaceUserId, { channel });
    if (!deliveryGate.ok) {
      return planFeatureDeniedActionResult(deliveryGate.feature, deliveryGate.plan);
    }

    const explicitOptIn = formData.has("explicitOptIn") || channel === "email";

    await upsertDeliveryTarget(env, {
      userId: workspaceUserId,
      watchlistId: watchlist.id,
      channel,
      targetValue,
      validationStatus: channel === "email" ? "validated" : "pending",
      isValidated: channel === "email",
      isOptedIn: explicitOptIn,
      optInSource: explicitOptIn ? "watchlist_settings" : null,
      optedInAt: explicitOptIn ? new Date().toISOString() : null,
      isPaused: false,
      pausedAt: null,
      templateEligible: channel === "email",
      metadata: {
        scope: "watchlist",
      },
    });

    return {
      ok: true,
      message: "Delivery target saved.",
    };
  }

  if (intent === "pause-watchlist") {
    const { setWatchlistActive } = await import("~/lib/data.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const paused = await setWatchlistActive(env, workspaceUserId, watchlistId, false);

    return paused
      ? {
          ok: true,
          message:
            "Watchlist paused. Scans and alerts stop, the history stays, and the plan slot is free.",
        }
      : { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
  }

  if (intent === "resume-watchlist") {
    const { setWatchlistActive } = await import("~/lib/data.server");
    const { requireWorkspacePlanLimit } = await import("~/lib/with-workspace.server");
    const { getUserPlan } = await import("~/lib/plan.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");

    const limitGate = await requireWorkspacePlanLimit(env, workspaceUserId, "watchlists", {
      limitMessage:
        "You've reached your competitor tracking limit — pause another watchlist first.",
    });
    if (!limitGate.ok) {
      return limitGate.result;
    }

    const resumed = await setWatchlistActive(env, workspaceUserId, watchlistId, true);

    const plan = await getUserPlan(env, workspaceUserId);
    return resumed
      ? {
          ok: true,
          message: plan === "free"
            ? "Watchlist resumed. It rejoins the next weekly check; paid plans check every 3–6 hours."
            : "Watchlist resumed. It rejoins the next scheduled scan.",
        }
      : { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
  }

  if (intent === "bulk-watchlists") {
    const { setWatchlistActive } = await import("~/lib/data.server");
    const bulkAction = String(formData.get("bulkAction") ?? "");
    const watchlistIds = [...new Set(formData.getAll("watchlistIds").map(String))].filter(Boolean);

    if ((bulkAction !== "pause" && bulkAction !== "resume") || watchlistIds.length === 0) {
      return { ok: false, message: "Select at least one watchlist first." };
    }

    // Bound the per-request work. Every id runs at least one scoped D1 write
    // (resume also runs a lookup + plan-limit count), and `getAll` is unbounded
    // in a raw POST, so a scripted request could force thousands of sequential
    // D1 operations. No legitimate workspace selects more than its watchlist
    // count (agency caps active watchlists at 75); 200 clears real "select all"
    // use with headroom for paused rows while capping abuse.
    if (watchlistIds.length > MAX_BULK_WATCHLIST_IDS) {
      return {
        ok: false,
        message: `Select ${MAX_BULK_WATCHLIST_IDS} or fewer watchlists at a time.`,
      };
    }

    if (bulkAction === "pause") {
      let paused = 0;
      for (const watchlistId of watchlistIds) {
        if (await setWatchlistActive(env, workspaceUserId, watchlistId, false)) {
          paused += 1;
        }
      }

      return paused > 0
        ? {
            ok: true,
            message: `Paused ${paused} of ${watchlistIds.length} selected. Scans and alerts stop, the history stays, and the plan slots are free.`,
          }
        : { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
    }

    // Resume re-checks the plan limit before each watchlist — the count of
    // active watchlists changes with every resume, so a single upfront check
    // could overshoot the plan cap. Already-active selections are no-ops and
    // must never consume the gate (they hold a plan slot already).
    const { getWatchlist } = await import("~/lib/data.server");
    const { requireWorkspacePlanLimit } = await import("~/lib/with-workspace.server");
    let resumed = 0;
    let alreadyActive = 0;
    let hitPlanLimit = false;
    for (const watchlistId of watchlistIds) {
      const existing = await getWatchlist(env, watchlistId, workspaceUserId);
      if (!existing) {
        continue;
      }
      if (existing.isActive) {
        alreadyActive += 1;
        continue;
      }
      const limitGate = await requireWorkspacePlanLimit(env, workspaceUserId, "watchlists", {
        limitMessage:
          "You've reached your competitor tracking limit — pause another watchlist first.",
      });
      if (!limitGate.ok) {
        hitPlanLimit = true;
        break;
      }
      if (await setWatchlistActive(env, workspaceUserId, watchlistId, true)) {
        resumed += 1;
      }
    }

    const alreadyActiveNote = alreadyActive > 0
      ? ` ${alreadyActive} ${alreadyActive === 1 ? "was" : "were"} already active.`
      : "";

    if (hitPlanLimit) {
      return {
        ok: false,
        error: "plan_limit_exceeded" as const,
        message: `Resumed ${resumed} of ${watchlistIds.length} selected.${alreadyActiveNote} You've reached your competitor tracking limit — pause another watchlist first.`,
      };
    }

    if (resumed > 0) {
      return {
        ok: true,
        message: `Resumed ${resumed} of ${watchlistIds.length} selected.${alreadyActiveNote} They rejoin the next scheduled scan.`,
      };
    }

    if (alreadyActive > 0) {
      return {
        ok: true,
        message: alreadyActive === watchlistIds.length
          ? "Everything selected is already active — nothing to resume."
          : `Nothing to resume.${alreadyActiveNote}`,
      };
    }

    return { ok: false, message: "We couldn't find that watchlist. Refresh the page and try again." };
  }

  if (intent === "send-test-email") {
    const { getDeliveryTargetById } = await import("~/lib/data.server");
    const { sendDeliveryTestEmail } = await import("~/lib/delivery.server");
    const {
      planFeatureDeniedActionResult,
      requireDeliveryConfigSave,
    } = await import("~/lib/plan-feature-gate.server");
    const targetId = String(formData.get("targetId") ?? "");
    const requestToken = String(formData.get("requestToken") ?? "").trim();
    if (!isDeliveryTestRequestToken(requestToken)) {
      return {
        ok: false,
        message: "This test request expired. Refresh the page and try again.",
      };
    }
    const target = await getDeliveryTargetById(env, {
      userId: workspaceUserId,
      targetId,
    });

    if (!target || target.userId !== workspaceUserId || target.channel !== "email") {
      return { ok: false, message: "We couldn't find that delivery address. Refresh the page and try again." };
    }

    const deliveryGate = await requireDeliveryConfigSave(env, workspaceUserId, { emailEnabled: true });
    if (!deliveryGate.ok) {
      return planFeatureDeniedActionResult(deliveryGate.feature, deliveryGate.plan);
    }

    const sent = await sendDeliveryTestEmail(env, {
      userId: workspaceUserId,
      email: target.targetValue,
      name: session.user.name ?? null,
      targetId,
      idempotencyKey: `delivery-test:${workspaceUserId}:${targetId}:${requestToken}`,
    });

    return sent
      ? {
          ok: true,
          message: "Test email sent — if it doesn't arrive within a few minutes, check your inbox and spam folder.",
        }
      : {
          ok: false,
        message: `We couldn't send the test email. Check your delivery settings, or email ${SUPPORT_EMAIL} and we'll dig in.`,
        };
  }

  if (intent === "toggle-delivery-target") {
    const {
      getDeliveryTargetById,
      getWatchlist,
      upsertDeliveryTarget,
    } = await import("~/lib/data.server");
    const targetId = String(formData.get("targetId") ?? "").trim();
    const target = await getDeliveryTargetById(env, {
      userId: workspaceUserId,
      targetId,
    });

    if (!target || target.userId !== workspaceUserId) {
      return { ok: false, message: "We couldn't find that delivery target. Refresh the page and try again." };
    }

    // Watchlist-scoped targets require their watchlist to still be active. The
    // workspace-default target (watchlistId null) has no watchlist — it is the
    // address the /unsubscribe promise points back to, so it must be
    // pausable/resumable from delivery settings too.
    const isDefaultTarget = !target.watchlistId;
    const watchlist = target.watchlistId
      ? await getWatchlist(env, target.watchlistId, workspaceUserId)
      : null;
    if (!isDefaultTarget && !watchlist?.isActive) {
      return { ok: false, message: "We couldn't find that delivery target. Refresh the page and try again." };
    }

    const requestedChannel = target.channel;
    if (requestedChannel === "slack" && !isSlackDeliveryCustomerFacing()) {
      return { ok: false, message: slackDeliveryUnavailableMessage() };
    }

    const channel = target.channel;
    const targetValue = target.targetValue;
    const isPaused = !target.isPaused;
    if (channel === "whatsapp" && !isWhatsAppDeliveryCustomerFacing()) {
      return { ok: false, message: whatsappDeliveryUnavailableMessage() };
    }
    const isResumingSuppressedEmailDefault =
      isDefaultTarget &&
      channel === "email" &&
      !isPaused &&
      !target.isOptedIn &&
      target.optedOutAt !== null;
    if (isResumingSuppressedEmailDefault) {
      const { resumeEmailTargetsForUserAndAddress } = await import("~/lib/data.server");
      await resumeEmailTargetsForUserAndAddress(env, {
        userId: workspaceUserId,
        targetValue,
        source: "delivery_settings",
      });
    } else {
      await upsertDeliveryTarget(env, {
        userId: workspaceUserId,
        watchlistId: target.watchlistId ?? null,
        channel,
        targetValue,
        validationStatus: channel === "email" ? "validated" : "pending",
        isValidated: channel === "email",
        isOptedIn: true,
        optInSource: isDefaultTarget ? "delivery_settings" : "watchlist_settings",
        optedInAt: new Date().toISOString(),
        isPaused,
        pausedAt: isPaused ? new Date().toISOString() : null,
        optedOutAt: isPaused ? target.optedOutAt : null,
        templateEligible: channel === "email",
        metadata: {
          scope: isDefaultTarget ? "workspace" : "watchlist",
        },
      });
    }

    return {
      ok: true,
      message: isPaused ? "Delivery target paused." : "Delivery target resumed.",
    };
  }

  return {
    ok: false,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

export default function WatchlistsRoute() {
  const data = useLoaderData<typeof loader>();

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
  const pauseResumePendingIntent = pauseResumePending
    ? pauseResumeFetcher.formData?.get("intent")
    : null;
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
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const trackingPresentation = resolveWatchlistTrackingPresentation(
    discoveryStatus,
    data.runs,
    data.proofSummary,
  );
  const sourceCanSchedule = discoveryStatus.status !== "demo" && discoveryStatus.status !== "disabled";
  const hasExplicitWatchlistSelection = searchParams.has("watchlist");
  const pendingWatchlistId =
    navigation.location?.pathname === "/app/watchlists"
      ? new URLSearchParams(navigation.location.search).get("watchlist")
      : null;
  const proofCapturesById = new Map(
    data.recentProofCaptures.map((capture) => [capture.id, capture]),
  );
  const lastAttemptByEventId = buildLastAttemptByEventId(data.recentDeliveryAttempts);
  const insightDepth = data.selectedWatchlist ? buildWatchlistInsightDepth(data.events) : null;
  // WP-C2 Beat 3 — only carry the Wire arc during the first-run window, i.e.
  // before any competitor in the workspace has ever completed a scan (its first
  // readable brief). Derived from existing records; no parallel status source.
  const firstRunWindow = !data.watchlists.some((watchlist) =>
    Boolean(watchlist.lastScannedAt),
  );
  const selectedTrackingRole = normalizeWatchlistTrackingRole(data.selectedWatchlist?.trackingRole);
  const selectedTargetNoun = formatWatchlistTargetNoun(selectedTrackingRole);
  let consecutiveFailedRuns = 0;
  for (const run of data.runs as Array<{ status: string; errorCode?: string | null }>) {
    // Provider cooldowns are soft failures — skip them rather than alarming
    // the customer about a watchlist that is actually fine.
    if (run.status === "failed" && (run.errorCode === "rate_limited" || run.errorCode === "cache_only")) {
      continue;
    }
    if (run.status !== "failed") break;
    consecutiveFailedRuns += 1;
  }

  return (
    <DashboardPage>
      <section className="f9-app-stack">
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

      <div className="f9-master-detail">
        <article className="f9-app-panel f9-side-panel">
          <div className="f9-panel-toolbar">
            <div>
              <h2>Competitors</h2>
            </div>
          </div>
          <p className="f9-muted-copy">
            Pick a tracked brand to review changes, evidence freshness, and alert delivery.
          </p>

          {data.watchlists.length > 1 ? (
            <BulkSelectBar
              onPause={() => submitBulk("pause")}
              onResume={() => submitBulk("resume")}
              pending={bulkPending}
              pendingAction={bulkFetcher.formData?.get("bulkAction")}
              selectedCount={selectedBulkIds.length}
            />
          ) : null}

          <div className="f9-work-list is-compact">
            {data.watchlists.map((watchlist) => {
              const isActive =
                searchParams.get("watchlist") === watchlist.id ||
                (!searchParams.get("watchlist") && data.selectedWatchlist?.id === watchlist.id);
              const isPending = pendingWatchlistId === watchlist.id;
              const scanPresentation = resolveWatchlistListScanPresentation({
                isActive: watchlist.isActive,
                lastScannedAt: watchlist.lastScannedAt,
                latestRun: isActive
                  ? ((data.runs[0] as WatchlistRunRecord | undefined) ?? null)
                  : null,
                plan: data.plan,
              });

              return (
                <div className="f9-work-row-select" key={watchlist.id}>
                  {data.watchlists.length > 1 ? (
                    <label className="f9-bulk-select-target">
                      <input
                        aria-label={`Select ${watchlist.name} for bulk actions`}
                        checked={selectedBulkIds.includes(watchlist.id)}
                        className="f9-bulk-checkbox"
                        disabled={bulkPending}
                        onChange={() => toggleBulkSelection(watchlist.id)}
                        type="checkbox"
                      />
                    </label>
                  ) : null}
                  <Link
                    className={`f9-work-row ${isActive ? "is-active" : ""} ${isPending ? "is-pending" : ""}`}
                    preventScrollReset
                    to={`/app/watchlists?watchlist=${watchlist.id}`}
                  >
                    <div>
                      <h3>{watchlist.name}</h3>
                      <p className="f9-muted-copy">
                        {formatWatchlistTrackingRole(watchlist.trackingRole)} · {watchlist.targetLabel}
                        {watchlist.isActive ? "" : " · Paused"}
                      </p>
                      <p className="f9-muted-copy">
                        {scanPresentation.timestamp ? (
                          <>
                            {scanPresentation.label} <LocalTime iso={scanPresentation.timestamp} />
                          </>
                        ) : (
                          scanPresentation.label
                        )}
                      </p>
                    </div>
                  </Link>
                </div>
              );
            })}
            {data.watchlists.length === 0 ? (
              <EmptyState
                description="Add one to start your first scan."
                title="No competitors yet"
                variant="inline"
              />
            ) : null}
          </div>
        </article>

        <article className={`f9-app-panel${hasExplicitWatchlistSelection ? " f9-selected-detail-priority" : ""}`}>
          {data.selectedWatchlist ? (
            <>
              <div className="f9-panel-toolbar">
                <div>
                  <p className="f9-app-kicker">Selected watchlist</p>
                  <h2>{data.selectedWatchlist.name}</h2>
                  <p className="f9-muted-copy">
                    {data.selectedWatchlist.targetLabel} · last scanned{" "}
                    {data.selectedWatchlist.lastScannedAt ? (
                      <LocalTime iso={data.selectedWatchlist.lastScannedAt} />
                    ) : (
                      "never"
                    )}
                    {data.selectedWatchlist.isActive
                      ? data.plan === "free"
                        ? ` · next weekly check ${formatNextScanLabel(data.plan, renderedAt, data.effectiveDeliveryConfig.timezone)}; paid plans check every 3–6 hours`
                        : sourceCanSchedule
                          ? ` · next scan ${formatNextScanLabel(data.plan, renderedAt, data.effectiveDeliveryConfig.timezone)}`
                          : " · next scan after source access is ready"
                      : null}
                    {` · ${formatWatchlistTrackingRole(data.selectedWatchlist.trackingRole)}`}
                  </p>
                </div>
                <div className="f9-action-row">
                  {canReport ? (
                    <Link
                      className="f9-secondary-button"
                      to={`/app/reports/${createReportId("watchlist", data.selectedWatchlist.id)}`}
                    >
                      Open report
                    </Link>
                  ) : null}
                  {canExport ? (
                    <>
                      <a
                        className="f9-secondary-button"
                        href={`/export/watchlist/${data.selectedWatchlist.id}`}
                      >
                        Export CSV
                      </a>
                      <a
                        className="f9-secondary-button"
                        href={`/export/watchlist/${data.selectedWatchlist.id}?format=json`}
                      >
                        Export JSON
                      </a>
                    </>
                  ) : null}
                  {canShare ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-watchlist" />
                      <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                      <SubmitButton className="f9-secondary-button" intent="share-watchlist" pendingLabel="Sharing…">
                        Share summary
                      </SubmitButton>
                    </Form>
                  ) : null}
                  <pauseResumeFetcher.Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value={data.selectedWatchlist.isActive ? "pause-watchlist" : "resume-watchlist"}
                    />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <button
                      aria-busy={pauseResumePending || undefined}
                      className="f9-secondary-button"
                      disabled={pauseResumePending}
                      type="submit"
                    >
                      {pauseResumePending ? (
                        <>
                          <span aria-hidden="true" className="f9-button-spinner" />
                          {pauseResumePendingIntent === "pause-watchlist" ? "Pausing…" : "Resuming…"}
                        </>
                      ) : data.selectedWatchlist.isActive ? (
                        "Pause tracking"
                      ) : (
                        "Resume tracking"
                      )}
                    </button>
                  </pauseResumeFetcher.Form>
                  {data.selectedWatchlist.isActive && canRefresh ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="refresh-watchlist" />
                      <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                      <SubmitButton className="f9-primary-button" intent="refresh-watchlist" pendingLabel="Scanning live…">
                        Refresh now
                      </SubmitButton>
                    </Form>
                  ) : null}
                  {lockedToolbarUpgradeLabel ? (
                    <Link className="f9-secondary-button" to="/app/billing?source=watchlists#plans">
                      {lockedToolbarUpgradeLabel}
                    </Link>
                  ) : null}
                </div>
              </div>

              <p className="f9-crosslink-row">
                <Link className="f9-text-link" to={watchlistLiveSearchHref(data.selectedWatchlist)}>
                  Search their ads live
                </Link>
                <Link className="f9-text-link" to={watchlistSavedAdsHref(data.selectedWatchlist)}>
                  Saved ads from this {selectedTargetNoun}
                </Link>
              </p>

              {data.selectedWatchlist.isActive && !data.selectedWatchlist.lastScannedAt ? (
                <>
                  {firstRunWindow ? (
                    <FirstRunWaitArc
                      run={(data.runs[0] as WatchlistRunRecord | undefined) ?? null}
                      scanDomain={data.selectedWatchlist.targetLabel}
                    />
                  ) : null}
                  <FirstScanBanner
                    plan={data.plan}
                    run={(data.runs[0] as WatchlistRunRecord | undefined) ?? null}
                    watchlistId={data.selectedWatchlist.id}
                  />
                </>
              ) : null}

              {consecutiveFailedRuns >= 3 ? (
        <div aria-live="assertive" className="f9-message is-error" role="alert">
          <p>
            We're having trouble checking this {selectedTargetNoun} — the last {consecutiveFailedRuns} checks
            failed. We keep retrying every night; recent errors are listed under Recent checks. If
            this persists for a few days, email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and
            we'll dig in.
          </p>
        </div>
      ) : null}

      {insightDepth ? <InsightDepthPanel summary={insightDepth} /> : null}

              <div className="f9-work-list">
                <CreativeWall items={data.creativeWall} plan={data.plan} />
                <WatchlistTrends
                  dailyActivity={data.trendDailyActivity}
                  items={data.creativeWall}
                  plan={data.plan}
                />
                <div className="f9-detail-split">
                <WatchlistSetupCard
                  data={{ selectedWatchlist: data.selectedWatchlist }}
                  selectedTrackingRole={selectedTrackingRole}
                />

                <TrackingStatusCard
                  data={{
                    effectiveDeliveryConfig: data.effectiveDeliveryConfig,
                    plan: data.plan,
                    selectedWatchlist: data.selectedWatchlist,
                    showPresenceNav: data.showPresenceNav,
                  }}
                  discoveryStatus={discoveryStatus}
                  renderedAt={renderedAt}
                  sourceCanSchedule={sourceCanSchedule}
                  trackingPresentation={trackingPresentation}
                />
                </div>

                <ProofGlossary />

                {data.dossier ? (
                  <CompetitorDossierPanel
                    aggression={data.aggression}
                    counterBrief={data.counterBrief}
                    counterBriefLocked={data.counterBriefLocked}
                    dossier={data.dossier}
                    watchlistId={data.selectedWatchlist.id}
                  />
                ) : null}

                <EventChangesSection
                  data={{
                    effectiveDeliveryConfig: data.effectiveDeliveryConfig,
                    events: data.events,
                    highlightedEventId: data.highlightedEventId,
                    plan: data.plan,
                    runs: data.runs,
                    selectedWatchlist: data.selectedWatchlist,
                  }}
                  lastAttemptByEventId={lastAttemptByEventId}
                  proofCapturesById={proofCapturesById}
                  renderedAt={renderedAt}
                  sourceCanSchedule={sourceCanSchedule}
                />

                <section>
                  <div className="f9-panel-toolbar">
                    <div>
                      <p className="f9-app-kicker">Evidence and delivery</p>
                      <h3 style={{ marginTop: 0 }}>Evidence and alerts</h3>
                    </div>
                  </div>

                  <div className="f9-detail-split">
                    <RecentEvidenceChecksCard data={data} />

                    <DeliverySettingsCard
                      canConfigureDigestSettings={canConfigureDigestSettings}
                      canEmailDelivery={canEmailDelivery}
                      canInstantAlert={canInstantAlert}
                      data={data}
                      showSlackDelivery={showSlackDelivery}
                      watchlistId={data.selectedWatchlist.id}
                    />
                  </div>
                </section>

                <DeliveryTargetsSection
                  canConfigureDelivery={canConfigureDelivery}
                  canEmailDelivery={canEmailDelivery}
                  data={data}
                  watchlistId={data.selectedWatchlist.id}
                />

                <RecentChecksSection runs={data.runs} />

                <CandidateHistory candidates={data.eventCandidates} />
              </div>
            </>
          ) : (
            <EmptyState
              action={{ label: "Add competitor", to: "/search" }}
              description="Paste your website or a competitor's — we scan their Meta ads and landing page, then email you the moment their offer, creative, or CTA changes."
              sample={{ label: "See a sample brief", to: "/#demo" }}
              title="Add your first competitor"
            />
          )}
        </article>
      </div>
      </section>
    </DashboardPage>
  );
}

function buildLegacyWorkspaceConfig(
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
    quietHours: null,
    timezone: null,
    createdAt: "",
    updatedAt: "",
  };
}

async function getOwnedWatchlist(
  env: AppEnv,
  userId: string,
  formData: FormData,
  getWatchlist: (env: AppEnv, watchlistId: string, userId?: string) => Promise<any>,
): Promise<any> {
  const watchlistId = String(formData.get("watchlistId") ?? "");
  const watchlist = await getWatchlist(env, watchlistId, userId);
  return watchlist?.isActive ? watchlist : null;
}

function parseQuietHours(formData: FormData) {
  const startHour = Number.parseInt(String(formData.get("quietHoursStart") ?? ""), 10);
  const endHour = Number.parseInt(String(formData.get("quietHoursEnd") ?? ""), 10);

  if (Number.isNaN(startHour) || Number.isNaN(endHour)) {
    return null;
  }

  return {
    startHour: normalizeHour(startHour),
    endHour: normalizeHour(endHour),
  };
}

function normalizeHour(value: number) {
  if (value < 0) {
    return 0;
  }
  if (value > 23) {
    return 23;
  }
  return value;
}

function readOptionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readDeliveryChannel(value: FormDataEntryValue | null) {
  if (value === "email" || value === "whatsapp") {
    return value;
  }

  return null;
}
