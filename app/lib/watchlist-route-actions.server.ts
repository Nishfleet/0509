import { data, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

import {
  emptyCompetitorWebsite,
  hasInvalidCompetitorWebsite,
  isHttpCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import type { AppEnv } from "~/lib/env.server";
import {
  isSlackWebhookDeliveryCustomerFacing,
  isTeamsWebhookDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
  slackDeliveryUnavailableMessage,
  whatsappDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";
import { normalizeSavedQuery } from "~/lib/normalize";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { normalizeTimeZone, safeTimeZone } from "~/lib/safe-timezone";
import { SUPPORT_EMAIL } from "~/lib/support";
import { buildLegacyWorkspaceConfig } from "~/lib/watchlist-route-loader.server";
import {
  formatWatchlistRefreshFailure,
  isDeliveryTestRequestToken,
  normalizeSensitivityMode,
} from "~/lib/watchlist-display";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";

/**
 * `/app/watchlists` action (BL-007 extraction).
 *
 * Moved out of the route verbatim when the tabbed competitor detail pushed
 * `app/routes/app.watchlists.tsx` past the 800-line ceiling. Every intent,
 * message and gate is byte-identical to what shipped before; the route
 * re-exports this as `action`, so the action tests still drive it through
 * `~/routes/app.watchlists`.
 */

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

export async function handleWatchlistsAction(args: ActionFunctionArgs) {
  const { context, request } = args;
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "preview-market-desk-import" || intent === "create-market-desk-import") {
    const { handleSetupChecklistAction } = await import("~/lib/setup-checklist-action.server");
    return handleSetupChecklistAction(args, formData);
  }

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
    const slackDeliveryEditable = isSlackWebhookDeliveryCustomerFacing();
    const teamsDeliveryEditable = isTeamsWebhookDeliveryCustomerFacing();
    const deliveryGate = await requireDeliveryConfigSave(env, workspaceUserId, {
      instantEnabled: formData.has("instantEnabled"),
      slackEnabled: slackDeliveryEditable && formData.has("slackEnabled"),
      teamsEnabled: teamsDeliveryEditable && formData.has("teamsEnabled"),
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
    if (!teamsDeliveryEditable && formData.has("teamsEnabled")) {
      return { ok: false, message: "Teams delivery isn’t available. Nothing was saved — use email delivery instead." };
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
      teamsEnabled: teamsDeliveryEditable ? formData.has("teamsEnabled") : baseConfig.teamsEnabled,
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
    if (requestedChannel === "slack" || requestedChannel === "teams") {
      // Webhooks connect at workspace scope on the Notifications page (that
      // flow stores the encrypted webhook and sends the setup test). This
      // watchlist-scoped path was email-only before GA and stays honest:
      // accepting a bare slack/teams value here would create a target that
      // can never deliver.
      return {
        ok: false,
        message:
          "Connect Slack or Teams delivery from the Notifications page — watchlist-scoped webhook targets aren't supported.",
      };
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
    if (requestedChannel === "slack" || requestedChannel === "teams") {
      // See add-delivery-target: watchlist-scoped webhook targets never
      // existed — a stray pause/resume of one gets the honest answer.
      return {
        ok: false,
        message:
          "Manage Slack or Teams delivery from the Notifications page — watchlist-scoped webhook targets aren't supported.",
      };
    }

    const channel = target.channel;
    const targetValue = target.targetValue;
    const isPaused = !target.isPaused;
    if (channel === "whatsapp" && !isWhatsAppDeliveryCustomerFacing()) {
      return { ok: false, message: whatsappDeliveryUnavailableMessage() };
    }
    const isResumingSuppressedEmail =
      channel === "email" &&
      !isPaused &&
      !target.isOptedIn &&
      target.optedOutAt !== null;
    if (isResumingSuppressedEmail) {
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

  if (intent === "accept-suggested-competitor") {
    return handleAcceptSuggestedCompetitorAction(env, workspaceUserId, formData);
  }

  if (intent === "bulk-accept-suggested-competitors") {
    return handleBulkAcceptSuggestedCompetitorsAction(env, workspaceUserId, formData);
  }

  return {
    ok: false,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

// Auto-competitor-watch Phase 2 (#1370): the one-click accept action. A
// "suggested / unverified" candidate is promoted to a real watchlist
// through the existing createWatchlistWithinLimit path, with the plan
// limit re-checked at accept time (the customer may have accepted since
// the panel rendered). Over-cap returns a named reason — never silent
// admission, never a fabricated success. Unknown / stale candidate ids
// are rejected too; the candidate set comes from a loader call, so a
// stale id means the panel has been re-rendered after a sweep.
async function handleAcceptSuggestedCompetitorAction(
  env: AppEnv,
  workspaceUserId: string,
  formData: FormData,
): Promise<{
  ok: boolean;
  error?: "plan_limit_exceeded" | "candidate_unknown";
  message: string;
  acceptedCandidateId?: string;
  acceptedAdvertiser?: string;
  watchlistId?: string;
}> {
  const { loadSuggestedCompetitorsPanel } = await import(
    "~/lib/auto-competitor-suggested-loader.server"
  );
  const { createWatchlistWithinLimit } = await import("~/lib/data.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");

  const candidateId = String(formData.get("candidateId") ?? "").trim();
  if (!candidateId) {
    return {
      ok: false,
      error: "candidate_unknown",
      message: "That suggestion is no longer available. Refresh and try again.",
    };
  }

  const plan = await getUserPlan(env, workspaceUserId);
  if (plan === "free") {
    return {
      ok: false,
      error: "plan_limit_exceeded",
      message:
        "Auto-discovered competitors are a paid feature — upgrade to add this suggestion.",
    };
  }

  // Re-validate the candidate against the LIVE seed output. A stale id
  // (panel rendered with seed A, sweep produced seed B, candidate gone)
  // must not silently create a watchlist the customer never approved.
  const panel = await loadSuggestedCompetitorsPanel(env, workspaceUserId, plan);
  const row = panel
    ? panel.rows.find((entry) => entry.candidateId === candidateId) ?? null
    : null;
  if (!row) {
    return {
      ok: false,
      error: "candidate_unknown",
      message:
        "That suggestion isn't in our latest sweep anymore. Refresh and pick another.",
    };
  }
  // Honesty-eval 3.4 guardrail at the action layer too: a candidate row
  // typed anything other than "candidate" must never create a watchlist.
  if (row.type !== "candidate") {
    return {
      ok: false,
      error: "candidate_unknown",
      message:
        "That suggestion can't be added as a competitor — only unverified candidates can.",
    };
  }

  const limit = await checkPlanLimit(env, workspaceUserId, "watchlists");
  if (!limit.allowed) {
    return {
      ok: false,
      error: "plan_limit_exceeded",
      message:
        "You've reached your competitor tracking limit — pause another watchlist before adding this one.",
    };
  }

  const targetLabel = row.advertiser.trim() || row.candidateId;
  const targetId = row.landingPageUrl?.trim() || row.candidateId;
  // Reuse the existing fingerprint helper so the accept path's dedup
  // semantics match every other createWatchlist call site.
  const { fingerprintSavedQuery, normalizeSearchFilters } = await import("~/lib/normalize");
  const normalizedFilters = normalizeSearchFilters({
    query: row.advertiser,
    country: row.targetCountry ?? "all",
  });
  const targetFingerprint = fingerprintSavedQuery({
    mode: "advertiser",
    filters: normalizedFilters,
  });

  const result = await createWatchlistWithinLimit(
    env,
    workspaceUserId,
    {
      name: targetLabel,
      targetType: "advertiser",
      targetId,
      targetFingerprint,
      targetLabel,
      targetCountry: row.targetCountry ?? null,
      trackingRole: "competitor",
    },
    limit.limit,
  );

  if (result.status === "over_cap") {
    return {
      ok: false,
      error: "plan_limit_exceeded",
      message:
        "You've reached your competitor tracking limit — pause another watchlist before adding this one.",
    };
  }

  return {
    ok: true,
    message:
      result.status === "existing"
        ? `${row.advertiser} is already on your watchlist.`
        : `Now watching ${row.advertiser}.`,
    acceptedCandidateId: row.candidateId,
    acceptedAdvertiser: row.advertiser,
    watchlistId: result.watchlist.id,
  };
}

// Auto-competitor-watch Phase 4 (#1372): the bulk-accept action. A filtered
// subset of suggested candidates is promoted to real watchlists in one
// plan-capped action via the existing competitor-import bulk path
// (`buildCompetitorImportPreview` → `createWatchlistWithinLimit`), so a
// many-advertiser vertical does not hand-add each long-tail candidate through
// the one-click Phase 2 accept. The shaping + cap enforcement + create loop
// lives in `auto-competitor-bulk-accept.server.ts`; this handler does the
// I/O (paid-tier gate, live panel re-validation, plan limit, existing
// fingerprints) and delegates. Over-cap candidates are returned with a named
// reason — never silently dropped, never silently admitted (eval 3.5).
async function handleBulkAcceptSuggestedCompetitorsAction(
  env: AppEnv,
  workspaceUserId: string,
  formData: FormData,
): Promise<{
  ok: boolean;
  error?: "plan_limit_exceeded" | "candidate_unknown";
  message: string;
  admittedCount?: number;
  existingCount?: number;
  overCapCount?: number;
  overCapRows?: Array<{ candidateId: string; advertiser: string; reason: string }>;
  createdWatchlistIds?: string[];
}> {
  const { loadSuggestedCompetitorsPanel } = await import(
    "~/lib/auto-competitor-suggested-loader.server"
  );
  const { getUserPlan } = await import("~/lib/plan.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { listWatchlists } = await import("~/lib/data.server");
  const { bulkAcceptSuggestedCompetitors } = await import(
    "~/lib/auto-competitor-bulk-accept.server"
  );

  const candidateIds = [...new Set(formData.getAll("candidateIds").map(String))].filter(Boolean);

  const plan = await getUserPlan(env, workspaceUserId);
  if (plan === "free") {
    return {
      ok: false,
      error: "plan_limit_exceeded",
      message:
        "Auto-discovered competitors are a paid feature — upgrade to add these suggestions.",
    };
  }

  // Zero selected candidates is a no-op, not an error (issue requirement).
  if (candidateIds.length === 0) {
    return {
      ok: true,
      message: "No competitors selected — nothing to add.",
      admittedCount: 0,
      existingCount: 0,
      overCapCount: 0,
      overCapRows: [],
      createdWatchlistIds: [],
    };
  }

  // Re-validate candidates against the LIVE panel — same honesty guard as
  // the one-click accept: a stale id must never silently create a watchlist.
  // Unknown ids are dropped; if every requested id is stale, the action
  // returns candidate_unknown rather than creating nothing silently.
  const panel = await loadSuggestedCompetitorsPanel(env, workspaceUserId, plan);
  const rowsById = new Map((panel?.rows ?? []).map((row) => [row.candidateId, row]));
  const candidates = candidateIds
    .map((id) => rowsById.get(id) ?? null)
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map((row) => ({
      candidateId: row.candidateId,
      advertiser: row.advertiser,
      landingPageUrl: row.landingPageUrl,
      targetCountry: row.targetCountry,
    }));

  if (candidates.length === 0) {
    return {
      ok: false,
      error: "candidate_unknown",
      message:
        "Those suggestions are no longer available. Refresh and try again.",
    };
  }

  const limit = await checkPlanLimit(env, workspaceUserId, "watchlists");

  // Pass the existing active watchlist fingerprints so the importer can mark
  // already-watched candidates `existing` at the preview layer. The
  // createWatchlistWithinLimit INSERT OR IGNORE backstop still catches a
  // candidate accepted between panel render and bulk accept.
  const watchlists = await listWatchlists(env, workspaceUserId, { includeInactive: true });
  const existingFingerprints = watchlists
    .filter((watchlist) => watchlist.isActive)
    .map((watchlist) => watchlist.targetFingerprint);

  return bulkAcceptSuggestedCompetitors({
    env,
    workspaceUserId,
    candidates,
    planLimit: limit.limit,
    currentCount: limit.current,
    existingFingerprints,
  });
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
  if (value === "email" || value === "whatsapp" || value === "slack" || value === "teams") {
    return value;
  }

  return null;
}
