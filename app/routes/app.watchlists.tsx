import { useEffect, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { CompetitorDossierPanel } from "~/components/competitor-dossier";
import { CreativeWall } from "~/components/creative-wall";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { WatchlistTrends } from "~/components/watchlist-trends";
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
import {
  formatConfidenceBandLabel,
  formatDeliveryAttemptStatusLabel,
  formatImportanceBandLabel,
  formatMachineTokenLabel,
  formatProofAgeLabel,
  formatProofCaptureStatusLabel,
  formatWatchEventStatusLabel,
  formatWatchEventTypeLabel,
  formatWhyAlertedLabel,
} from "~/lib/landing-page-display";
import { toPublicDeliveryTarget, type PublicDeliveryTargetRecord } from "~/lib/delivery-target-public";
import {
  toPublicDeliveryAttemptSummary,
  type PublicDeliveryAttemptSummary,
} from "~/lib/delivery-attempt-public";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import {
  customerDiscoverySummary,
  toCustomerDiscoveryStatus,
  type CustomerDiscoveryStatus,
} from "~/lib/discovery-customer-copy";
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
import {
  formatWatchlistTargetNoun,
  formatWatchlistTrackingRole,
  normalizeWatchlistTrackingRole,
} from "~/lib/watchlist-role";
import type {
  DiscoveryFailureClass,
  EventCandidateRecord,
  MetaIntegrationStatus,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistProofSummary,
  WatchlistRunSummaryCounts,
  WorkspaceDeliveryConfigRecord,
  DeliveryChannel,
  WatchlistRunRecord,
} from "~/lib/types";

export const meta = () => [{ title: "Watchlists | Five to Nine" }];
const WATCHLIST_DELIVERY_TARGET_DISPLAY_LIMIT = 12;
const WORKSPACE_DELIVERY_TARGET_DISPLAY_LIMIT = 8;
const RECENT_DELIVERY_ATTEMPT_DISPLAY_LIMIT = 16;
const DELIVERY_MANAGEMENT_INTENTS = new Set([
  "save-delivery-config",
  "add-delivery-target",
  "send-test-email",
  "toggle-delivery-target",
]);

export function HydrateFallback() {
  return <DashboardRouteLoading title="Watchlists" />;
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
  const [watchlists, discoveryStatus, plan, showPresenceNav] = await Promise.all([
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
    resolveCommercialAdSourceStatus(env).then(toCustomerDiscoveryStatus),
    getUserPlan(env, workspaceUserId),
    presenceNavVisible(env, workspaceUserId),
  ]);
  const verifiedAccountEmail = (await isUserEmailVerified(env, session.user.id))
    ? session.user.email
    : null;
  const url = new URL(request.url);
  const selectedWatchlistId = url.searchParams.get("watchlist") ?? watchlists[0]?.id ?? null;
  // WP-24: deep-link target from alert/digest emails (`?event=<id>`).
  const highlightedEventId = url.searchParams.get("event")?.trim() || null;
  const selectedWatchlist = selectedWatchlistId
    ? await getWatchlist(env, selectedWatchlistId, workspaceUserId)
    : null;
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
  // persistence — the module's own 10s cap and never-throw contract bound the
  // cost (~1-2s on the small shared model); tradeoff documented in
  // counter-brief.server.ts. Free plans get the upgrade line instead.
  const counterBriefEligible = isPaidPlanFamily(plan);
  const counterBrief = counterBriefEligible
    ? await buildCounterBrief(env, dossier).catch(() => null)
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
    return {
      ok: false,
      message: "Only the account owner can manage delivery settings and targets for this workspace.",
    };
  }

  if (intent === "refresh-watchlist") {
    const { CommercialDiscoveryError } = await import("~/lib/ad-source.server");
    const { getWatchlist } = await import("~/lib/data.server");
    const { getUserPlan } = await import("~/lib/plan.server");
    const { runWatchlistManual } = await import("~/lib/monitoring.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);

    if (!watchlist || !watchlist.isActive) {
      return { ok: false, message: "Watchlist not found." };
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
      message: `${watchlist.name} refreshed successfully.`,
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
      return { ok: false, message: "Watchlist not found." };
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
      return { ok: false, message: "Watchlist not found." };
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
      return { ok: false, message: "Watchlist not found." };
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
        message: "Enter a valid IANA timezone, such as Asia/Kolkata or UTC.",
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
      return { ok: false, message: "Watchlist not found." };
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
      : { ok: false, message: "Watchlist not found." };
  }

  if (intent === "resume-watchlist") {
    const { setWatchlistActive } = await import("~/lib/data.server");
    const { requireWorkspacePlanLimit } = await import("~/lib/with-workspace.server");
    const { getUserPlan } = await import("~/lib/plan.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");

    const limitGate = await requireWorkspacePlanLimit(env, workspaceUserId, "watchlists", {
      limitMessage:
        "You have reached your competitor tracking limit — pause another watchlist first.",
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
      : { ok: false, message: "Watchlist not found." };
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
      return { ok: false, message: "Email delivery target not found." };
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
        message: `The test email failed to send. Check your delivery settings or email ${SUPPORT_EMAIL}.`,
        };
  }

  if (intent === "toggle-delivery-target") {
    const { getDeliveryTargetById, getWatchlist, upsertDeliveryTarget } = await import("~/lib/data.server");
    const targetId = String(formData.get("targetId") ?? "").trim();
    const target = await getDeliveryTargetById(env, {
      userId: workspaceUserId,
      targetId,
    });
    const watchlist = target?.watchlistId
      ? await getWatchlist(env, target.watchlistId, workspaceUserId)
      : null;

    if (!target || target.userId !== workspaceUserId || !target.watchlistId || !watchlist?.isActive) {
      return { ok: false, message: "Delivery target not found." };
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
    await upsertDeliveryTarget(env, {
      userId: workspaceUserId,
      watchlistId: watchlist.id,
      channel,
      targetValue,
      validationStatus: channel === "email" ? "validated" : "pending",
      isValidated: channel === "email",
      isOptedIn: true,
      optInSource: "watchlist_settings",
      optedInAt: new Date().toISOString(),
      isPaused,
      pausedAt: isPaused ? new Date().toISOString() : null,
      templateEligible: channel === "email",
      metadata: {
        scope: "watchlist",
      },
    });

    return {
      ok: true,
      message: isPaused ? "Delivery target paused." : "Delivery target resumed.",
    };
  }

  return {
    ok: false,
    message: "Unknown watchlist action.",
  };
}

export function WatchlistProofAge({ capturedAt, renderedAt }: { capturedAt: string; renderedAt: string }) {
  return formatProofAgeLabel(capturedAt, { now: renderedAt });
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
  const [latestFeedbackSource, setLatestFeedbackSource] = useState<"route" | "fetcher" | null>(null);
  useEffect(() => {
    if (routeActionData) setLatestFeedbackSource("route");
  }, [routeActionData]);
  useEffect(() => {
    if (pauseResumeFetcher.data) setLatestFeedbackSource("fetcher");
  }, [pauseResumeFetcher.data]);
  const actionData =
    latestFeedbackSource === "fetcher" ? pauseResumeFetcher.data : routeActionData;
  const pauseResumePending = pauseResumeFetcher.state !== "idle";
  const pauseResumePendingIntent = pauseResumePending
    ? pauseResumeFetcher.formData?.get("intent")
    : null;
  const showSlackDelivery = isSlackDeliveryCustomerFacing();
  const canExport = canUsePlanFeature(data.plan, "export_csv") && canUsePlanFeature(data.plan, "export_json");
  const canReport = canUsePlanFeature(data.plan, "client_reports");
  const canShare = canUsePlanFeature(data.plan, "share_links");
  const canRefresh = data.plan !== "free";
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
          lead="Monitor competitor ads over time and get alerted when messaging, creative, or landing pages change."
          title="Watchlists"
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
              <h2>Tracking desk</h2>
            </div>
          </div>
          <p className="f9-muted-copy">
            Pick a tracked brand to review changes, evidence freshness, and alert delivery.
          </p>

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
                <Link
                  className={`f9-work-row ${isActive ? "is-active" : ""} ${isPending ? "is-pending" : ""}`}
                  key={watchlist.id}
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
              );
            })}
            {data.watchlists.length === 0 ? (
              <EmptyState
                action={{ label: "Add competitor", to: "/search" }}
                description="Paste your website or a competitor website to start tracking visible changes."
                headingLevel="h3"
                title="Add your first competitor"
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
                  ) : (
                    <Link className="f9-secondary-button" to="/app/billing?source=watchlists#plans">
                      Upgrade for reports
                    </Link>
                  )}
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
                        JSON export
                      </a>
                    </>
                  ) : (
                    <Link className="f9-secondary-button" to="/app/billing?source=watchlists#plans">
                      Upgrade for exports
                    </Link>
                  )}
                  {canShare ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-watchlist" />
                      <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                      <SubmitButton className="f9-secondary-button" intent="share-watchlist" pendingLabel="Sharing…">
                        Share summary
                      </SubmitButton>
                    </Form>
                  ) : (
                    <Link className="f9-secondary-button" to="/app/billing?source=watchlists#plans">
                      Upgrade to share
                    </Link>
                  )}
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
                  ) : data.selectedWatchlist.isActive ? (
                    <Link className="f9-primary-button" to="/app/billing?source=watchlists#plans">
                      Upgrade to refresh
                    </Link>
                  ) : null}
                </div>
              </div>

              {data.selectedWatchlist.isActive && !data.selectedWatchlist.lastScannedAt ? (
                <FirstScanBanner
                  plan={data.plan}
                  run={(data.runs[0] as WatchlistRunRecord | undefined) ?? null}
                  watchlistId={data.selectedWatchlist.id}
                />
              ) : null}

              {consecutiveFailedRuns >= 3 ? (
        <div className="f9-message is-error">
          <p>
            We're having trouble checking this competitor — the last {consecutiveFailedRuns} checks
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
                <section className="f9-detail-cell">
                  <p className="f9-app-kicker">Watchlist setup</p>
                  <Form method="post" className="f9-work-list is-compact">
                    <input name="intent" type="hidden" value="update-watchlist" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <label className="f9-field">
                      <span>Name</span>
                      <input
                        defaultValue={data.selectedWatchlist.name}
                        name="name"
                        placeholder="Nykaa launch watch"
                        type="text"
                      />
                    </label>
                    <div className="f9-mode-toggle" aria-label="Track as">
                      <label className={selectedTrackingRole === "competitor" ? "is-active" : ""}>
                        <input
                          defaultChecked={selectedTrackingRole === "competitor"}
                          name="trackingRole"
                          type="radio"
                          value="competitor"
                        />
                        Competitor
                      </label>
                      <label className={selectedTrackingRole === "self" ? "is-active" : ""}>
                        <input
                          defaultChecked={selectedTrackingRole === "self"}
                          name="trackingRole"
                          type="radio"
                          value="self"
                        />
                        My brand
                      </label>
                    </div>
                    <label className="f9-field">
                      <span>{formatWatchlistTrackingRole(selectedTrackingRole)} website</span>
                      <input
                        defaultValue={
                          isHttpCompetitorWebsite(data.selectedWatchlist.targetId)
                            ? data.selectedWatchlist.targetId
                            : ""
                        }
                        name="competitorWebsite"
                        placeholder="https://nykaa.com"
                        type="text"
                      />
                    </label>
                    <label className="f9-field">
                      <span>Brand or search term</span>
                      <input
                        defaultValue={data.selectedWatchlist.targetLabel}
                        name="targetLabel"
                        placeholder={selectedTrackingRole === "self" ? "Samplebrand" : "Nykaa, Mamaearth, skincare serum"}
                        type="text"
                      />
                    </label>
                    <SubmitButton className="f9-secondary-button" intent="update-watchlist" pendingLabel="Saving…">
                      Save watchlist
                    </SubmitButton>
                  </Form>
                </section>

                <section className="f9-detail-cell">
                  <p className="f9-app-kicker">Tracking status</p>
                  <h3>{trackingPresentation.headline}</h3>
                  <p className="f9-muted-copy">
                    {trackingPresentation.summary}
                  </p>
                  <div className="f9-work-list is-compact">
                    <div className="f9-work-row">
                      <p className="f9-app-kicker">How ads are checked</p>
                      <p className="f9-muted-copy">
                        Five to Nine checks public ad signals and shows Recent results when live checks are delayed.
                      </p>
                    </div>
                    <div className="f9-work-row">
                      <p className="f9-app-kicker">Status</p>
                      <p className="f9-muted-copy">
                        {trackingPresentation.statusLabel}
                      </p>
                    </div>
                    <div className="f9-work-row">
                      <p className="f9-app-kicker">Last check</p>
                      <p className="f9-muted-copy">
                        {trackingPresentation.lastCheckedAt ? (
                          <LocalTime iso={trackingPresentation.lastCheckedAt} />
                        ) : (
                          "No recent check yet"
                        )}
                      </p>
                    </div>
                    <div className="f9-work-row">
                      <p className="f9-app-kicker">Next check</p>
                      <p className="f9-muted-copy">
                        {!data.selectedWatchlist.isActive
                          ? "Paused"
                          : data.plan === "free"
                            ? "Activation only — no recurring schedule on Free"
                            : sourceCanSchedule
                              ? formatNextScanLabel(data.plan, renderedAt, data.effectiveDeliveryConfig.timezone)
                              : "After source access is ready"}
                      </p>
                    </div>
                  </div>
                  {discoveryStatus.recovery ? (
                    <p className="f9-muted-copy">{discoveryStatus.recovery}</p>
                  ) : null}
                  <Link className="f9-secondary-button" to="/app/source-access">
                    Review tracking access
                  </Link>
                  {data.showPresenceNav ? (
                    <>
                      <h3>Website presence</h3>
                      <p className="f9-muted-copy">
                        Track public website, blog, and feed changes for this competitor in Presence — separate from ad
                        watchlists.
                      </p>
                      <Link className="f9-secondary-button" to="/app/presence">
                        Open Presence
                      </Link>
                    </>
                  ) : null}
                </section>
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

                <section>
                  <p className="f9-app-kicker">See what changed</p>
                  {data.events.length === 0 ? (
                    <p className="f9-muted-copy">
                      {resolveEmptyWatchlistEventCopy({
                        lastScannedAt: data.selectedWatchlist.lastScannedAt,
                        latestRun: (data.runs[0] as WatchlistRunRecord | undefined) ?? null,
                        nextScanLabel: sourceCanSchedule
                          ? formatNextScanLabel(
                              data.plan,
                              renderedAt,
                              data.effectiveDeliveryConfig.timezone,
                            )
                          : null,
                        plan: data.plan,
                      })}
                    </p>
                  ) : (
                    <ul className="event-list">
                      {data.events.map((event) => {
                        const proofCapture = event.proofCaptureId
                          ? proofCapturesById.get(event.proofCaptureId) ?? null
                          : null;
                        const lastAttempt = lastAttemptByEventId.get(event.id) ?? null;
                        const intelligence = buildChangeIntelligenceSummary(
                          event,
                          data.effectiveDeliveryConfig.timezone,
                        );

                        const isHighlighted = data.highlightedEventId === event.id;
                        return (
                          <li
                            className={`f9-event-card${isHighlighted ? " is-highlighted" : ""}`}
                            id={`event-${event.id}`}
                            key={event.id}
                            tabIndex={isHighlighted ? -1 : undefined}
                          >
                            <div className="f9-panel-toolbar">
                              <div>
                                <p className="f9-app-kicker">
                                  {formatWatchEventTypeLabel(event.eventType)} · {formatWatchEventStatusLabel(event.status)}
                                </p>
                                <h3>{event.title}</h3>
                              </div>
                              <span className="f9-status-pill">{formatImportanceBandLabel(event.importanceScore)}</span>
                            </div>
                            <p>{event.summary}</p>
                            <div className="f9-work-list is-compact" style={{ marginTop: "0.75rem" }}>
                              <div className="f9-work-row">
                                <p className="f9-app-kicker">Evidence summary</p>
                                <p className="f9-muted-copy">
                                  {proofCapture
                                    ? `${formatConfidenceBandLabel(proofCapture.fieldConfidence)} · ${intelligence.proofTrail}`
                                    : intelligence.proofTrail}
                                </p>
                              </div>
                              <div className="f9-work-row">
                                <p className="f9-app-kicker">Why this alerted</p>
                                <p className="f9-muted-copy">
                                  {formatWhyAlertedLabel({
                                    eventType: event.eventType,
                                    status: event.status,
                                    metadata: event.metadata,
                                  })}
                                </p>
                              </div>
                              <div className="f9-work-row">
                                <p className="f9-app-kicker">Next review</p>
                                <p className="f9-muted-copy">{intelligence.recommendedAction}</p>
                              </div>
                              <div className="f9-work-row">
                                <p className="f9-app-kicker">Last send state</p>
                                <p className="f9-muted-copy">
                                  {lastAttempt
                                    ? `${formatDeliveryAttemptStatusLabel(lastAttempt.status, lastAttempt.channel)} · ${
                                        lastAttempt.targetValue
                                      }`
                                    : "No watchlist send recorded yet."}
                                </p>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section>
                  <div className="f9-panel-toolbar">
                    <div>
                      <p className="f9-app-kicker">Evidence and delivery</p>
                      <h3 style={{ marginTop: 0 }}>Evidence and alerts</h3>
                    </div>
                  </div>

                  <div className="f9-detail-split">
                    <article className="f9-detail-cell">
                      <p className="f9-app-kicker">Recent evidence checks</p>
                      <h3>Evidence freshness</h3>
                      <p className="f9-muted-copy">
                        {data.proofSummary.successfulAttempts} successful · {data.proofSummary.failedAttempts} failed
                        {data.proofSummary.skippedAttempts > 0
                          ? ` · ${data.proofSummary.skippedAttempts} skipped`
                          : ""}
                      </p>
                      <p className="f9-muted-copy">
                        {data.proofSummary.lastSuccessfulProofAt ? (
                          <>
                            Last good evidence check{" "}
                            <WatchlistProofAge
                              capturedAt={data.proofSummary.lastSuccessfulProofAt}
                              renderedAt={data.renderedAt}
                            />
                          </>
                        ) : (
                          "No successful evidence check yet."
                        )}
                      </p>
                      <div className="f9-work-list is-compact">
                        {data.recentProofCaptures.slice(0, 4).map((capture) => (
                          <div className="f9-work-row" key={capture.id}>
                            <div>
                              <h4 style={{ marginBottom: "0.25rem" }}>
                                {formatProofCaptureStatusLabel(capture.status)}
                              </h4>
                              <p className="f9-muted-copy">
                                {formatConfidenceBandLabel(capture.fieldConfidence)} ·{" "}
                                <WatchlistProofAge
                                  capturedAt={capture.succeededAt ?? capture.attemptedAt}
                                  renderedAt={data.renderedAt}
                                />
                              </p>
                            </div>
                          </div>
                        ))}
                        {data.recentProofCaptures.length === 0 ? (
                          <p className="f9-muted-copy">Evidence checks will appear here after the next proof-backed check.</p>
                        ) : null}
                      </div>
                    </article>

                    <article className="f9-detail-cell">
                      <p className="f9-app-kicker">Delivery settings</p>
                      <h3>Channel policy</h3>
                      {!data.watchlistDeliveryConfig ? (
                        <p className="f9-muted-copy">
                          Using the default alert settings for this account.
                        </p>
                      ) : null}
                      {canConfigureDigestSettings ? <Form method="post" className="f9-work-list is-compact">
                        <input name="intent" type="hidden" value="save-delivery-config" />
                        <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                        <label className="f9-field">
                          <span>Sensitivity</span>
                          <select defaultValue={data.effectiveDeliveryConfig.sensitivityMode} name="sensitivityMode">
                            <option value="quiet">Quiet</option>
                            <option value="balanced">Balanced</option>
                            <option value="aggressive">Aggressive</option>
                            <option value="auto">Auto (Balanced)</option>
                          </select>
                        </label>
                        <label className="f9-field">
                          <span>Timezone</span>
                          <input
                            defaultValue={data.effectiveDeliveryConfig.timezone ?? "UTC"}
                            aria-describedby="delivery-timezone-help"
                            name="timezone"
                            type="text"
                          />
                          <small className="f9-muted-copy" id="delivery-timezone-help">
                            Use an IANA timezone such as Asia/Kolkata or UTC.
                          </small>
                        </label>
                        <div className="f9-field-pair">
                          <label className="f9-field">
                            <span>Quiet hours start</span>
                            <input
                              defaultValue={data.effectiveDeliveryConfig.quietHours?.startHour ?? 22}
                              name="quietHoursStart"
                              type="number"
                            />
                          </label>
                          <label className="f9-field">
                            <span>Quiet hours end</span>
                            <input
                              defaultValue={data.effectiveDeliveryConfig.quietHours?.endHour ?? 8}
                              name="quietHoursEnd"
                              type="number"
                            />
                          </label>
                        </div>
                        {canInstantAlert ? (
                          <label className="f9-field f9-field-inline">
                            <input defaultChecked={data.effectiveDeliveryConfig.instantEnabled} name="instantEnabled" type="checkbox" />
                            <span>High-priority alerts (sent as soon as a scan confirms a major change)</span>
                          </label>
                        ) : (
                          <div className="f9-field f9-action-row">
                            <label className="f9-field-inline">
                              <input disabled type="checkbox" />
                              <span>High-priority alerts require Starter.</span>
                            </label>
                            <Link className="f9-secondary-button" to="/app/billing?source=watchlists#plans">
                              View plans
                            </Link>
                          </div>
                        )}
                        <label className="f9-field f9-field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.digestEnabled} name="digestEnabled" type="checkbox" />
                          <span>{data.plan === "free" ? "Weekly digest email" : "Digest alerts"}</span>
                        </label>
                        {canEmailDelivery ? (
                          <label className="f9-field f9-field-inline">
                            <input defaultChecked={data.effectiveDeliveryConfig.emailEnabled} name="emailEnabled" type="checkbox" />
                            <span>Email enabled</span>
                          </label>
                        ) : (
                          <label className="f9-field f9-field-inline">
                            <input disabled type="checkbox" />
                            <span>
                              Email delivery requires Scout. {" "}
                              <Link to="/app/billing?source=watchlists#plans">View plans</Link>
                            </span>
                          </label>
                        )}
                        {data.whatsappAvailable ? (
                          <label className="f9-field f9-field-inline">
                            <input defaultChecked={data.effectiveDeliveryConfig.whatsappEnabled} name="whatsappEnabled" type="checkbox" />
                            <span>WhatsApp enabled</span>
                          </label>
                        ) : null}
                        {showSlackDelivery ? (
                        <label className="f9-field f9-field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.slackEnabled} name="slackEnabled" type="checkbox" />
                          <span>Slack enabled</span>
                        </label>
                        ) : null}
                        <SubmitButton className="f9-primary-button" intent="save-delivery-config" pendingLabel="Saving…">
                          Save delivery settings
                        </SubmitButton>
                      </Form> : (
                        <div className="f9-work-list is-compact">
                          <p className="f9-muted-copy">
                            Delivery settings are managed by the workspace owner.
                          </p>
                        </div>
                      )}
                    </article>
                  </div>
                </section>

                <section>
                  <div className="f9-panel-toolbar">
                    <div>
                      <p className="f9-app-kicker">Delivery targets</p>
                      <h3 style={{ marginTop: 0 }}>Targets and pauses</h3>
                    </div>
                  </div>
                  <div className="f9-detail-split">
                  <div className="f9-detail-cell">
                  <p className="f9-app-kicker">Watchlist targets</p>
                  {data.canManageDelivery ? <div className="f9-work-list is-compact">
                    {data.deliveryTargets.map((target) => (
                      <div className="f9-work-row" key={target.id}>
                        <div>
                          <h4 style={{ marginBottom: "0.25rem" }}>
                            {target.channel === "email" ? "Email" : "WhatsApp"}
                          </h4>
                          <p className="f9-muted-copy">
                            {toPublicDeliveryTarget(target, {
                              verifiedAccountEmail: data.verifiedAccountEmail,
                            }).targetValue}
                          </p>
                          <p className="f9-muted-copy">
                            {target.isPaused
                              ? "Paused"
                              : target.channel === "whatsapp" && !data.whatsappAvailable
                                ? "Not yet available — WhatsApp delivery isn't live"
                                : target.channel === "whatsapp" && !target.templateEligible
                                  ? "Waiting for WhatsApp approval"
                                  : "Ready"}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          {target.channel === "email" && canEmailDelivery ? (
                            <Form method="post">
                              <input name="intent" type="hidden" value="send-test-email" />
                              <input name="targetId" type="hidden" value={target.id} />
                              <input
                                name="requestToken"
                                type="hidden"
                                value={data.deliveryTestRequestTokens[target.id] ?? ""}
                              />
                              <SubmitButton
                                className="f9-secondary-button"
                                intent="send-test-email"
                                match={{ targetId: target.id }}
                                pendingLabel="Sending…"
                              >
                                Send test
                              </SubmitButton>
                            </Form>
                          ) : target.channel === "email" ? (
                            <Link className="f9-secondary-button" to="/app/billing?source=watchlists#plans">
                              Upgrade for email
                            </Link>
                          ) : null}
                          <Form method="post">
                            <input name="intent" type="hidden" value="toggle-delivery-target" />
                            <input name="targetId" type="hidden" value={target.id} />
                            <SubmitButton
                              className="f9-secondary-button"
                              intent="toggle-delivery-target"
                              match={{ targetId: target.id }}
                              pendingLabel={target.isPaused ? "Resuming…" : "Pausing…"}
                            >
                              {target.isPaused ? "Resume" : "Pause"}
                            </SubmitButton>
                          </Form>
                        </div>
                      </div>
                    ))}
                    {data.deliveryTargets.length === 0 ? (
                      <p className="f9-muted-copy">
                        Using the default delivery target until you add one for this competitor.
                      </p>
                    ) : null}
                  </div> : (
                    <div className="f9-work-list is-compact">
                      <p className="f9-muted-copy">
                        Delivery settings and recipient targets are managed by the workspace owner.
                      </p>
                      {data.verifiedAccountEmail ? (
                        <p className="f9-muted-copy">Your verified account email: {data.verifiedAccountEmail}</p>
                      ) : null}
                    </div>
                  )}
                  {data.workspaceDeliveryTargets.length > 0 ? (
                    <div>
                      <p className="f9-app-kicker">Default delivery</p>
                      <p className="f9-muted-copy">
                        {data.workspaceDeliveryTargets
                          .map((target) =>
                            toPublicDeliveryTarget(target, {
                              verifiedAccountEmail: data.verifiedAccountEmail,
                            }).targetValue,
                          )
                          .join(" · ")}
                      </p>
                    </div>
                  ) : null}
                  </div>

                  {canConfigureDelivery ? <Form method="post" className="f9-detail-cell">
                    <p className="f9-app-kicker">Add delivery target</p>
                    <input name="intent" type="hidden" value="add-delivery-target" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <label className="f9-field">
                      <span>Channel</span>
                      <select defaultValue="email" name="channel">
                        <option value="email">Email</option>
                        {data.whatsappAvailable ? (
                          <option value="whatsapp">WhatsApp</option>
                        ) : null}
                      </select>
                    </label>
                    <label className="f9-field">
                      <span>Target</span>
                      <input
                        name="targetValue"
                        placeholder={data.whatsappAvailable ? "owner@example.com or +919999999999" : "owner@example.com"}
                        type="text"
                      />
                    </label>
                    <label className="f9-field f9-field-inline">
                      <input defaultChecked name="explicitOptIn" type="checkbox" />
                      <span>Explicit opt-in confirmed</span>
                    </label>
                    <SubmitButton className="f9-secondary-button" intent="add-delivery-target" pendingLabel="Adding…">
                      Add delivery target
                    </SubmitButton>
                  </Form> : (
                    <div className="f9-detail-cell">
                      <p className="f9-app-kicker">Add delivery target</p>
                      {data.canManageDelivery ? (
                        <>
                          <p className="f9-muted-copy">
                            Paid plans can send proof-backed alerts to email. Upgrade to add a delivery target.
                          </p>
                          <Link className="f9-secondary-button" to="/app/billing?source=watchlists#plans">
                            Upgrade for delivery
                          </Link>
                        </>
                      ) : (
                        <p className="f9-muted-copy">
                          Ask the workspace owner to add or change delivery targets.
                        </p>
                      )}
                    </div>
                  )}
                  </div>
                </section>

                <section>
                  <p className="f9-app-kicker">Recent checks</p>
                  {data.runs.length === 0 ? (
                    <p className="f9-muted-copy">No checks recorded yet.</p>
                  ) : (
                    <ul className="event-list f9-detail-split">
                      {data.runs.map((run) => {
                        const timing = resolveWatchlistRunTiming(run);
                        return (
                        <li className="f9-event-card" key={run.id}>
                          <div className="f9-panel-toolbar">
                            <div>
                              <p className="f9-app-kicker">
                                {formatRunStatusLabel(run.status, run.errorCode)} · {formatRunTriggerLabel(run.triggerType)}
                              </p>
                              <h3>
                                Started <LocalTime iso={run.startedAt} />
                              </h3>
                            </div>
                            <span className="f9-status-pill">{run.pagesScanned} pages</span>
                          </div>
                          <p className="f9-muted-copy">
                            {timing.timestamp ? (
                              <>
                                {timing.label} <LocalTime iso={timing.timestamp} />
                              </>
                            ) : (
                              timing.label
                            )}
                            {run.baselineFromRunId ? ` · baseline ${run.baselineFromRunId.slice(0, 8)}` : ""}
                          </p>
                          {formatRunSummary(run.summary) ? (
                            <p className="f9-muted-copy">{formatRunSummary(run.summary)}</p>
                          ) : null}
                          {formatRunEventTypes(run.summary) ? (
                            <p className="f9-muted-copy">{formatRunEventTypes(run.summary)}</p>
                          ) : null}
                          {run.errorMessage ? <p>{run.errorMessage}</p> : null}
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <details>
                  <summary>Candidate history</summary>
                  <div className="f9-work-list is-compact" style={{ marginTop: "1rem" }}>
                    {data.eventCandidates.length === 0 ? (
                      <p className="f9-muted-copy">No candidate history yet.</p>
                    ) : (
                      data.eventCandidates.map((candidate) => (
                        <div className="f9-work-row" key={candidate.id}>
                          <div>
                            <h4 style={{ marginBottom: "0.25rem" }}>{candidate.title}</h4>
                            <p className="f9-muted-copy">
                              {formatWatchEventStatusLabel(candidate.status)} · {formatImportanceBandLabel(candidate.importanceScore)}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </details>
              </div>
            </>
          ) : (
            <EmptyState
              action={{ label: "Add competitor", to: "/search" }}
              description="Paste your website or a competitor website to start tracking offer, CTA, headline, and form changes."
              title="Add your first competitor"
            />
          )}
        </article>
      </div>
      </section>
    </DashboardPage>
  );
}

function isDeliveryTestRequestToken(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function emptyProofSummary(): WatchlistProofSummary {
  return {
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    skippedAttempts: 0,
    lastAttemptAt: null,
    lastSuccessfulProofAt: null,
  };
}

function formatWatchlistRefreshFailure(
  failureClass: DiscoveryFailureClass,
  retryAfterSeconds: number | null = null,
) {
  switch (failureClass) {
    case "rate_limited":
      return retryAfterSeconds && retryAfterSeconds > 0
        ? `Competitor ad checks are temporarily rate limited. Retry after about ${formatRetryAfterLabel(
            retryAfterSeconds,
          )}. Scheduled checks will keep retrying.`
        : "Competitor ad checks are temporarily rate limited. Scheduled checks will keep retrying.";
    case "timeout":
      return "Competitor ad check timed out. Try again in a few minutes.";
    case "login_wall":
      return "Meta blocked the ad library check just now. Try again in a few minutes.";
    default:
      return "Competitor ad checks are temporarily unavailable. Try again in a few minutes.";
  }
}

function formatRetryAfterLabel(retryAfterSeconds: number) {
  if (retryAfterSeconds < 60) {
    return `${retryAfterSeconds}s`;
  }

  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function buildProofSummary(captures: ProofCaptureRecord[]): WatchlistProofSummary {
  const successful = captures.filter((capture) => capture.status === "succeeded");
  const failed = captures.filter((capture) => capture.status === "failed");
  const skipped = captures.filter((capture) => capture.status.startsWith("skipped_"));

  return {
    totalAttempts: captures.length,
    successfulAttempts: successful.length,
    failedAttempts: failed.length,
    skippedAttempts: skipped.length,
    lastAttemptAt: captures[0]?.attemptedAt ?? null,
    lastSuccessfulProofAt: successful[0]?.succeededAt ?? null,
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

function isVisibleDeliveryChannel(
  channel: string,
  visibility: { showSlackDelivery: boolean; whatsappAvailable: boolean },
) {
  return (
    channel === "email" ||
    (channel === "whatsapp" && visibility.whatsappAvailable) ||
    (channel === "slack" && visibility.showSlackDelivery)
  );
}

function visibleDeliveryChannels(
  visibility: { showSlackDelivery: boolean; whatsappAvailable: boolean },
): DeliveryChannel[] {
  const channels: DeliveryChannel[] = ["email"];
  if (visibility.whatsappAvailable) {
    channels.push("whatsapp");
  }
  if (visibility.showSlackDelivery) {
    channels.push("slack");
  }
  return channels;
}

function sortByUpdatedAtDesc<T extends { updatedAt: string }>(records: T[]) {
  return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortByCreatedAtDesc<T extends { createdAt: string }>(records: T[]) {
  return [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function maskDormantDeliveryConfig<T extends { whatsappEnabled: boolean; slackEnabled: boolean }>(
  config: T,
  visibility: { showSlackDelivery: boolean; whatsappAvailable: boolean },
): T {
  return {
    ...config,
    whatsappEnabled: visibility.whatsappAvailable && config.whatsappEnabled,
    slackEnabled: visibility.showSlackDelivery && config.slackEnabled,
  };
}

function normalizeSensitivityMode(value: string) {
  if (value === "quiet" || value === "balanced" || value === "aggressive" || value === "auto") {
    return value;
  }

  return "balanced";
}

function buildLastAttemptByEventId(attempts: PublicDeliveryAttemptSummary[]) {
  return attempts.reduce((map, attempt) => {
    for (const eventId of attempt.eventIds) {
      if (!map.has(eventId)) {
        map.set(eventId, attempt);
      }
    }
    return map;
  }, new Map<string, PublicDeliveryAttemptSummary>());
}

function formatRunSummary(summary: Record<string, unknown>) {
  const message = typeof summary.message === "string" ? summary.message.trim() : "";
  const parts = [
    message || null,
    formatNumericSummaryPart(summary, "adsSeen", "ads seen"),
    formatNumericSummaryPart(summary, "candidatesDetected", "candidates detected"),
    formatNumericSummaryPart(summary, "proofsAttempted", "evidence checks attempted"),
    formatNumericSummaryPart(summary, "eventsConfirmed", "events confirmed"),
    formatNumericSummaryPart(summary, "sendsTriggered", "sends triggered"),
    formatNumericSummaryPart(summary, "events", "events total"),
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}

function formatRunEventTypes(summary: Record<string, unknown>) {
  const value = summary.eventTypes;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const parts = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([eventType, count]) => `${formatWatchEventTypeLabel(eventType)} ×${count}`);

  return parts.join(" · ");
}

function formatDiscoveryHeadline(status: Pick<MetaIntegrationStatus, "status">) {
  if (status.status === "healthy") {
    return "Live competitor tracking is ready";
  }
  if (status.status === "cache_only") {
    return "Using recent competitor results";
  }
  if (status.status === "demo") {
    return "Add a real competitor to start live tracking";
  }
  if (status.status === "disabled") {
    return "Competitor tracking is unavailable";
  }
  return "Live ad checks are temporarily delayed";
}

function formatDiscoveryStatusLabel(status: MetaIntegrationStatus["status"]) {
  if (status === "cache_only") {
    return "Using recent results";
  }
  if (status === "healthy") {
    return "Ready";
  }
  if (status === "demo") {
    return "Setup needed";
  }
  if (status === "degraded") {
    return "Needs attention";
  }
  if (status === "disabled") {
    return "Unavailable";
  }
  return "Needs attention";
}

export function resolveWatchlistTrackingPresentation(
  status: CustomerDiscoveryStatus,
  runs: WatchlistRunRecord[],
  proofSummary: WatchlistProofSummary,
) {
  const latestSuccessfulRunAt = runs.reduce<string | null>((latest, run) => {
    if (run.status !== "succeeded" || !run.finishedAt) return latest;
    return !latest || Date.parse(run.finishedAt) > Date.parse(latest) ? run.finishedAt : latest;
  }, null);
  const hasStoredEvidence = proofSummary.successfulAttempts > 0 || Boolean(latestSuccessfulRunAt);
  const lastCheckedAt = status.lastCheckedAt ?? latestSuccessfulRunAt ?? proofSummary.lastSuccessfulProofAt;

  if (status.status === "demo" && hasStoredEvidence) {
    return {
      headline: "Monitoring history is saved; new checks need source access",
      summary:
        "Your last successful evidence remains available. Review source access before relying on new competitor changes.",
      statusLabel: "Needs source access",
      lastCheckedAt,
    };
  }

  return {
    headline: formatDiscoveryHeadline(status),
    summary:
      customerDiscoverySummary(status.summary) ??
      "Tracking status will appear after the first check.",
    statusLabel: formatDiscoveryStatusLabel(status.status),
    lastCheckedAt,
  };
}

export function resolveWatchlistListScanPresentation(input: {
  isActive: boolean;
  lastScannedAt: string | null;
  latestRun: WatchlistRunRecord | null;
  plan: string;
}) {
  if (!input.isActive) {
    return input.lastScannedAt
      ? { label: "Paused · last successful check", timestamp: input.lastScannedAt }
      : { label: "Paused before its first check", timestamp: null };
  }

  const run = input.latestRun;
  if (!run) {
    return input.lastScannedAt
      ? { label: "Last successful check", timestamp: input.lastScannedAt }
      : { label: "No completed scan yet — open to review status", timestamp: null };
  }
  if (run.status === "running") {
    return {
      label: input.lastScannedAt ? "Checking for changes now" : input.plan === "free" ? "Activation scan running" : "First scan running",
      timestamp: null,
    };
  }
  if (run.status === "pending") {
    const delayed = [
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(run.errorCode ?? "");
    return {
      label: delayed
        ? "Scan delayed — open to review recovery"
        : input.lastScannedAt
          ? "Next check queued"
          : input.plan === "free"
            ? "Activation scan queued"
            : "First scan queued",
      timestamp: null,
    };
  }
  if (run.status === "failed") {
    return { label: "Latest check failed — open to recover", timestamp: null };
  }
  if (run.status === "skipped") {
    if (run.errorCode === "e2e_provider_network_denied") {
      return { label: "New checks paused — source access needed", timestamp: null };
    }
    if (run.errorCode === "capacity_budget") {
      return { label: "Latest check delayed — next monitoring window", timestamp: null };
    }
    return { label: "Latest check did not run — open to review", timestamp: null };
  }

  return {
    label: "Last successful check",
    timestamp: run.finishedAt ?? input.lastScannedAt,
  };
}

export function resolveEmptyWatchlistEventCopy(input: {
  lastScannedAt: string | null;
  latestRun: WatchlistRunRecord | null;
  nextScanLabel: string | null;
  plan: string;
}) {
  const activationOnly = input.plan === "free";
  const scanName = activationOnly ? "activation scan" : "first scan";
  if ((!input.latestRun && input.lastScannedAt) || input.latestRun?.status === "succeeded") {
    if (activationOnly) {
      return input.nextScanLabel
        ? `No confirmed changes yet — your activation scan is complete. Your next weekly check runs ${input.nextScanLabel}; paid plans check every 3–6 hours.`
        : "No confirmed changes yet — your activation scan is complete. Your watchlist is checked weekly; paid plans check every 3–6 hours.";
    }
    return input.nextScanLabel
      ? `No confirmed changes yet — we'll flag the next one. Next scheduled scan: ${input.nextScanLabel}.`
      : "No confirmed changes in the last completed check. New checks resume after source access is ready.";
  }

  if (!input.latestRun) {
    return activationOnly
      ? "Your activation scan has not started yet. Review tracking access; contact support if it does not resume."
      : "Your first scan has not started yet. Review tracking access or retry when the source is ready.";
  }
  if (input.latestRun.status === "running") {
    return activationOnly
      ? "Your activation scan is running now. Results appear here in a couple of minutes. After this, free checks weekly; paid plans check every 3–6 hours."
      : "Your first scan is running now. Results appear here in a couple of minutes.";
  }
  if (input.latestRun.status === "pending") {
    const delayed = [
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(input.latestRun.errorCode ?? "");
    return delayed
      ? `Your ${scanName} is delayed and queued for recovery. Review tracking access if it does not resume.`
      : `Your ${scanName} is queued and waiting for a monitoring worker.`;
  }
  if (input.latestRun.status === "failed") {
    return activationOnly
      ? "Your activation scan could not finish. Review tracking access, then contact support if it remains unavailable."
      : "Your first scan could not finish. Review tracking access, then retry or contact support.";
  }
  if (input.latestRun.errorCode === "e2e_provider_network_denied") {
    return activationOnly
      ? "Your activation scan paused safely before an external check. Review tracking access; contact support if it does not resume."
      : "Your first scan paused safely before an external check. Review tracking access before retrying.";
  }
  return `Your ${scanName} stopped before evidence was created. Review Recent checks for the recovery path.`;
}

export function resolveWatchlistRunTiming(run: WatchlistRunRecord) {
  if (run.finishedAt) return { label: "Finished", timestamp: run.finishedAt };
  if (run.status === "running") return { label: "Still running", timestamp: null };
  if (run.status === "pending") {
    const retrying = [
      "dispatch_failed",
      "reconcile_dispatch_failed",
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(run.errorCode ?? "");
    return {
      label: retrying ? "Queued for retry" : "Queued — waiting for a monitoring worker",
      timestamp: null,
    };
  }
  if (run.status === "failed") return { label: "Stopped after a failed check", timestamp: null };
  if (run.status === "skipped") return { label: "Stopped before evidence was created", timestamp: null };
  return { label: "Completed", timestamp: null };
}

export function resolveWatchlistRunCustomerError(run: WatchlistRunRecord, plan: string) {
  if (!run.errorMessage) return null;
  return plan === "free"
    ? "This activation scan failed. Check Source access, then contact support if it does not resume."
    : "This scan failed. Check Source access, then retry or contact support.";
}

export function firstScanPollingKey(input: {
  watchlistId: string;
  run: WatchlistRunRecord | null;
}) {
  return `${input.watchlistId}:${input.run?.id ?? "none"}:${input.run?.status ?? "missing"}`;
}

function formatNumericSummaryPart(
  summary: Record<string, unknown>,
  key: keyof WatchlistRunSummaryCounts | "adsSeen" | "events",
  label: string,
) {
  const value = summary[key];
  return typeof value === "number" ? `${value} ${label}` : null;
}

const FIRST_SCAN_FAST_POLL_LIMIT = 30; // 4s × 30 ≈ 2 minutes
const FIRST_SCAN_SLOW_POLL_LIMIT = 10; // then 30s × 10 ≈ 5 more minutes
const FIRST_SCAN_POLL_LIMIT = FIRST_SCAN_FAST_POLL_LIMIT + FIRST_SCAN_SLOW_POLL_LIMIT;

// The activation banner is driven by the durable run, never inferred from a
// missing last-scanned timestamp. Poll only while the queue can still change.
function FirstScanBanner(props: {
  watchlistId: string;
  plan: string;
  run: WatchlistRunRecord | null;
}) {
  const revalidator = useRevalidator();
  const [pollCount, setPollCount] = useState(0);
  const shouldPoll = !props.run || props.run.status === "pending" || props.run.status === "running";
  const pollingKey = firstScanPollingKey(props);

  useEffect(() => {
    setPollCount(0);
  }, [pollingKey]);

  useEffect(() => {
    if (!shouldPoll || pollCount >= FIRST_SCAN_POLL_LIMIT) {
      return;
    }

    // WP-40: fast poll first, then back off to 30s so a scan finishing at
    // minute 3–4 still surfaces without a manual refresh.
    const intervalMs = pollCount < FIRST_SCAN_FAST_POLL_LIMIT ? 4000 : 30_000;
    const timer = setTimeout(() => {
      setPollCount((count) => count + 1);
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [pollCount, revalidator, shouldPoll]);

  const delayed =
    props.run?.status === "pending" &&
    [
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(props.run.errorCode ?? "");
  const safelyPaused =
    props.run?.status === "skipped" && props.run.errorCode === "e2e_provider_network_denied";
  const completed = props.run?.status === "succeeded";
  const failed = props.run?.status === "failed";
  const skipped = props.run?.status === "skipped" && !safelyPaused;
  const timedOut = shouldPoll && pollCount >= FIRST_SCAN_POLL_LIMIT;
  const pastFastPoll = shouldPoll && pollCount >= FIRST_SCAN_FAST_POLL_LIMIT && !timedOut;
  const scanLabel = props.plan === "free" ? "Activation scan" : "First scan";

  const heading = safelyPaused
    ? `${scanLabel} safely paused`
    : completed
      ? `${scanLabel} complete`
    : failed
      ? `${scanLabel} needs attention`
      : skipped
        ? `${scanLabel} did not run`
        : delayed || timedOut || !props.run
          ? `${scanLabel} delayed`
          : props.run.status === "running"
            ? "Scanning this competitor now…"
            : `${scanLabel} queued`;

  const message = safelyPaused
    ? "Provider access is disabled in this local release proof. No external check was attempted."
    : completed
      ? "The first scan is ready. Review the proof below before deciding what to monitor next."
    : failed
      ? "We could not finish this check. Review Source access, then contact support if the next attempt also fails."
      : skipped
        ? "This check stopped safely before results were created. Review Recent checks for the reason and recovery path."
        : delayed || timedOut || !props.run
          ? props.plan === "free"
            ? "The activation scan is queued for recovery. After activation, free checks weekly; paid plans check every 3–6 hours."
            : "The first scan is queued for recovery, and the next scheduled scan remains available."
          : props.run.status === "running"
            ? props.plan === "free"
              ? "Activation results usually land within a couple of minutes. This page updates by itself. After this, free checks weekly; paid plans check every 3–6 hours."
              : "First results usually land within a couple of minutes. This page updates by itself."
            : "The activation scan is waiting for an available monitoring worker. This page updates by itself.";

  return (
    <article
      className={`f9-checkout-banner ${failed || skipped ? "is-error" : completed ? "is-success" : "is-pending"}`}
      aria-live="polite"
    >
      <div>
        <span className="f9-app-kicker">{props.plan === "free" ? "Activation scan" : "First scan"}</span>
        <h2>
          {props.run?.status === "running" ? (
            <span className="f9-checkout-pulse" aria-hidden="true" />
          ) : null}
          {heading}
        </h2>
        <p>{message}</p>
        {failed ? <Link to="/app/source-access">Review Source access</Link> : null}
        {(pastFastPoll || timedOut) && shouldPoll ? (
          <p style={{ marginTop: "0.75rem" }}>
            <button
              className="f9-secondary-button"
              type="button"
              onClick={() => {
                if (revalidator.state === "idle") {
                  revalidator.revalidate();
                }
              }}
            >
              Check now
            </button>
            {pastFastPoll && !timedOut ? (
              <span className="f9-muted-copy" style={{ marginLeft: "0.75rem" }}>
                Still waiting — checking every 30 seconds.
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function formatRunStatusLabel(status: string, errorCode?: string | null) {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") {
    if (errorCode === "capacity_budget") return "Delayed — monitoring window filled";
    if (errorCode === "workflow_binding_missing" || errorCode === "dispatch_createbatch_missing") {
      return "Delayed — monitoring service unavailable";
    }
    return "Cancelled";
  }
  if (status === "pending") {
    if (
      errorCode === "workflow_binding_missing" ||
      errorCode === "dispatch_createbatch_missing" ||
      errorCode === "dispatch_rate_limited"
    ) {
      return "Delayed — monitoring service unavailable";
    }
    if (errorCode === "dispatch_failed" || errorCode === "reconcile_dispatch_failed") {
      return "Retrying";
    }
    return "Queued";
  }
  if (status === "running") return "Running";
  return status;
}

function formatRunTriggerLabel(triggerType: string) {
  if (triggerType === "manual") return "Manual refresh";
  if (triggerType === "scheduled") return "Scheduled scan";
  if (triggerType === "workflow") return "Background scan";
  return triggerType;
}
