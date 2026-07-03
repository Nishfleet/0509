import { useEffect, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { CopyButton } from "~/components/copy-button";
import { LocalTime } from "~/components/local-time";
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
  formatProofAgeLabel,
  formatWhyAlertedLabel,
} from "~/lib/landing-page-display";
import { toPublicDeliveryTarget, type PublicDeliveryTargetRecord } from "~/lib/delivery-target-public";
import { buildWatchlistInsightDepth } from "~/lib/insight-depth";
import { normalizeSavedQuery } from "~/lib/normalize";
import { formatNextScanLabel } from "~/lib/schedule-display";
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
  DeliveryAttemptRecord,
  DiscoveryFailureClass,
  EventCandidateRecord,
  MetaIntegrationStatus,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistProofSummary,
  WatchlistRunSummaryCounts,
  WorkspaceDeliveryConfigRecord,
  DeliveryChannel,
} from "~/lib/types";

export const meta = () => [{ title: "Watchlists | Five to Nine" }];
const WATCHLIST_DELIVERY_TARGET_DISPLAY_LIMIT = 12;
const WORKSPACE_DELIVERY_TARGET_DISPLAY_LIMIT = 8;
const RECENT_DELIVERY_ATTEMPT_DISPLAY_LIMIT = 16;

export function HydrateFallback() {
  return <DashboardRouteLoading title="Watchlists" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
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
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const { getUserPlan } = await import("~/lib/plan.server");
  const { isWhatsAppProviderConfigured } = await import("~/lib/env.server");
  const { presenceNavVisible } = await import("~/lib/presence-internal-access.server");
  const showSlackDelivery = isSlackDeliveryCustomerFacing();
  const whatsappAvailable = isWhatsAppDeliveryCustomerFacing() && isWhatsAppProviderConfigured(env);
  const showPresenceNav = await presenceNavVisible(env, workspaceUserId);
  const [watchlists, discoveryStatus, plan] = await Promise.all([
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
    resolveCommercialAdSourceStatus(env),
    getUserPlan(env, workspaceUserId),
  ]);
  const url = new URL(request.url);
  const selectedWatchlistId = url.searchParams.get("watchlist") ?? watchlists[0]?.id ?? null;
  const selectedWatchlist = selectedWatchlistId
    ? await getWatchlist(env, selectedWatchlistId, workspaceUserId)
    : null;

  if (!selectedWatchlist) {
    return {
      watchlists,
      selectedWatchlist: null,
      eventCandidates: [] as EventCandidateRecord[],
      events: [] as WatchEventRecord[],
      runs: [],
      workspaceDeliveryConfig: buildLegacyWorkspaceConfig(workspaceUserId, Boolean(session.user.email)),
      watchlistDeliveryConfig: null,
      effectiveDeliveryConfig: buildLegacyWorkspaceConfig(workspaceUserId, Boolean(session.user.email)),
      deliveryTargets: [] as PublicDeliveryTargetRecord[],
      workspaceDeliveryTargets: [] as PublicDeliveryTargetRecord[],
      recentDeliveryAttempts: [] as DeliveryAttemptRecord[],
      recentProofCaptures: [] as ProofCaptureRecord[],
      proofSummary: emptyProofSummary(),
      discoveryStatus,
      plan,
      whatsappAvailable,
      showPresenceNav,
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
  ]);

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

  return {
    watchlists,
    selectedWatchlist,
    eventCandidates,
    events,
    runs,
    workspaceDeliveryConfig: maskDormantDeliveryConfig(workspaceDeliveryConfig, visibleDelivery),
    watchlistDeliveryConfig: watchlistDeliveryConfig
      ? maskDormantDeliveryConfig(watchlistDeliveryConfig, visibleDelivery)
      : null,
    effectiveDeliveryConfig: maskDormantDeliveryConfig(effectiveDeliveryConfig, visibleDelivery),
    deliveryTargets: watchlistDeliveryTargets
      .filter((target) => isVisibleDeliveryChannel(target.channel, visibleDelivery))
      .map(toPublicDeliveryTarget),
    workspaceDeliveryTargets: workspaceDeliveryTargets
      .filter((target) => isVisibleDeliveryChannel(target.channel, visibleDelivery))
      .map(toPublicDeliveryTarget),
    recentDeliveryAttempts: recentDeliveryAttempts.filter((attempt) =>
      isVisibleDeliveryChannel(attempt.channel, visibleDelivery),
    ),
    recentProofCaptures,
    proofSummary: buildProofSummary(recentProofCaptures),
    discoveryStatus,
    plan,
    whatsappAvailable,
    showPresenceNav,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

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
      return { ok: false, message: "Share links are included in the Agency plan." };
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
      timezone: readOptionalString(formData.get("timezone")) ?? workspaceConfig.timezone ?? null,
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
    const { checkPlanLimit } = await import("~/lib/plan.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    if (!watchlistLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: "You have reached your competitor tracking limit — pause another watchlist first.",
      };
    }

    const resumed = await setWatchlistActive(env, workspaceUserId, watchlistId, true);

    return resumed
      ? { ok: true, message: "Watchlist resumed. It rejoins the next scheduled scan." }
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
    });

    return sent
      ? {
          ok: true,
          message: `Test email sent to ${target.targetValue} — if it doesn't arrive within a few minutes, check the address and spam folder.`,
        }
      : {
          ok: false,
          message: `The test email to ${target.targetValue} failed to send. Check the address or email ${SUPPORT_EMAIL}.`,
        };
  }

  if (intent === "toggle-delivery-target") {
    const { getWatchlist, upsertDeliveryTarget } = await import("~/lib/data.server");
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
    const isPaused = String(formData.get("isPaused") ?? "") === "true";

    if (!channel || !targetValue) {
      return {
        ok: false,
        message: "Delivery target not found.",
      };
    }
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

export default function WatchlistsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const showSlackDelivery = isSlackDeliveryCustomerFacing();
  const [searchParams] = useSearchParams();
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
        <p className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
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
        </p>
      ) : null}

      <div className="f9-dashboard-grid">
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
            {data.watchlists.map((watchlist) => (
              <a
                className={`f9-work-row ${
                  searchParams.get("watchlist") === watchlist.id ||
                  (!searchParams.get("watchlist") && data.selectedWatchlist?.id === watchlist.id)
                    ? "is-active"
                    : ""
                }`}
                href={`/app/watchlists?watchlist=${watchlist.id}`}
                key={watchlist.id}
              >
                <div>
                  <h3>{watchlist.name}</h3>
                  <p className="f9-muted-copy">
                    {formatWatchlistTrackingRole(watchlist.trackingRole)} · {watchlist.targetLabel}
                    {watchlist.isActive ? "" : " · Paused"}
                  </p>
                  <p className="f9-muted-copy">
                    {watchlist.lastScannedAt ? (
                      <>
                        Last scanned <LocalTime iso={watchlist.lastScannedAt} />
                      </>
                    ) : watchlist.isActive ? (
                      "First scan in progress — results land in a few minutes"
                    ) : (
                      "Paused before its first scan"
                    )}
                  </p>
                </div>
              </a>
            ))}
            {data.watchlists.length === 0 ? (
              <div className="f9-empty-panel">
                <h3>Add your first competitor</h3>
                <p>Paste your website or a competitor website to start tracking visible changes.</p>
                <Link className="f9-primary-button" to="/search">
                  Add competitor
                </Link>
              </div>
            ) : null}
          </div>
        </article>

        <article className="f9-app-panel">
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
                      ? ` · next scan ${formatNextScanLabel(data.plan, new Date(), data.effectiveDeliveryConfig.timezone)}`
                      : null}
                    {` · ${formatWatchlistTrackingRole(data.selectedWatchlist.trackingRole)}`}
                  </p>
                </div>
                <div className="f9-action-row">
                  <Link
                    className="f9-secondary-button"
                    to={`/app/reports/${createReportId("watchlist", data.selectedWatchlist.id)}`}
                  >
                    Open report
                  </Link>
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
                  <Form method="post">
                    <input name="intent" type="hidden" value="share-watchlist" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <SubmitButton className="f9-secondary-button" intent="share-watchlist" pendingLabel="Sharing…">
                      Share summary
                    </SubmitButton>
                  </Form>
                  <Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value={data.selectedWatchlist.isActive ? "pause-watchlist" : "resume-watchlist"}
                    />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <SubmitButton
                      className="f9-secondary-button"
                      intent={data.selectedWatchlist.isActive ? "pause-watchlist" : "resume-watchlist"}
                      pendingLabel={data.selectedWatchlist.isActive ? "Pausing…" : "Resuming…"}
                    >
                      {data.selectedWatchlist.isActive ? "Pause tracking" : "Resume tracking"}
                    </SubmitButton>
                  </Form>
                  {data.selectedWatchlist.isActive ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="refresh-watchlist" />
                      <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                      <SubmitButton className="f9-primary-button" intent="refresh-watchlist" pendingLabel="Scanning live…">
                        Refresh now
                      </SubmitButton>
                    </Form>
                  ) : null}
                </div>
              </div>

              {data.selectedWatchlist.isActive && !data.selectedWatchlist.lastScannedAt ? (
                <FirstScanBanner watchlistId={data.selectedWatchlist.id} />
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
                <section>
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

                <section>
                  <p className="f9-app-kicker">Tracking status</p>
                  <div className="f9-dashboard-grid">
                    <article className="f9-app-panel">
                      <h3>{formatDiscoveryHeadline(data.discoveryStatus)}</h3>
                      <p className="f9-muted-copy">
                        {formatTrackingStatusSummary(data.discoveryStatus.summary)}
                      </p>
                      {data.discoveryStatus.lastErrorCode ? (
                        <p className="f9-muted-copy">
                          What happened: {formatDiscoveryIssue(data.discoveryStatus.lastErrorCode)}
                        </p>
                      ) : null}

                      <div className="f9-work-list is-compact" style={{ marginTop: "0.75rem" }}>
                        <div className="f9-work-row">
                          <p className="f9-app-kicker">How ads are checked</p>
                          <p className="f9-muted-copy">
                            {formatDiscoveryProviderLabel(
                              data.discoveryStatus.provider,
                              data.discoveryStatus.mode,
                            )}
                          </p>
                        </div>
                        <div className="f9-work-row">
                          <p className="f9-app-kicker">Status</p>
                          <p className="f9-muted-copy">
                            {formatDiscoveryStatusLabel(data.discoveryStatus.status)}
                          </p>
                        </div>
                        <div className="f9-work-row">
                          <p className="f9-app-kicker">Last check</p>
                          <p className="f9-muted-copy">
                            {data.discoveryStatus.lastCheckedAt ? (
                              <LocalTime iso={data.discoveryStatus.lastCheckedAt} />
                            ) : (
                              "No recent check yet"
                            )}
                          </p>
                        </div>
                      </div>
                      <Link className="f9-secondary-button" to="/app/source-access">
                        Review tracking access
                      </Link>
                    </article>
                    {data.showPresenceNav ? (
                      <article className="f9-app-panel">
                        <h3>Website presence</h3>
                        <p className="f9-muted-copy">
                          Track public website, blog, and feed changes for this competitor in Presence — separate from ad
                          watchlists.
                        </p>
                        <Link className="f9-secondary-button" to="/app/presence">
                          Open Presence
                        </Link>
                      </article>
                    ) : null}
                  </div>
                </section>

                <section>
                  <p className="f9-app-kicker">See what changed</p>
                  {data.events.length === 0 ? (
                    <p className="f9-muted-copy">
                      {data.selectedWatchlist.lastScannedAt
                        ? `No confirmed changes yet — we'll flag the next one. Next scheduled scan: ${formatNextScanLabel(data.plan, new Date(), data.effectiveDeliveryConfig.timezone)}.`
                        : "Your first scan is running now. Results appear here in a couple of minutes — refresh to check."}
                    </p>
                  ) : (
                    <ul className="event-list">
                      {data.events.map((event) => {
                        const proofCapture = event.proofCaptureId
                          ? proofCapturesById.get(event.proofCaptureId) ?? null
                          : null;
                        const lastAttempt = lastAttemptByEventId.get(event.id) ?? null;

                        return (
                          <li className="f9-event-card" key={event.id}>
                            <div className="f9-panel-toolbar">
                              <div>
                                <p className="f9-app-kicker">
                                  {humanizeEventType(event.eventType)} · {event.status.replaceAll("_", " ")}
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
                                    ? `${formatConfidenceBandLabel(proofCapture.fieldConfidence)} · evidence age ${formatProofAgeLabel(
                                        proofCapture.succeededAt ?? proofCapture.attemptedAt,
                                      )}`
                                    : "No separate landing-page evidence check was needed for this event."}
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

                  <div className="f9-dashboard-grid">
                    <article className="f9-app-panel">
                      <p className="f9-app-kicker">Recent evidence checks</p>
                      <h3>Evidence freshness</h3>
                      <p className="f9-muted-copy">
                        {data.proofSummary.successfulAttempts} successful · {data.proofSummary.failedAttempts} failed
                        {data.proofSummary.skippedAttempts > 0
                          ? ` · ${data.proofSummary.skippedAttempts} skipped`
                          : ""}
                      </p>
                      <p className="f9-muted-copy">
                        {data.proofSummary.lastSuccessfulProofAt
                          ? `Last good evidence check ${formatProofAgeLabel(data.proofSummary.lastSuccessfulProofAt)}`
                          : "No successful evidence check yet."}
                      </p>
                      <div className="f9-work-list is-compact">
                        {data.recentProofCaptures.slice(0, 4).map((capture) => (
                          <div className="f9-work-row" key={capture.id}>
                            <div>
                              <h4 style={{ marginBottom: "0.25rem" }}>
                                {capture.status.replaceAll("_", " ")}
                              </h4>
                              <p className="f9-muted-copy">
                                {formatConfidenceBandLabel(capture.fieldConfidence)} ·{" "}
                                {formatProofAgeLabel(capture.succeededAt ?? capture.attemptedAt)}
                              </p>
                            </div>
                          </div>
                        ))}
                        {data.recentProofCaptures.length === 0 ? (
                          <p className="f9-muted-copy">Evidence checks will appear here after the next proof-backed check.</p>
                        ) : null}
                      </div>
                    </article>

                    <article className="f9-app-panel">
                      <p className="f9-app-kicker">Delivery settings</p>
                      <h3>Channel policy</h3>
                      {!data.watchlistDeliveryConfig ? (
                        <p className="f9-muted-copy">
                          Using the default alert settings for this account.
                        </p>
                      ) : null}
                      <Form method="post" className="f9-work-list is-compact">
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
                            name="timezone"
                            type="text"
                          />
                        </label>
                        <div className="f9-dashboard-grid">
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
                        <label className="f9-field f9-field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.instantEnabled} name="instantEnabled" type="checkbox" />
                          <span>High-priority alerts (sent as soon as a scan confirms a major change)</span>
                        </label>
                        <label className="f9-field f9-field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.digestEnabled} name="digestEnabled" type="checkbox" />
                          <span>Digest alerts</span>
                        </label>
                        <label className="f9-field f9-field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.emailEnabled} name="emailEnabled" type="checkbox" />
                          <span>Email enabled</span>
                        </label>
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
                      </Form>
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
                  <div className="f9-work-list is-compact">
                    {data.deliveryTargets.map((target) => (
                      <div className="f9-work-row" key={target.id}>
                        <div>
                          <h4 style={{ marginBottom: "0.25rem" }}>
                            {target.channel === "email" ? "Email" : "WhatsApp"}
                          </h4>
                          <p className="f9-muted-copy">{target.targetValue}</p>
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
                          {target.channel === "email" ? (
                            <Form method="post">
                              <input name="intent" type="hidden" value="send-test-email" />
                              <input name="targetId" type="hidden" value={target.id} />
                              <SubmitButton
                                className="f9-secondary-button"
                                intent="send-test-email"
                                match={{ targetId: target.id }}
                                pendingLabel="Sending…"
                              >
                                Send test
                              </SubmitButton>
                            </Form>
                          ) : null}
                          <Form method="post">
                            <input name="intent" type="hidden" value="toggle-delivery-target" />
                            <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                            <input name="channel" type="hidden" value={target.channel} />
                            <input name="targetValue" type="hidden" value={target.targetValue} />
                            <input name="isPaused" type="hidden" value={target.isPaused ? "false" : "true"} />
                            <SubmitButton
                              className="f9-secondary-button"
                              intent="toggle-delivery-target"
                              match={{ targetValue: target.targetValue }}
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
                  </div>

                  <Form method="post" className="f9-work-list is-compact" style={{ marginTop: "1rem" }}>
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
                  </Form>

                  {data.workspaceDeliveryTargets.length > 0 ? (
                    <div style={{ marginTop: "1rem" }}>
                      <p className="f9-app-kicker">Default delivery</p>
                      <p className="f9-muted-copy">
                        {data.workspaceDeliveryTargets.map((target) => target.targetValue).join(" · ")}
                      </p>
                    </div>
                  ) : null}
                </section>

                <section>
                  <p className="f9-app-kicker">Recent checks</p>
                  {data.runs.length === 0 ? (
                    <p className="f9-muted-copy">No checks recorded yet.</p>
                  ) : (
                    <ul className="event-list">
                      {data.runs.map((run) => (
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
                            {run.finishedAt ? (
                              <>
                                Finished <LocalTime iso={run.finishedAt} />
                              </>
                            ) : (
                              "Still running"
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
                      ))}
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
                              {candidate.status.replaceAll("_", " ")} · {formatImportanceBandLabel(candidate.importanceScore)}
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
            <div className="f9-empty-panel">
              <h2>Add your first competitor</h2>
              <p>Paste your website or a competitor website to start tracking offer, CTA, headline, and form changes.</p>
              <Link className="f9-primary-button" to="/search">
                Add competitor
              </Link>
            </div>
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
    instantEnabled: false,
    digestEnabled: true,
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

function buildLastAttemptByEventId(attempts: DeliveryAttemptRecord[]) {
  return attempts.reduce((map, attempt) => {
    for (const eventId of attempt.eventIds) {
      if (!map.has(eventId)) {
        map.set(eventId, attempt);
      }
    }
    return map;
  }, new Map<string, DeliveryAttemptRecord>());
}

function humanizeEventType(eventType: string) {
  return eventType.replaceAll("_", " ");
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
    .map(([eventType, count]) => `${count} ${eventType.replaceAll("_", " ")}`);

  return parts.join(" · ");
}

function formatDiscoveryHeadline(status: MetaIntegrationStatus) {
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
  return "Tracking path needs attention";
}

function formatDiscoveryProviderLabel(
  provider?: MetaIntegrationStatus["provider"],
  mode?: MetaIntegrationStatus["mode"],
) {
  if (provider === "meta_library_browser") {
    return mode === "cache" ? "Recent results" : "Live ad check";
  }
  if (provider === "meta_api") {
    return mode === "diagnostic" ? "Backup Meta check" : "Your Meta backup";
  }
  if (provider === "demo") {
    return "Sample data";
  }
  return "Not configured";
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

function formatDiscoveryIssue(issue: string) {
  const labels: Record<string, string> = {
    browser_unavailable: "The visual ad check is temporarily unavailable.",
    browser_launch_failed: "The visual ad check could not start.",
    timeout: "The ad check took too long.",
    login_wall: "Meta asked for login before showing ads.",
    rate_limited: "Meta is rate limiting checks right now.",
    selector_drift: "The ad page layout changed.",
    empty_result: "No ad cards were found for this check.",
  };

  return labels[issue] ?? issue.replaceAll("_", " ");
}

function formatNumericSummaryPart(
  summary: Record<string, unknown>,
  key: keyof WatchlistRunSummaryCounts | "adsSeen" | "events",
  label: string,
) {
  const value = summary[key];
  return typeof value === "number" ? `${value} ${label}` : null;
}

const FIRST_SCAN_POLL_LIMIT = 30;

// The first scan runs in a background waitUntil right after creation; without
// this the page just says "never scanned" and the customer's first minutes
// look broken. Polls until lastScannedAt flips (loader revalidation), capped.
function FirstScanBanner(props: { watchlistId: string }) {
  const revalidator = useRevalidator();
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    setPollCount(0);
  }, [props.watchlistId]);

  useEffect(() => {
    if (pollCount >= FIRST_SCAN_POLL_LIMIT) {
      return;
    }

    const timer = setTimeout(() => {
      setPollCount((count) => count + 1);
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [pollCount, revalidator]);

  return (
    <article className="f9-checkout-banner is-pending" aria-live="polite">
      <div>
        <span className="f9-app-kicker">First scan</span>
        <h2>
          <span className="f9-checkout-pulse" aria-hidden="true" />
          Scanning this competitor now…
        </h2>
        <p>
          {pollCount >= FIRST_SCAN_POLL_LIMIT
            ? "The first scan is taking longer than usual — it's still queued, and the next scheduled scan covers it either way. Check back in a bit."
            : "First results usually land within a couple of minutes. This page updates by itself — no need to refresh."}
        </p>
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
