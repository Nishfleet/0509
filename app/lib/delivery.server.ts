import {
  alertMaterialityReason,
  buildChangeIntelligenceSummary,
  type DigestCadence,
  digestCadenceLabel,
  digestReviewerLabel,
} from "~/lib/change-intelligence";
import {
  type buildDigestEmail,
  buildScanTroubleEmail,
  renderEmailAccountabilityBlock,
} from "~/lib/digest-email.server";
import {
  renderDigestEmail,
  renderDigestSlackText,
  renderDigestTeamsText,
} from "~/lib/digest-render.server";
import {
  buildChangeLeadSubject,
  changeBriefCriticalityLine,
  changeBriefMeaningLine,
  changeBriefNoScreenshotReason,
  readChangeBriefCriticality,
} from "~/lib/change-brief.server";
import {
  canUsePlanFeature,
  getPlanEntitlements,
  type ScheduledScanCadence,
} from "~/lib/plan-entitlements";
import {
  createDeliveryAttempt,
  getDeliveryAttemptByIdempotencyKey,
  getOldestUserId,
  getUserDeliveryProfile,
  getUserIdByEmail,
  getWatchlistDeliveryConfig,
  getWorkspaceDeliveryConfig,
  legacyWorkspaceDeliveryDefaults,
  listAdsByIds,
  listDeliveryTargets,
  provisionVerifiedAccountEmailTargetIfUnsuppressed,
  reconcileDeliveryAttemptByProviderMessageId,
  updateDeliveryAttemptResult,
  upsertDeliveryTarget,
  upsertDigestDelivery,
} from "~/lib/data.server";
import * as deliveryData from "~/lib/data.server";
import {
  claimInstantDeliveryAttempt,
  markInstantDeliveryDispatchStarted,
} from "~/lib/data/delivery-records-attempts.server";
import {
  DIGEST_PROVIDER_CLAIM_PROTOCOL,
  hasTrustedDigestProviderRetryEvidence,
  hasTrustedInstantProviderRetryEvidence,
  INSTANT_PROVIDER_CLAIM_PROTOCOL,
  isStalePreDispatchAttempt,
  markDeliveryAttemptProviderDispatch,
} from "~/lib/delivery-attempt-lease";
import {
  EMAIL_PROVIDER,
  type EmailProviderResult,
  appBaseUrl,
  escapeHtml,
  escapeSlackText,
  providerAcceptedAt,
  readString,
  sendCloudflareEmail,
  stripHtml,
} from "~/lib/delivery-email-core.server";
import { evaluateDeliveryPolicy, resolveDeliveryConfig } from "~/lib/delivery-policy.server";
import { isEmailSendingConfigured, type AppEnv } from "~/lib/env.server";
import {
  resolveCustomerEvidenceState,
  type CustomerEvidenceState,
} from "~/lib/evidence-render-contract";
import {
  isSlackWebhookDeliveryCustomerFacing,
  isTeamsWebhookDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import {
  EMAIL_CASE_BONE,
  EMAIL_CASE_BUTTON_STYLE,
  EMAIL_CASE_CARD,
  EMAIL_CASE_CARD_STYLE,
  EMAIL_CASE_EYEBROW_STYLE,
  EMAIL_CASE_GREEN_INK,
  EMAIL_CASE_H1_STYLE,
  EMAIL_CASE_INK,
  EMAIL_CASE_INK_FAINT,
  EMAIL_CASE_INK_SOFT,
  EMAIL_CASE_LINE,
  EMAIL_CASE_META_STYLE,
  EMAIL_DISPLAY_FONT,
  EMAIL_MONO_FONT,
} from "~/lib/email-template.server";
import { queryAll, queryOne } from "~/lib/data/d1.server";
import { proofScreenshotAbsoluteUrl } from "~/lib/proof-screenshot.server";
import { buildUnsubscribeUrl } from "~/lib/unsubscribe.server";
import type {
  AdRecord,
  AppSession,
  DeliveryChannel,
  DeliveryAttemptRecord,
  DeliveryTargetRecord,
  ShareResourceType,
  WatchEventRecord,
  WatchlistRecord,
  WatchlistDeliveryConfigRecord,
  WorkspaceDeliveryConfigRecord,
  DeliveryLane,
} from "~/lib/types";
import {
  prepareDigestWhatsAppTarget,
  sendDigestWhatsApp,
  sendInstantWhatsApp,
} from "~/lib/whatsapp.server";
import {
  prepareSlackWebhookTarget,
  sendSlackWebhookUrl,
  SLACK_PROVIDER,
} from "~/lib/slack-webhook.server";
import {
  prepareTeamsWebhookTarget,
  sendTeamsWebhookUrl,
  TEAMS_PROVIDER,
} from "~/lib/teams-webhook.server";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import { loadPriceTierSwing, type PriceTierSwing } from "~/lib/landing-page-price-tier.server";
import {
  loadWeeklyPublicMoves,
  WEEKLY_MOVES_WINDOW_MS,
  type WeeklyPublicMove,
} from "~/lib/weekly-public-moves.server";

// Facade re-exports: product code and tests import every delivery sender
// from this module; the billing lifecycle domain lives in its own file.
export {
  BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS,
  BillingLifecycleEmailExplicitFailure,
  isBillingLifecycleEmailExplicitFailure,
  prepareBillingLifecycleEmailOutbox,
  reconcileBillingLifecycleEmailDelivery,
  recoverAbandonedBillingLifecycleEmails,
  sendBillingCancellationEmail,
  sendBillingPaymentIssueEmail,
  sendBillingRefundEmail,
  type BillingLifecycleEmailOutboxInput,
} from "~/lib/delivery-billing-lifecycle.server";
export {
  sendAccountActionEmail,
  sendDeliveryTestEmail,
  sendEmailVerificationEmail,
  sendFreeActivationResultEmail,
  readOperatorAlertEmailOutcome,
  sendOperatorAlertEmail,
  sendOperatorAlertEmailDetailed,
  sendPasswordResetEmail,
  sendTeamInviteEmail,
  sendWelcomeEmail,
  type OperatorAlertEmailOutcome,
} from "~/lib/delivery-account-emails.server";

const AUTO_PROVISIONED_EMAIL_SOURCE = "account_email";

interface DigestAttemptSummary {
  channel: DeliveryChannel;
  status: "sent" | "failed" | "pending";
  targetValue: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
  subject?: string | null;
  providerDispatchStartedAt?: string | null;
  // True only when THIS execution won the delivery-attempt claim and owns
  // the outcome; mirrors of another writer's in-flight attempt leave it
  // unset. Gates the failed→pending aggregate overwrite in
  // upsertDigestDelivery.
  claimedByThisRun?: boolean;
  deferredByQuietHours?: boolean;
}

type InstantDeliveryOutcome =
  | "provider_accepted"
  | "definitive_terminal_failure"
  | "pending_provider_unknown"
  | "quiet_deferral"
  | "intentional_dedupe";

interface InstantAttemptSummary extends DigestAttemptSummary {
  outcome: InstantDeliveryOutcome;
  claimedByThisRun: boolean;
  providerAttemptedByThisRun: boolean;
  duplicate: boolean;
  source: "current_claim" | "durable_attempt";
}

export interface DigestDeliveryItem {
  eventId: string;
  watchlistId: string;
  watchlistName: string;
  eventType: string;
  title: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface DigestHeartbeat {
  runs: number;
  watchlistsChecked: number;
  adsSeen: number;
}

export interface DeliverWeeklyDigestInput {
  userId: string;
  userName: string;
  accountEmail: string | null;
  digestRunId: string;
  periodStart: string;
  periodEnd: string;
  totalEligibleEvents?: number;
  includedEvents?: number;
  omittedEvents?: number;
  items: DigestDeliveryItem[];
  // Present when the period had zero changes but successful scans: the
  // digest becomes an "all quiet" heartbeat (email only).
  heartbeat?: DigestHeartbeat | null;
  // Optional AI weekly strategy paragraph persisted on the digest run.
  // Null/absent renders nothing — never an apology string.
  strategyParagraph?: string | null;
  cadence?: DigestCadence;
  lane?: DeliveryLane;
  proofEmailSubject?: string;
  // Brief-as-retention-loop (lane 1, 2026-08-14): the prior digest's
  // item count when a previous brief exists on file. Drives the weekly
  // email's "since last brief" delta line.
  previousBriefItemCount?: number | null;
  hasPreviousBrief?: boolean | null;
  nextScanAt?: string | null;
  nextScanLabel?: string | null;
  // BET 7: the activation-scan brief uses the digest delivery path with
  // this flag so the subject reads "Your first brief" instead of the weekly
  // change-count line. Weekly cron leaves it unset.
  firstBrief?: boolean;
}

export interface DeliverWatchlistAlertsInput {
  userId: string;
  /** Workspace owner identity for the alert's accountable reviewer; null
   * renders the truthful "Workspace owner" fallback — never the watchlist
   * or competitor name. */
  userName: string | null;
  accountEmail: string | null;
  watchlist: Pick<WatchlistRecord, "id" | "userId" | "name">;
  events: WatchEventRecord[];
  lane?: DeliveryLane;
}

export async function deliverWeeklyDigest(env: AppEnv, input: DeliverWeeklyDigestInput) {
  const lane = input.lane ?? "customer";
  if (input.proofEmailSubject !== undefined &&
      (lane !== "internal" || !isGateCProofEmailSubject(input.proofEmailSubject))) {
    throw new Error("Gate C proof email subject is invalid.");
  }
  // Soft product gate: unverified customers don't get digests. Never block
  // operator/internal lanes or sendOperatorAlertEmail.
  if (lane === "customer") {
    const { isUserEmailVerified } = await import("~/lib/email-verification.server");
    if (!(await isUserEmailVerified(env, input.userId))) {
      return {
        attempts: 0,
        channels: [] as DeliveryChannel[],
        details: [] as DigestAttemptSummary[],
      };
    }
  }

  const accountEmail = lane === "customer"
    ? await resolveVerifiedAccountEmail(env, input.userId, input.accountEmail)
    : input.accountEmail;
  if (lane === "customer" && !accountEmail) {
    return {
      attempts: 0,
      channels: [] as DeliveryChannel[],
      details: [] as DigestAttemptSummary[],
    };
  }

  const workspaceConfigRecord =
    (await getWorkspaceDeliveryConfig(env, input.userId)) ??
    buildLegacyWorkspaceConfig(input.userId, Boolean(input.accountEmail));
  const entitledConfigs = await resolveEntitledDeliveryConfigs(
    env,
    input.userId,
    workspaceConfigRecord,
    null,
  );
  const config = resolveDeliveryConfig({
    workspaceConfig: entitledConfigs.workspaceConfig,
    watchlistConfig: null,
  });

  if (!config.digestEnabled) {
    return {
      attempts: 0,
      channels: [] as DeliveryChannel[],
      details: [] as DigestAttemptSummary[],
    };
  }
  const isHeartbeat = input.items.length === 0 && Boolean(input.heartbeat);
  const emailTargets = config.emailEnabled
    ? await resolveDigestEmailTargets(env, input.userId, accountEmail, {
        requireUniqueExistingTarget: input.proofEmailSubject !== undefined,
      })
    : [];
  if (input.proofEmailSubject !== undefined && emailTargets.length !== 1) {
    throw new Error("Gate C proof email target must resolve uniquely.");
  }
  // "All quiet" heartbeats stay email-only: a WhatsApp template or Slack/Teams
  // ping saying nothing happened reads as noise on those channels.
  const whatsappTargets = !isHeartbeat && config.whatsappEnabled && isWhatsAppDeliveryCustomerFacing()
    ? await resolveDigestWhatsAppTargets(env, input.userId)
    : [];
  const slackTargets = !isHeartbeat && config.slackEnabled && isSlackWebhookDeliveryCustomerFacing()
    ? await resolveDigestSlackTargets(env, input.userId)
    : [];
  const teamsTargets = !isHeartbeat && config.teamsEnabled && isTeamsWebhookDeliveryCustomerFacing()
    ? await resolveDigestTeamsTargets(env, input.userId)
    : [];

  const attempts: DigestAttemptSummary[] = [];

  const digestTimeZone = config.timezone ?? null;

  // Free weekly watch: the digest is the whole product demo, so it stays the
  // full template with exactly one tasteful upgrade line in the footer area.
  const upgradeNote =
    lane === "customer" && entitledConfigs.plan === "free"
      ? (await import("~/lib/pricing")).freeWeeklyDigestUpgradeNote()
      : null;

  // Issue #2175 do-step 3: the brief's one-click forward link — a live share
  // view of this digest via the existing share-link machinery. Plan-gated on
  // `share_links` (Starter+); free-plan and internal-lane briefs render no
  // forward line. Resolved once per digest run, reused across targets.
  const digestForwardUrl =
    lane === "customer" &&
    emailTargets.length > 0 &&
    canUsePlanFeature(entitledConfigs.plan, "share_links")
      ? await resolveShareForwardUrl(env, {
          userId: input.userId,
          resourceType: "digest",
          resourceId: input.digestRunId,
        })
      : null;

  for (const target of emailTargets) {
    attempts.push(
      await deliverDigestToEmailTarget(
        env,
        input,
        lane,
        target,
        digestTimeZone,
        upgradeNote,
        getPlanEntitlements(entitledConfigs.plan).scheduledScanCadence,
        { forwardUrl: digestForwardUrl },
      ),
    );
  }

  for (const target of whatsappTargets) {
    attempts.push(await deliverDigestToWhatsAppTarget(env, input, lane, target, digestTimeZone));
  }

  for (const target of slackTargets) {
    attempts.push(await deliverDigestToSlackTarget(env, input, lane, target, digestTimeZone));
  }

  for (const target of teamsTargets) {
    attempts.push(await deliverDigestToTeamsTarget(env, input, lane, target, digestTimeZone));
  }

  const digestStatusAttempt = selectDigestStatusAttempt(attempts);
  if (digestStatusAttempt) {
    await upsertDigestDelivery(env, input.digestRunId, {
      provider: digestStatusProvider(digestStatusAttempt),
      status: digestStatusAttempt.status,
      recipientEmail: digestStatusAttempt.targetValue,
      externalMessageId: digestStatusAttempt.providerMessageId,
      errorMessage: digestStatusAttempt.errorMessage,
      deliveredAt: digestStatusAttempt.deliveredAt,
      allowPendingOverwriteOfFailed: digestStatusAttempt.claimedByThisRun === true,
    });
  }

  return {
    attempts: attempts.length,
    channels: [...new Set(attempts.map((attempt) => attempt.channel))],
    details: attempts,
  };
}

/**
 * Paid-plan notice when a digest period had active watchlists but zero successful
 * scan runs — the product went silent and the customer must hear about it.
 * Idempotent per user/period via delivery_attempt key `scan_trouble:…`.
 */
export async function deliverScanTroubleNotice(
  env: AppEnv,
  input: {
    userId: string;
    accountEmail: string | null | undefined;
    watchlistNames: string[];
    periodKey: string;
  },
) {
  const { isUserEmailVerified } = await import("~/lib/email-verification.server");
  if (!(await isUserEmailVerified(env, input.userId))) {
    return { sent: false as const, reason: "unverified" as const };
  }

  const accountEmail = await resolveVerifiedAccountEmail(
    env,
    input.userId,
    input.accountEmail ?? null,
  );
  if (!accountEmail) {
    return { sent: false as const, reason: "no_email" as const };
  }

  const workspaceConfigRecord =
    (await getWorkspaceDeliveryConfig(env, input.userId)) ??
    buildLegacyWorkspaceConfig(input.userId, true);
  const entitledConfigs = await resolveEntitledDeliveryConfigs(
    env,
    input.userId,
    workspaceConfigRecord,
    null,
  );
  const config = resolveDeliveryConfig({
    workspaceConfig: entitledConfigs.workspaceConfig,
    watchlistConfig: null,
  });
  if (!config.digestEnabled || !config.emailEnabled) {
    return { sent: false as const, reason: "disabled" as const };
  }

  const emailTargets = await resolveDigestEmailTargets(env, input.userId, accountEmail);
  const primaryTarget = emailTargets[0] ?? null;
  if (!primaryTarget) {
    return { sent: false as const, reason: "suppressed" as const };
  }
  const recipient = primaryTarget.targetValue.trim() || accountEmail;
  const unsubscribeUrl = await buildUnsubscribeUrl(env, {
    userId: input.userId,
    targetId: primaryTarget.id,
  });

  const idempotencyKey = `scan_trouble:${input.userId}:${input.periodKey}`;
  const base = appBaseUrl(env);
  const model = buildScanTroubleEmail({
    watchlistNames: input.watchlistNames,
    watchlistsUrl: `${base}/app/watchlists`,
    manageFrequencyUrl: `${base}/app/notifications`,
    supportEmail: SUPPORT_EMAIL,
    supportMailto: SUPPORT_MAILTO,
    unsubscribeUrl,
  });

  const claim = await claimInstantDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    deliveryTargetId: primaryTarget.id,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: "scan_trouble",
    eventIds: [],
    payloadSnapshot: {
      kind: "scan_trouble",
      periodKey: input.periodKey,
      watchlistNames: input.watchlistNames,
    },
    idempotencyKey,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    if (claim.duplicate?.status === "sent") {
      return { sent: true as const, reason: "sent" as const };
    }
    if (claim.duplicate?.webhookStatus === "provider_unknown") {
      return { sent: false as const, reason: "provider_unknown" as const };
    }
    return { sent: false as const, reason: "duplicate" as const };
  }

  const dispatchStartedAt = await markInstantDeliveryDispatchStarted(
    env,
    claim.attemptId,
    claim.claimUpdatedAt,
  );
  if (!dispatchStartedAt) {
    return { sent: false as const, reason: "claim_lost" as const };
  }

  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: model.subject,
    html: model.html,
    text: model.text,
    tag: "scan-trouble",
    unsubscribeUrl,
    theme: "case-file",
  });

  const finalized = await updateDeliveryAttemptResult(env, claim.attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    payloadSnapshot: {
      kind: "scan_trouble",
      periodKey: input.periodKey,
      watchlistNames: input.watchlistNames,
    },
    targetValue: recipient,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
  });

  if (
    !finalized ||
    (providerResult.status !== "sent" &&
      providerResult.webhookStatus === "provider_unknown")
  ) {
    return { sent: false as const, reason: "provider_unknown" as const };
  }

  return {
    sent: providerResult.status === "sent",
    reason: providerResult.status === "sent" ? ("sent" as const) : ("failed" as const),
  };
}

export async function deliverWatchlistAlerts(env: AppEnv, input: DeliverWatchlistAlertsInput) {
  if (input.events.length === 0) {
    return {
      attempts: 0,
      channels: [] as DeliveryChannel[],
      details: [] as InstantAttemptSummary[],
    };
  }

  const lane = input.lane ?? "customer";
  if (lane === "customer") {
    const { isUserEmailVerified } = await import("~/lib/email-verification.server");
    if (!(await isUserEmailVerified(env, input.userId))) {
      return {
        attempts: 0,
        channels: [] as DeliveryChannel[],
        details: [] as InstantAttemptSummary[],
      };
    }
  }

  const accountEmail = lane === "customer"
    ? await resolveVerifiedAccountEmail(env, input.userId, input.accountEmail)
    : input.accountEmail;
  if (lane === "customer" && !accountEmail) {
    return {
      attempts: 0,
      channels: [] as DeliveryChannel[],
      details: [] as InstantAttemptSummary[],
    };
  }

  const workspaceConfigRecord =
    (await getWorkspaceDeliveryConfig(env, input.userId)) ??
    buildLegacyWorkspaceConfig(input.userId, Boolean(input.accountEmail));
  const watchlistConfig = await getWatchlistDeliveryConfig(env, input.watchlist.id);
  const entitledConfigs = await resolveEntitledDeliveryConfigs(
    env,
    input.userId,
    workspaceConfigRecord,
    watchlistConfig,
  );
  const batches = buildInstantAlertBatches({
    lane,
    events: input.events,
    workspaceConfig: entitledConfigs.workspaceConfig,
    watchlistConfig: entitledConfigs.watchlistConfig,
  });

  if (batches.length === 0) {
    return {
      attempts: 0,
      channels: [] as DeliveryChannel[],
      details: [] as InstantAttemptSummary[],
    };
  }

  const emailTargets = batches.some((batch) => batch.allowedChannels.includes("email"))
    ? await resolveAlertEmailTargets(env, input.userId, input.watchlist.id, accountEmail)
    : [];
  const whatsappTargets = isWhatsAppDeliveryCustomerFacing() && batches.some((batch) => batch.allowedChannels.includes("whatsapp"))
    ? await resolveAlertWhatsAppTargets(env, input.userId, input.watchlist.id)
    : [];
  const slackTargets = batches.some((batch) => batch.allowedChannels.includes("slack"))
    ? await resolveAlertSlackTargets(env, input.userId, input.watchlist.id)
    : [];
  const teamsTargets = batches.some((batch) => batch.allowedChannels.includes("teams"))
    ? await resolveAlertTeamsTargets(env, input.userId, input.watchlist.id)
    : [];

  // One batched lookup so alert emails can show the primary event's captured
  // creative. Only fetched when an email will actually render it.
  const alertAdsById =
    emailTargets.length > 0
      ? await loadAlertAdsById(env, input.events)
      : new Map<string, AdRecord>();

  // P1 evidence truth (2026-08-10): instant-alert materiality may only claim a
  // verified move for events whose customer evidence state resolves to
  // `verified_change` — a confirmed status alone is a claim, not evidence.
  // One bounded batched query resolves every batch up front (never an N+1);
  // provisional batches and WhatsApp-only batches keep their existing copy,
  // so the query only runs when a materiality reason will actually render.
  const needsEvidenceResolution = batches.some(
    (batch) =>
      !batch.provisional &&
      (batch.allowedChannels.includes("email") ||
        batch.allowedChannels.includes("slack") ||
        batch.allowedChannels.includes("teams")),
  );
  const alertEvidenceByEventId = needsEvidenceResolution
    ? await loadAlertEvidenceStates(env, input.userId, input.events)
    : new Map<string, CustomerEvidenceState>();

  // Visual diff alert payload (2026-08-17): resolve the screenshot pair for
  // every alert event when email will actually render it. The pair mirrors
  // the watchlist event diff plate (both sides must have a stored screenshot
  // artifact key or the entry is skipped). Empty map when no email batch is
  // routed or the lookup helper is missing on a test adapter — the renderer
  // falls back to its existing text-only output, never half a side-by-side.
  const needsScreenshotPair = emailTargets.length > 0;
  const alertScreenshotPairsByEventId = needsScreenshotPair
    ? await loadAlertScreenshotPairs(env, input.userId, input.events)
    : new Map<string, { beforeUrl: string; afterUrl: string }>();

  const attempts: InstantAttemptSummary[] = [];

  // E2 alert increment (2026-08-08): every delivered alert names exactly one
  // accountable reviewer — the workspace owner identity when one is known,
  // else the truthful "Workspace owner" fallback. Never the watchlist name.
  const reviewerLabel = digestReviewerLabel(input.userName);

  // Issue #2175 do-step 3: the alert's one-click forward link — a live share
  // view of this watchlist via the existing share-link machinery. Plan-gated
  // on `share_links` (Starter+); free-plan and internal-lane alerts render no
  // forward line. Resolved once per watchlist run, reused across batches.
  const alertForwardUrl =
    lane === "customer" &&
    emailTargets.length > 0 &&
    canUsePlanFeature(entitledConfigs.plan, "share_links")
      ? await resolveShareForwardUrl(env, {
          userId: input.userId,
          resourceType: "watchlist",
          resourceId: input.watchlist.id,
        })
      : null;

  for (const batch of batches) {
    const content = buildInstantAlertContent(
      input.watchlist,
      batch.events,
      batch.provisional,
      env,
      alertAdsById,
      reviewerLabel,
      alertEvidenceByEventId,
      alertScreenshotPairsByEventId,
      {
        forwardUrl: alertForwardUrl,
        timeZone: entitledConfigs.workspaceConfig.timezone ?? null,
      },
    );

    if (batch.allowedChannels.includes("email")) {
      for (const target of emailTargets) {
        attempts.push(
          await deliverInstantEmailBatch(env, {
            lane,
            userId: input.userId,
            deliveryTarget: target,
            watchlistId: input.watchlist.id,
            batch,
            content,
          }),
        );
      }
    }

    if (batch.allowedChannels.includes("whatsapp")) {
      for (const target of whatsappTargets) {
        attempts.push(
          await deliverInstantWhatsAppBatch(env, {
            lane,
            userId: input.userId,
            deliveryTarget: target,
            watchlistId: input.watchlist.id,
            batch,
            content,
          }),
        );
      }
    }

    if (batch.allowedChannels.includes("slack")) {
      for (const target of slackTargets) {
        attempts.push(
          await deliverInstantSlackBatch(env, {
            lane,
            userId: input.userId,
            deliveryTarget: target,
            watchlistId: input.watchlist.id,
            batch,
            content,
          }),
        );
      }
    }

    if (batch.allowedChannels.includes("teams")) {
      for (const target of teamsTargets) {
        attempts.push(
          await deliverInstantTeamsBatch(env, {
            lane,
            userId: input.userId,
            deliveryTarget: target,
            watchlistId: input.watchlist.id,
            batch,
            content,
          }),
        );
      }
    }
  }

  return {
    attempts: attempts.length,
    channels: [...new Set(attempts.map((attempt) => attempt.channel))],
    details: attempts,
  };
}

export async function reconcileDeliveryStatus(
  env: AppEnv,
  input: {
    provider: string;
    providerMessageId: string;
    webhookStatus: "pending" | "delivered" | "failed" | "legacy_unknown" | "provider_unknown";
    status?: "pending" | "sent" | "failed" | "skipped_due_to_quiet_hours" | "skipped_due_to_dedupe" | null;
    rawProviderStatus?: string | null;
    providerStatusLastSeenAt: string;
    errorMessage?: string | null;
  },
) {
  const attempt = await reconcileDeliveryAttemptByProviderMessageId(env, input);
  if (attempt) {
    await reconcileWhatsAppSetupValidationTargetFromAttempt(env, attempt, input.rawProviderStatus ?? null);
  } else {
    await reconcileWhatsAppSetupValidationTargetFromProviderMessage(env, {
      providerMessageId: input.providerMessageId,
      rawProviderStatus: input.rawProviderStatus ?? null,
      webhookStatus: input.webhookStatus,
      status: input.status ?? null,
      providerStatusLastSeenAt: input.providerStatusLastSeenAt,
      errorMessage: input.errorMessage ?? null,
    });
  }

  return attempt;
}

const DIGEST_STATUS_CHANNEL_PRIORITY: DeliveryChannel[] = ["email", "slack", "teams", "whatsapp"];

async function reconcileWhatsAppSetupValidationTargetFromAttempt(
  env: AppEnv,
  attempt: DeliveryAttemptRecord,
  rawProviderStatus: string | null,
) {
  if (
    attempt.channel !== "whatsapp" ||
    attempt.payloadSnapshot.kind !== "whatsapp_setup_validation" ||
    !attempt.deliveryTargetId
  ) {
    return;
  }

  const normalizedRawStatus = rawProviderStatus?.toLowerCase() ?? null;
  const delivered =
    attempt.status === "sent" &&
    attempt.webhookStatus === "delivered" &&
    (normalizedRawStatus === "delivered" || normalizedRawStatus === "read");
  const failed = attempt.status === "failed" || attempt.webhookStatus === "failed";
  if (!delivered && !failed) {
    return;
  }

  const reconcile = deliveryData.reconcileWhatsAppSetupTargetFromAttempt;
  if (typeof reconcile !== "function" || !attempt.providerMessageId) return;
  await reconcile(env, {
    userId: attempt.userId,
    targetId: attempt.deliveryTargetId,
    attemptId: attempt.id,
    providerMessageId: attempt.providerMessageId,
    validationGeneration:
      readString(attempt.payloadSnapshot.validationGeneration) ?? null,
    webhookStatus: delivered ? "delivered" : "failed",
    providerStatusLastSeenAt:
      attempt.providerStatusLastSeenAt ??
      attempt.sentAt ??
      attempt.failedAt ??
      new Date().toISOString(),
    errorMessage: failed ? attempt.errorMessage : null,
  });
}

async function reconcileWhatsAppSetupValidationTargetFromProviderMessage(
  env: AppEnv,
  input: {
    providerMessageId: string;
    rawProviderStatus: string | null;
    webhookStatus: "pending" | "delivered" | "failed" | "legacy_unknown" | "provider_unknown";
    status: "pending" | "sent" | "failed" | "skipped_due_to_quiet_hours" | "skipped_due_to_dedupe" | null;
    providerStatusLastSeenAt: string;
    errorMessage: string | null;
  },
) {
  const normalizedRawStatus = input.rawProviderStatus?.toLowerCase() ?? null;
  const delivered =
    input.status === "sent" &&
    input.webhookStatus === "delivered" &&
    (normalizedRawStatus === "delivered" || normalizedRawStatus === "read");
  const failed = input.status === "failed" || input.webhookStatus === "failed";
  if (!delivered && !failed) {
    return;
  }

  const reconcile = deliveryData.reconcileWhatsAppSetupTargetByProviderMessageId;
  if (typeof reconcile !== "function") return;
  await reconcile(env, {
    providerMessageId: input.providerMessageId,
    webhookStatus: delivered ? "delivered" : "failed",
    providerStatusLastSeenAt: input.providerStatusLastSeenAt,
    errorMessage: failed ? input.errorMessage : null,
  });
}

function selectDigestStatusAttempt(attempts: DigestAttemptSummary[]) {
  // Issue #2450: a partial multi-channel failure must not be recorded as
  // "sent". The digest-run aggregate gates the orchestration short-circuit
  // (`existingDigest.delivery.status === "sent"`), so a sent Slack attempt
  // alongside a failed email used to mark the whole run sent and permanently
  // kill retry of the failed channel.
  //
  // Exactly one rule changes: when the attempts include BOTH a sent and a
  // definitively failed attempt, the failed one wins. "Definitively failed"
  // means status "failed" only — a "pending" attempt is provider-unknown and
  // is owned by the retry sweep. Everything else keeps its previous outcome,
  // so a run of only sent channels still records "sent" and a run with no
  // sent channel still falls through to the first attempted channel.
  //
  // Sent channels stay deduped by `claimDigestDeliveryAttempt`, so re-entry
  // retries only the channel that actually failed.
  const hasSentAttempt = attempts.some((attempt) => attempt.status === "sent");
  if (hasSentAttempt) {
    for (const channel of DIGEST_STATUS_CHANNEL_PRIORITY) {
      const failedAttempt = attempts.find(
        (attempt) => attempt.channel === channel && attempt.status === "failed",
      );
      if (failedAttempt) return failedAttempt;
    }
  }

  for (const channel of DIGEST_STATUS_CHANNEL_PRIORITY) {
    const successfulAttempt = attempts.find(
      (attempt) => attempt.channel === channel && attempt.status === "sent",
    );
    if (successfulAttempt) return successfulAttempt;
  }

  for (const channel of DIGEST_STATUS_CHANNEL_PRIORITY) {
    const attemptedDelivery = attempts.find((attempt) => attempt.channel === channel);
    if (attemptedDelivery) return attemptedDelivery;
  }

  return null;
}

function digestStatusProvider(attempt: DigestAttemptSummary) {
  if (attempt.channel === "slack") return SLACK_PROVIDER;
  if (attempt.channel === "teams") return TEAMS_PROVIDER;
  if (attempt.channel === "whatsapp") return "whatsapp_cloud_api";
  return EMAIL_PROVIDER;
}

async function claimDigestDeliveryAttempt(
  env: AppEnv,
  input: {
    userId: string;
    digestRunId: string;
    deliveryTargetId: string;
    lane: DeliveryLane;
    channel: DeliveryChannel;
    provider: string;
    targetValue: string;
    templateName?: string | null;
    eventIds: string[];
    payloadSnapshot: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<{
  attemptId: string | null;
  claimUpdatedAt: string | null;
  duplicate: DeliveryAttemptRecord | null;
}> {
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  if (duplicate) {
    const stalePreDispatch =
      hasTrustedDigestProviderRetryEvidence(duplicate) &&
      isStalePreDispatchAttempt(duplicate);
    const definiteFailure =
      duplicate.status === "failed" && duplicate.webhookStatus === "failed";
    if (!definiteFailure && !stalePreDispatch) {
      return { attemptId: null, claimUpdatedAt: null, duplicate };
    }

    const claimUpdatedAt = new Date().toISOString();
    const retryClaimed = await updateDeliveryAttemptResult(env, duplicate.id, {
      provider: input.provider,
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: input.templateName ?? null,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      payloadSnapshot: {
        ...input.payloadSnapshot,
        deliveryClaimProtocol: DIGEST_PROVIDER_CLAIM_PROTOCOL,
      },
      targetValue: input.targetValue,
      updatedAt: claimUpdatedAt,
      expectedStatus: stalePreDispatch ? "pending" : "failed",
      expectedWebhookStatus: stalePreDispatch ? "pending" : "failed",
      expectedUpdatedAt: duplicate.updatedAt,
    });
    // Some unit-test adapters predate the boolean return. Only an explicit
    // false is a lost durable claim.
    if (retryClaimed !== false) {
      return { attemptId: duplicate.id, claimUpdatedAt, duplicate: null };
    }

    const concurrentRetry = await getDeliveryAttemptByIdempotencyKey(
      env,
      input.idempotencyKey,
    );
    if (!concurrentRetry) {
      throw new Error("Digest delivery retry claim disappeared.");
    }
    return { attemptId: null, claimUpdatedAt: null, duplicate: concurrentRetry };
  }

  const claimUpdatedAt = new Date().toISOString();
  try {
    const attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: null,
      digestRunId: input.digestRunId,
      deliveryTargetId: input.deliveryTargetId,
      lane: input.lane,
      channel: input.channel,
      provider: input.provider,
      status: "pending",
      webhookStatus: "pending",
      targetValue: input.targetValue,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: input.templateName ?? null,
      eventIds: input.eventIds,
      payloadSnapshot: {
        ...input.payloadSnapshot,
        deliveryClaimProtocol: DIGEST_PROVIDER_CLAIM_PROTOCOL,
      },
      idempotencyKey: input.idempotencyKey,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      timestamp: claimUpdatedAt,
    });
    return { attemptId, claimUpdatedAt, duplicate: null };
  } catch (error) {
    // The unique idempotency index is the arbiter. If another execution
    // inserted the claim after our read, return its durable state without
    // calling the provider. Non-uniqueness failures still propagate.
    const concurrentClaim = await getDeliveryAttemptByIdempotencyKey(
      env,
      input.idempotencyKey,
    );
    if (concurrentClaim) {
      return { attemptId: null, claimUpdatedAt: null, duplicate: concurrentClaim };
    }
    throw error;
  }
}

function confirmedDeliveryTimestamp(
  attempt: Pick<
    DeliveryAttemptRecord,
    "webhookStatus" | "providerStatusLastSeenAt" | "sentAt"
  >,
) {
  return attempt.webhookStatus === "delivered"
    ? (attempt.providerStatusLastSeenAt ?? attempt.sentAt)
    : null;
}

function summarizeDigestDeliveryAttempt(
  channel: DeliveryChannel,
  attempt: DeliveryAttemptRecord,
): DigestAttemptSummary {
  return {
    channel,
    status: deliveryAttemptSummaryStatus(attempt.status),
    targetValue: attempt.targetValue,
    providerMessageId: attempt.providerMessageId,
    errorMessage: attempt.errorMessage,
    deliveredAt: confirmedDeliveryTimestamp(attempt),
    subject: readString(attempt.payloadSnapshot.subject),
    providerDispatchStartedAt: readCanonicalUtcTimestamp(
      attempt.payloadSnapshot.providerDispatchStartedAt,
    ),
  };
}

function readCanonicalUtcTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.endsWith("Z")) return null;
  try {
    return new Date(value).toISOString() === value ? value : null;
  } catch {
    return null;
  }
}

function isGateCProofEmailSubject(value: string) {
  return /^0509 Gate C proof [a-z0-9._-]{1,128}$/u.test(value);
}

async function readFinalizedDigestAttempt(
  env: AppEnv,
  input: {
    channel: DeliveryChannel;
    idempotencyKey: string;
    fallback: DigestAttemptSummary;
  },
) {
  const durable = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  return durable ? summarizeDigestDeliveryAttempt(input.channel, durable) : input.fallback;
}

async function cancelPendingEmailAttemptAfterDispatchLoss(
  env: AppEnv,
  input: { attemptId: string; idempotencyKey: string; expectedUpdatedAt: string },
) {
  const current = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  if (!current) {
    throw new Error("Email delivery attempt disappeared before dispatch.");
  }
  if (current.status === "pending" && current.webhookStatus === "pending") {
    await updateDeliveryAttemptResult(env, input.attemptId, {
      provider: EMAIL_PROVIDER,
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: "Email delivery target was no longer active before dispatch.",
      failedAt: new Date().toISOString(),
      expectedStatus: "pending",
      expectedWebhookStatus: "pending",
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
  }
  const finalized = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  if (!finalized) {
    throw new Error("Email delivery attempt disappeared after dispatch loss.");
  }
  return finalized;
}

async function deliverDigestToEmailTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
  timeZone: string | null,
  upgradeNote: string | null = null,
  scanCadence: ScheduledScanCadence = "weekly",
  briefExtras: {
    forwardUrl?: string | null;
  } = {},
): Promise<DigestAttemptSummary> {
  const targetValue = normalizeDeliveryEmailValue(target.targetValue);
  if (!targetValue) {
    return {
      channel: "email",
      status: "failed",
      targetValue: target.targetValue,
      providerMessageId: null,
      errorMessage: "Email delivery target is empty.",
      deliveredAt: null,
    };
  }
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "email",
    targetValue,
  });
  const unsubscribeUrl = await buildUnsubscribeUrl(env, {
    userId: target.userId,
    targetId: target.id,
  });
  // Value-tier swing (issue #1976): one bounded aggregate read, loaded here
  // (this layer has env) and passed into the renderer precomputed — the
  // digest-email module never queries D1 itself. A failed read renders no
  // section rather than failing the digest send.
  const priceTierSwing = await loadPriceTierSwing(env).catch(() => null);
  // growth2 (#2147): the newest sitemap-indexable public move, loaded here
  // (this layer has env) and passed into the renderer precomputed — the
  // digest-email module never queries D1 itself. A failed read renders no
  // "Elsewhere this week" line rather than failing the digest send. Loaded
  // only when this send will actually use the quiet builder (empty items),
  // so non-quiet briefs never pay the weekly-moves read.
  const publicMove =
    input.items.length === 0
      ? await loadWeeklyPublicMoves(env, {
          since: new Date(Date.now() - WEEKLY_MOVES_WINDOW_MS).toISOString(),
        })
          .then((moves) => moves[0] ?? null)
          .catch(() => null)
      : null;
  const email = renderDigestEmail(env, {
    digestRunId: input.digestRunId,
    name: input.userName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalEligibleEvents: input.totalEligibleEvents,
    includedEvents: input.includedEvents,
    omittedEvents: input.omittedEvents,
    items: input.items,
    heartbeat: input.heartbeat ?? null,
    strategyParagraph: input.strategyParagraph ?? null,
    cadence: input.cadence,
    scanCadence,
    timeZone,
    unsubscribeUrl,
    upgradeNote,
    previousBriefItemCount: input.previousBriefItemCount ?? null,
    hasPreviousBrief: input.hasPreviousBrief ?? null,
    nextScanAt: input.nextScanAt ?? null,
    nextScanLabel: input.nextScanLabel ?? null,
    firstBrief: input.firstBrief === true,
    priceTierSwing,
    forwardUrl: briefExtras.forwardUrl ?? null,
    publicMove,
  });
  const subject = input.proofEmailSubject ?? email.subject;
  const payloadSnapshot = {
    kind: "weekly_digest",
    channel: "email",
    subject,
    cadence: input.cadence ?? "weekly",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    itemCount: input.items.length,
  };
  const attemptClaim = await claimDigestDeliveryAttempt(env, {
    userId: input.userId,
    digestRunId: input.digestRunId,
    deliveryTargetId: target.id,
    lane,
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue,
    eventIds: input.items.map((item) => item.eventId),
    payloadSnapshot,
    idempotencyKey,
  });
  if (attemptClaim.duplicate) {
    return summarizeDigestDeliveryAttempt("email", attemptClaim.duplicate);
  }
  const attemptId = attemptClaim.attemptId;
  const claimUpdatedAt = attemptClaim.claimUpdatedAt;
  if (!attemptId || !claimUpdatedAt) {
    throw new Error("Digest email delivery claim did not return an owned attempt.");
  }

  // Customer email dispatch must cross the same at-most-once boundary as an
  // instant alert. If unsubscribe commits after the durable claim, the CAS
  // loses and no provider call is allowed.
  const dispatchStartedAt = env.DB
    ? await markInstantDeliveryDispatchStarted(env, attemptId, claimUpdatedAt)
    : await markDeliveryAttemptProviderDispatch({
        attemptId,
        provider: EMAIL_PROVIDER,
        claimUpdatedAt,
        update: (ownedAttemptId, update) =>
          updateDeliveryAttemptResult(env, ownedAttemptId, update),
      });
  if (!dispatchStartedAt) {
    const current = await cancelPendingEmailAttemptAfterDispatchLoss(env, {
      attemptId,
      idempotencyKey,
      expectedUpdatedAt: claimUpdatedAt,
    });
    return summarizeDigestDeliveryAttempt("email", current);
  }

  if (!readCanonicalUtcTimestamp(dispatchStartedAt)) {
    const fallback: DigestAttemptSummary = {
      channel: "email",
      status: "failed",
      targetValue,
      providerMessageId: null,
      errorMessage: "Email dispatch timestamp was invalid before provider dispatch.",
      deliveredAt: null,
      subject,
      providerDispatchStartedAt: dispatchStartedAt,
      claimedByThisRun: true,
    };
    const finalized = await updateDeliveryAttemptResult(env, attemptId, {
      provider: EMAIL_PROVIDER,
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: fallback.errorMessage,
      failedAt: new Date().toISOString(),
      payloadSnapshot: {
        ...payloadSnapshot,
        providerDispatchStartedAt: dispatchStartedAt,
      },
      expectedStatus: "pending",
      expectedWebhookStatus: "provider_unknown",
      expectedUpdatedAt: dispatchStartedAt,
    });
    return finalized === false
      ? readFinalizedDigestAttempt(env, {
          channel: "email",
          idempotencyKey,
          fallback,
        })
      : fallback;
  }

  const providerResult = await sendRenderedDigestEmail(env, {
    to: targetValue,
    email: { ...email, subject },
    unsubscribeUrl,
  });
  const finalized = await updateDeliveryAttemptResult(env, attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerResult.status === "sent" ? providerResult.providerStatusLastSeenAt : null,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
    payloadSnapshot: {
      ...payloadSnapshot,
      providerDispatchStartedAt: dispatchStartedAt,
    },
  });
  const providerSummary: DigestAttemptSummary = {
    channel: "email",
    status: providerResult.status,
    targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: null,
    subject,
    providerDispatchStartedAt: dispatchStartedAt,
    claimedByThisRun: true,
  };
  if (finalized === false) {
    return readFinalizedDigestAttempt(env, {
      channel: "email",
      idempotencyKey,
      fallback: providerSummary,
    });
  }
  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, target, attemptId, providerAcceptedAt(providerResult));
  }

  return providerSummary;
}

/**
 * Shared pipeline behind the four instant-alert channel batches (email,
 * WhatsApp, Slack, Teams). The dedupe -> quiet-hours skip -> claim ->
 * prepare -> dispatch -> send -> finalize shape is identical for every
 * channel; only the provider constants, payload-snapshot extras, and the
 * send call differ, so those are the only per-channel inputs (issue #2336).
 */
type InstantPipelineProviderResult = {
  provider: string;
  status: "sent" | "failed" | "pending";
  webhookStatus: DeliveryAttemptRecord["webhookStatus"];
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  errorMessage: string | null;
};

type InstantPipelinePreparation =
  | { ok: true; webhookUrl?: string }
  | {
      ok: false;
      result: {
        provider: string;
        status: "sent" | "failed" | "pending";
        webhookStatus: DeliveryAttemptRecord["webhookStatus"];
        errorMessage: string | null;
      };
    };

type InstantPipelineSendOutcome = {
  providerResult: InstantPipelineProviderResult;
  sentAt: string | null;
  deliveredAt: string | null;
  templateName: string | null;
};

type InstantPipelineInput = {
  lane: DeliveryLane;
  userId: string;
  deliveryTarget: DeliveryTargetRecord;
  watchlistId: string;
  batch: InstantAlertBatch;
  content: InstantAlertContent;
};

type InstantPipelineConfig = {
  channel: DeliveryChannel;
  /** Label used in claim-integrity error messages ("email", "Slack", ...). */
  channelLabel: string;
  /** Label used when a pre-dispatch preparation claim disappears. */
  preparationFailureKind: "configuration-failure" | "local preparation";
  quietHoursProvider: string;
  /** Whether the claim snapshot carries the instant claim protocol marker. */
  includeDeliveryClaimProtocol: boolean;
  claimSnapshotExtras: Record<string, unknown>;
  quietHoursSnapshotExtras: Record<string, unknown>;
  /** Email/Slack/Teams throw when the claim is not owned; WhatsApp does not. */
  requireOwnedClaim: boolean;
  prepare: (
    env: AppEnv,
    deliveryTarget: DeliveryTargetRecord,
  ) => Promise<InstantPipelinePreparation>;
};

async function runInstantAttemptPipeline(
  env: AppEnv,
  config: InstantPipelineConfig,
  input: InstantPipelineInput,
  sendFn: (
    env: AppEnv,
    input: InstantPipelineInput,
    preparation: { ok: true; webhookUrl?: string },
  ) => Promise<InstantPipelineSendOutcome>,
): Promise<InstantAttemptSummary> {
  const { channel } = config;
  const eventIds = input.batch.events.map((event) => event.id);
  const claimSnapshot: Record<string, unknown> = {
    kind: "instant_alert",
    ...(config.includeDeliveryClaimProtocol
      ? { deliveryClaimProtocol: INSTANT_PROVIDER_CLAIM_PROTOCOL }
      : null),
    channel,
    batchKey: input.batch.batchKey,
    provisional: input.batch.provisional,
    ...config.claimSnapshotExtras,
    watchlistUrl: input.content.watchlistUrl,
  };
  const attemptDedupe = await resolveInstantAttemptDedupe(env, {
    userId: input.userId,
    watchlistId: input.watchlistId,
    deliveryTargetId: input.deliveryTarget.id,
    lane: input.lane,
    channel,
    targetValue: input.deliveryTarget.targetValue,
    eventIds,
    payloadSnapshot: claimSnapshot,
    batchKey: input.batch.batchKey,
    deferredByQuietHours: input.batch.deferredByQuietHours,
  });
  if (attemptDedupe.duplicate) {
    return summarizeDeliveryAttempt(attemptDedupe.duplicate);
  }

  if (input.batch.deferredByQuietHours) {
    if (!attemptDedupe.attemptId) {
      await createDeliveryAttempt(env, {
        userId: input.userId,
        watchlistId: input.watchlistId,
        digestRunId: null,
        deliveryTargetId: input.deliveryTarget.id,
        lane: input.lane,
        channel,
        provider: config.quietHoursProvider,
        status: "skipped_due_to_quiet_hours",
        webhookStatus: "provider_unknown",
        targetValue: input.deliveryTarget.targetValue,
        providerMessageId: null,
        providerStatusLastSeenAt: null,
        templateName: null,
        eventIds,
        payloadSnapshot: {
          kind: "instant_alert",
          channel,
          batchKey: input.batch.batchKey,
          provisional: input.batch.provisional,
          ...config.quietHoursSnapshotExtras,
        },
        idempotencyKey: attemptDedupe.idempotencyKey,
        errorMessage: null,
        sentAt: null,
        failedAt: null,
      });
    }

    return summarizeCurrentInstantAttempt({
      channel,
      status: "failed",
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      errorMessage: null,
      deliveredAt: null,
      deferredByQuietHours: true,
      providerAttemptedByThisRun: false,
      webhookStatus: "provider_unknown",
    });
  }

  if (
    config.requireOwnedClaim &&
    (!attemptDedupe.attemptId || !attemptDedupe.claimUpdatedAt)
  ) {
    throw new Error(
      `Instant ${config.channelLabel} delivery claim did not return an owned attempt.`,
    );
  }

  const preparation = await config.prepare(env, input.deliveryTarget);
  if (!preparation.ok) {
    const localResult = preparation.result;
    // Only WhatsApp skips requireOwnedClaim, and its prepare never fails, so
    // an unowned claim here means the prepare contract itself changed.
    const claimAttemptId = attemptDedupe.attemptId;
    const claimUpdatedAt = attemptDedupe.claimUpdatedAt;
    if (!claimAttemptId || !claimUpdatedAt) {
      throw new Error(
        `Instant ${config.channelLabel} ${config.preparationFailureKind} claim did not return an owned attempt.`,
      );
    }
    const finalized = await updateDeliveryAttemptResult(
      env,
      claimAttemptId,
      {
        provider: localResult.provider,
        status: localResult.status,
        webhookStatus: localResult.webhookStatus,
        providerMessageId: null,
        providerStatusLastSeenAt: null,
        errorMessage: localResult.errorMessage,
        sentAt: null,
        failedAt: new Date().toISOString(),
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: claimUpdatedAt,
      },
    );
    if (finalized === false) {
      const durable = await getDeliveryAttemptByIdempotencyKey(
        env,
        attemptDedupe.idempotencyKey,
      );
      if (durable) return summarizeDeliveryAttempt(durable);
      throw new Error(
        `Instant ${config.channelLabel} ${config.preparationFailureKind} claim disappeared.`,
      );
    }
    return summarizeCurrentInstantAttempt({
      channel,
      status: localResult.status,
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      errorMessage: localResult.errorMessage,
      deliveredAt: null,
      providerAttemptedByThisRun: false,
      webhookStatus: "failed",
    });
  }

  const dispatchClaim = await beginInstantDeliveryDispatch(env, attemptDedupe);
  if (dispatchClaim.duplicate) {
    return summarizeDeliveryAttempt(dispatchClaim.duplicate);
  }

  const outcome = await sendFn(env, input, preparation);
  const providerResult = outcome.providerResult;
  const failedAt =
    providerResult.status === "failed" ? new Date().toISOString() : null;

  let attemptId: string;
  if (attemptDedupe.attemptId) {
    const finalized = await finalizeInstantDeliveryAttempt(env, {
      attemptId: attemptDedupe.attemptId,
      idempotencyKey: attemptDedupe.idempotencyKey,
      dispatchStartedAt: dispatchClaim.dispatchStartedAt,
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: outcome.templateName,
      errorMessage: providerResult.errorMessage,
      sentAt: outcome.sentAt,
      failedAt,
    });
    if (!finalized.won && finalized.attempt) {
      return summarizeDeliveryAttempt(finalized.attempt, true);
    }
    attemptId = attemptDedupe.attemptId;
  } else if (attemptDedupe.retryAttempt) {
    await updateDeliveryAttemptResult(env, attemptDedupe.retryAttempt.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      ...(outcome.templateName !== null
        ? { templateName: outcome.templateName }
        : null),
      errorMessage: providerResult.errorMessage,
      sentAt: outcome.sentAt,
      failedAt,
    });
    attemptId = attemptDedupe.retryAttempt.id;
  } else {
    attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel,
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: outcome.templateName,
      eventIds,
      payloadSnapshot: claimSnapshot,
      idempotencyKey: attemptDedupe.idempotencyKey,
      errorMessage: providerResult.errorMessage,
      sentAt: outcome.sentAt,
      failedAt,
    });
  }
  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(
      env,
      input.deliveryTarget,
      attemptId,
      outcome.deliveredAt,
    );
  }

  return summarizeCurrentInstantAttempt({
    channel,
    status: providerResult.status,
    targetValue: input.deliveryTarget.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: outcome.deliveredAt,
    providerAttemptedByThisRun: true,
    webhookStatus: providerResult.webhookStatus,
  });
}

async function deliverInstantEmailBatch(
  env: AppEnv,
  input: InstantPipelineInput,
): Promise<InstantAttemptSummary> {
  // buildUnsubscribeUrl is fallible local work that must stay before the
  // dispatch boundary so a signing failure leaves the attempt reclaimable.
  let unsubscribeUrl: string | null = null;
  return runInstantAttemptPipeline(
    env,
    {
      channel: "email",
      channelLabel: "email",
      preparationFailureKind: "configuration-failure",
      quietHoursProvider: EMAIL_PROVIDER,
      includeDeliveryClaimProtocol: false,
      claimSnapshotExtras: { subject: input.content.subject },
      quietHoursSnapshotExtras: { subject: input.content.subject },
      requireOwnedClaim: true,
      prepare: async (env) => {
        if (!isEmailSendingConfigured(env)) {
          return {
            ok: false,
            result: {
              provider: EMAIL_PROVIDER,
              status: "failed",
              webhookStatus: "failed",
              errorMessage:
                "Email sending is not configured for this environment.",
            },
          };
        }
        unsubscribeUrl = await buildUnsubscribeUrl(env, {
          userId: input.deliveryTarget.userId,
          targetId: input.deliveryTarget.id,
        });
        return { ok: true };
      },
    },
    input,
    async (env, input) => {
      const providerResult = await sendInstantEmail(env, {
        email: input.deliveryTarget.targetValue,
        subject: input.content.subject,
        html: input.content.html,
        text: input.content.text,
        unsubscribeUrl,
      });
      return {
        providerResult,
        sentAt: providerAcceptedAt(providerResult),
        deliveredAt: providerResult.deliveredAt,
        templateName: null,
      };
    },
  );
}

async function deliverInstantWhatsAppBatch(
  env: AppEnv,
  input: InstantPipelineInput,
): Promise<InstantAttemptSummary> {
  return runInstantAttemptPipeline(
    env,
    {
      channel: "whatsapp",
      channelLabel: "WhatsApp",
      preparationFailureKind: "local preparation",
      quietHoursProvider: "whatsapp_cloud_api",
      includeDeliveryClaimProtocol: true,
      claimSnapshotExtras: { shortChange: input.content.shortChange },
      quietHoursSnapshotExtras: {},
      requireOwnedClaim: false,
      prepare: async () => ({ ok: true }),
    },
    input,
    async (env, input) => {
      const providerResult = await sendInstantWhatsApp(env, {
        lane: input.lane,
        target: input.deliveryTarget,
        competitor: input.content.competitor,
        shortChange: input.content.shortChange,
        watchlistUrl: input.content.watchlistUrl,
        provisional: input.batch.provisional,
      });
      const deliveredAt =
        providerResult.status === "sent" ? new Date().toISOString() : null;
      return {
        providerResult,
        sentAt: deliveredAt,
        deliveredAt,
        templateName: providerResult.templateName,
      };
    },
  );
}

async function deliverInstantSlackBatch(
  env: AppEnv,
  input: InstantPipelineInput,
): Promise<InstantAttemptSummary> {
  return runInstantAttemptPipeline(
    env,
    {
      channel: "slack",
      channelLabel: "Slack",
      preparationFailureKind: "local preparation",
      quietHoursProvider: SLACK_PROVIDER,
      includeDeliveryClaimProtocol: true,
      claimSnapshotExtras: { subject: input.content.subject },
      quietHoursSnapshotExtras: {},
      requireOwnedClaim: true,
      prepare: (env, deliveryTarget) =>
        prepareSlackWebhookTarget(env, deliveryTarget),
    },
    input,
    async (_env, input, preparation) => {
      if (typeof preparation.webhookUrl !== "string") {
        throw new Error(
          "Instant Slack preparation did not return a webhook URL.",
        );
      }
      const providerResult = await sendSlackWebhookUrl(preparation.webhookUrl, {
        text: renderInstantSlackText(input.content, input.batch.events),
      });
      return {
        providerResult,
        sentAt: providerResult.deliveredAt,
        deliveredAt: providerResult.deliveredAt,
        templateName: null,
      };
    },
  );
}

async function deliverInstantTeamsBatch(
  env: AppEnv,
  input: InstantPipelineInput,
): Promise<InstantAttemptSummary> {
  return runInstantAttemptPipeline(
    env,
    {
      channel: "teams",
      channelLabel: "Teams",
      preparationFailureKind: "local preparation",
      quietHoursProvider: TEAMS_PROVIDER,
      includeDeliveryClaimProtocol: true,
      claimSnapshotExtras: { subject: input.content.subject },
      quietHoursSnapshotExtras: {},
      requireOwnedClaim: true,
      prepare: (env, deliveryTarget) =>
        prepareTeamsWebhookTarget(env, deliveryTarget),
    },
    input,
    async (_env, input, preparation) => {
      if (typeof preparation.webhookUrl !== "string") {
        throw new Error(
          "Instant Teams preparation did not return a webhook URL.",
        );
      }
      const providerResult = await sendTeamsWebhookUrl(preparation.webhookUrl, {
        text: renderInstantTeamsText(input.content, input.batch.events),
        title: input.content.subject,
      });
      return {
        providerResult,
        sentAt: providerResult.deliveredAt,
        deliveredAt: providerResult.deliveredAt,
        templateName: null,
      };
    },
  );
}

async function deliverDigestToWhatsAppTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
  timeZone: string | null,
): Promise<DigestAttemptSummary> {
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "whatsapp",
    targetValue: target.targetValue,
  });
  const attemptClaim = await claimDigestDeliveryAttempt(env, {
    userId: input.userId,
    digestRunId: input.digestRunId,
    deliveryTargetId: target.id,
    lane,
    channel: "whatsapp",
    provider: "whatsapp_cloud_api",
    targetValue: target.targetValue,
    eventIds: input.items.map((item) => item.eventId),
    payloadSnapshot: {
      kind: "weekly_digest",
      channel: "whatsapp",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      itemCount: input.items.length,
    },
    idempotencyKey,
  });
  if (attemptClaim.duplicate) {
    return summarizeDigestDeliveryAttempt("whatsapp", attemptClaim.duplicate);
  }
  const attemptId = attemptClaim.attemptId;
  const claimUpdatedAt = attemptClaim.claimUpdatedAt;
  if (!attemptId || !claimUpdatedAt) {
    throw new Error("Digest WhatsApp claim did not return an owned attempt.");
  }

  const preparation = prepareDigestWhatsAppTarget(env, {
    lane,
    target,
    itemCount: input.items.length,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    timeZone,
  });
  if (preparation.errorMessage) {
    const finalized = await updateDeliveryAttemptResult(env, attemptId, {
      provider: "whatsapp_cloud_api",
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: preparation.templateName,
      errorMessage: preparation.errorMessage,
      sentAt: null,
      failedAt: new Date().toISOString(),
      expectedStatus: "pending",
      expectedWebhookStatus: "pending",
      expectedUpdatedAt: claimUpdatedAt,
    });
    const summary: DigestAttemptSummary = {
      channel: "whatsapp",
      status: "failed",
      targetValue: target.targetValue,
      providerMessageId: null,
      errorMessage: preparation.errorMessage,
      deliveredAt: null,
      claimedByThisRun: true,
    };
    return finalized === false
      ? readFinalizedDigestAttempt(env, {
          channel: "whatsapp",
          idempotencyKey,
          fallback: summary,
        })
      : summary;
  }

  const dispatch = await beginDigestProviderDispatch(env, {
    attemptId,
    claimUpdatedAt,
    idempotencyKey,
    provider: "whatsapp_cloud_api",
  });
  if (dispatch.duplicate) {
    return summarizeDigestDeliveryAttempt("whatsapp", dispatch.duplicate);
  }
  if (!dispatch.dispatchStartedAt) {
    throw new Error("Digest WhatsApp dispatch did not return an owned attempt.");
  }

  const providerResult = await sendDigestWhatsApp(env, {
    lane,
    target,
    itemCount: input.items.length,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    timeZone,
  });
  const deliveredAt = providerResult.status === "sent" ? new Date().toISOString() : null;
  const finalized = await updateDeliveryAttemptResult(env, attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: providerResult.templateName,
    errorMessage: providerResult.errorMessage,
    sentAt: deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatch.dispatchStartedAt,
  });
  const providerSummary: DigestAttemptSummary = {
    channel: "whatsapp",
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt,
    claimedByThisRun: true,
  };
  if (finalized === false) {
    return readFinalizedDigestAttempt(env, {
      channel: "whatsapp",
      idempotencyKey,
      fallback: providerSummary,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, target, attemptId, deliveredAt);
  }

  return providerSummary;
}

async function deliverDigestToSlackTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
  timeZone: string | null,
): Promise<DigestAttemptSummary> {
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "slack",
    targetValue: target.targetValue,
  });
  const cadenceLabel = digestCadenceLabel(input.cadence);
  const slackText = renderDigestSlackText({
    cadenceLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    timeZone,
  });
  const attemptClaim = await claimDigestDeliveryAttempt(env, {
    userId: input.userId,
    digestRunId: input.digestRunId,
    deliveryTargetId: target.id,
    lane,
    channel: "slack",
    provider: SLACK_PROVIDER,
    targetValue: target.targetValue,
    eventIds: input.items.map((item) => item.eventId),
    payloadSnapshot: {
      kind: "weekly_digest",
      channel: "slack",
      cadence: input.cadence ?? "weekly",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      itemCount: input.items.length,
    },
    idempotencyKey,
  });
  if (attemptClaim.duplicate) {
    return summarizeDigestDeliveryAttempt("slack", attemptClaim.duplicate);
  }
  const attemptId = attemptClaim.attemptId;
  const claimUpdatedAt = attemptClaim.claimUpdatedAt;
  if (!attemptId || !claimUpdatedAt) {
    throw new Error("Digest Slack claim did not return an owned attempt.");
  }

  const preparation = await prepareSlackWebhookTarget(env, target);
  if (!preparation.ok) {
    const localFailure = preparation.result;
    const finalized = await updateDeliveryAttemptResult(env, attemptId, {
      provider: localFailure.provider,
      status: localFailure.status,
      webhookStatus: localFailure.webhookStatus,
      providerMessageId: localFailure.providerMessageId,
      providerStatusLastSeenAt: localFailure.providerStatusLastSeenAt,
      errorMessage: localFailure.errorMessage,
      sentAt: localFailure.deliveredAt,
      failedAt: new Date().toISOString(),
      expectedStatus: "pending",
      expectedWebhookStatus: "pending",
      expectedUpdatedAt: claimUpdatedAt,
    });
    const summary: DigestAttemptSummary = {
      channel: "slack",
      status: "failed",
      targetValue: target.targetValue,
      providerMessageId: null,
      errorMessage: localFailure.errorMessage,
      deliveredAt: null,
      claimedByThisRun: true,
    };
    return finalized === false
      ? readFinalizedDigestAttempt(env, {
          channel: "slack",
          idempotencyKey,
          fallback: summary,
        })
      : summary;
  }

  const dispatch = await beginDigestProviderDispatch(env, {
    attemptId,
    claimUpdatedAt,
    idempotencyKey,
    provider: SLACK_PROVIDER,
  });
  if (dispatch.duplicate) {
    return summarizeDigestDeliveryAttempt("slack", dispatch.duplicate);
  }
  if (!dispatch.dispatchStartedAt) {
    throw new Error("Digest Slack dispatch did not return an owned attempt.");
  }

  const providerResult = await sendSlackWebhookUrl(preparation.webhookUrl, {
    text: slackText,
  });
  const finalized = await updateDeliveryAttemptResult(env, attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerResult.deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatch.dispatchStartedAt,
  });
  const providerSummary: DigestAttemptSummary = {
    channel: "slack",
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.deliveredAt,
    claimedByThisRun: true,
  };
  if (finalized === false) {
    return readFinalizedDigestAttempt(env, {
      channel: "slack",
      idempotencyKey,
      fallback: providerSummary,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, target, attemptId, providerResult.deliveredAt);
  }

  return providerSummary;
}

async function deliverDigestToTeamsTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
  timeZone: string | null,
): Promise<DigestAttemptSummary> {
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "teams",
    targetValue: target.targetValue,
  });
  const cadenceLabel = digestCadenceLabel(input.cadence);
  const teamsText = renderDigestTeamsText({
    cadenceLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    timeZone,
  });
  const attemptClaim = await claimDigestDeliveryAttempt(env, {
    userId: input.userId,
    digestRunId: input.digestRunId,
    deliveryTargetId: target.id,
    lane,
    channel: "teams",
    provider: TEAMS_PROVIDER,
    targetValue: target.targetValue,
    eventIds: input.items.map((item) => item.eventId),
    payloadSnapshot: {
      kind: "weekly_digest",
      channel: "teams",
      cadence: input.cadence ?? "weekly",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      itemCount: input.items.length,
    },
    idempotencyKey,
  });
  if (attemptClaim.duplicate) {
    return summarizeDigestDeliveryAttempt("teams", attemptClaim.duplicate);
  }
  const attemptId = attemptClaim.attemptId;
  const claimUpdatedAt = attemptClaim.claimUpdatedAt;
  if (!attemptId || !claimUpdatedAt) {
    throw new Error("Digest Teams claim did not return an owned attempt.");
  }

  const preparation = await prepareTeamsWebhookTarget(env, target);
  if (!preparation.ok) {
    const localFailure = preparation.result;
    const finalized = await updateDeliveryAttemptResult(env, attemptId, {
      provider: localFailure.provider,
      status: localFailure.status,
      webhookStatus: localFailure.webhookStatus,
      providerMessageId: localFailure.providerMessageId,
      providerStatusLastSeenAt: localFailure.providerStatusLastSeenAt,
      errorMessage: localFailure.errorMessage,
      sentAt: localFailure.deliveredAt,
      failedAt: new Date().toISOString(),
      expectedStatus: "pending",
      expectedWebhookStatus: "pending",
      expectedUpdatedAt: claimUpdatedAt,
    });
    const summary: DigestAttemptSummary = {
      channel: "teams",
      status: "failed",
      targetValue: target.targetValue,
      providerMessageId: null,
      errorMessage: localFailure.errorMessage,
      deliveredAt: null,
      claimedByThisRun: true,
    };
    return finalized === false
      ? readFinalizedDigestAttempt(env, {
          channel: "teams",
          idempotencyKey,
          fallback: summary,
        })
      : summary;
  }

  const dispatch = await beginDigestProviderDispatch(env, {
    attemptId,
    claimUpdatedAt,
    idempotencyKey,
    provider: TEAMS_PROVIDER,
  });
  if (dispatch.duplicate) {
    return summarizeDigestDeliveryAttempt("teams", dispatch.duplicate);
  }
  if (!dispatch.dispatchStartedAt) {
    throw new Error("Digest Teams dispatch did not return an owned attempt.");
  }

  const providerResult = await sendTeamsWebhookUrl(preparation.webhookUrl, {
    text: teamsText,
    title: `Five to Nine ${cadenceLabel}`,
  });
  const finalized = await updateDeliveryAttemptResult(env, attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerResult.deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatch.dispatchStartedAt,
  });
  const providerSummary: DigestAttemptSummary = {
    channel: "teams",
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.deliveredAt,
    claimedByThisRun: true,
  };
  if (finalized === false) {
    return readFinalizedDigestAttempt(env, {
      channel: "teams",
      idempotencyKey,
      fallback: providerSummary,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, target, attemptId, providerResult.deliveredAt);
  }

  return providerSummary;
}

async function beginDigestProviderDispatch(
  env: AppEnv,
  input: {
    attemptId: string;
    claimUpdatedAt: string;
    idempotencyKey: string;
    provider: string;
  },
): Promise<{
  dispatchStartedAt: string | null;
  duplicate: DeliveryAttemptRecord | null;
}> {
  const dispatchStartedAt = env.DB
    ? await markInstantDeliveryDispatchStarted(env, input.attemptId, input.claimUpdatedAt)
    : await markDeliveryAttemptProviderDispatch({
        attemptId: input.attemptId,
        provider: input.provider,
        claimUpdatedAt: input.claimUpdatedAt,
        update: (attemptId, update) =>
          updateDeliveryAttemptResult(env, attemptId, update),
      });
  if (dispatchStartedAt) {
    return { dispatchStartedAt, duplicate: null };
  }

  const current = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  if (!current) {
    throw new Error("Digest delivery dispatch claim disappeared.");
  }
  return { dispatchStartedAt: null, duplicate: current };
}

export async function resolveDigestEmailTargets(
  env: AppEnv,
  userId: string,
  accountEmail: string | null,
  options: { requireUniqueExistingTarget?: boolean } = {},
) {
  if (
    !options.requireUniqueExistingTarget &&
    "migrateAutoProvisionedEmailTargets" in deliveryData &&
    accountEmail
  ) {
    const migrate = deliveryData.migrateAutoProvisionedEmailTargets;
    if (typeof migrate === "function") await migrate(env, userId, accountEmail);
  }
  const normalizedAccountEmail = normalizeDeliveryEmailValue(accountEmail);
  if (!normalizedAccountEmail) {
    return [];
  }
  if (await hasSuppressedEmailAddress(env, userId, normalizedAccountEmail)) {
    return [];
  }
  // main's Gate C path needs the unfiltered target list plus its limit sentinel,
  // so read all email targets and narrow to the account address below rather
  // than filtering in the query as this branch previously did.
  const targetLimit = options.requireUniqueExistingTarget ? 100 : 10;
  const allTargets = await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "email",
    limit: targetLimit,
  });
  const matchingTargets = allTargets.filter((target: DeliveryTargetRecord) =>
    isUsableEmailTarget(target, normalizedAccountEmail),
  );

  // Gate C must see the raw matches: several byte-distinct rows that normalize
  // to the same address are exactly the ambiguity it exists to reject, so it
  // runs before this branch's dedupe rather than after it.
  if (options.requireUniqueExistingTarget) {
    if (allTargets.length === targetLimit || matchingTargets.length !== 1) {
      throw new Error("Gate C proof email target must resolve uniquely.");
    }
    return matchingTargets;
  }

  const configuredTargets = dedupeTargetsByValue(matchingTargets);

  if (configuredTargets.length > 0) {
    return configuredTargets;
  }

  // Never re-provision an address the recipient unsubscribed or paused —
  // upsertDeliveryTarget would reset those flags. This branch expressed the
  // same guard as "any target for this address exists", which is exactly what
  // hasEmailTargetForAddress checks against the unfiltered list.
  if (hasEmailTargetForAddress(allTargets, normalizedAccountEmail)) {
    return [];
  }

  const fallbackTarget = await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, {
    userId,
    targetValue: normalizedAccountEmail,
    optInSource: AUTO_PROVISIONED_EMAIL_SOURCE,
    metadata: {
      autoProvisioned: true,
    },
  });

  return fallbackTarget ? [fallbackTarget] : [];
}

async function hasSuppressedEmailAddress(
  env: AppEnv,
  userId: string,
  targetValue: string,
) {
  const suppressionReader = (
    "hasSuppressedEmailTargetForUserAndAddress" in deliveryData
      ? deliveryData.hasSuppressedEmailTargetForUserAndAddress
      : undefined
  ) as
    | ((
        readerEnv: AppEnv,
        input: { userId: string; targetValue: string },
      ) => Promise<boolean>)
    | undefined;
  return typeof suppressionReader === "function"
    ? suppressionReader(env, {
      userId,
      targetValue,
    })
    : false;
}

export async function resolveAlertEmailTargets(
  env: AppEnv,
  userId: string,
  watchlistId: string,
  accountEmail: string | null,
) {
  if ("migrateAutoProvisionedEmailTargets" in deliveryData && accountEmail) {
    const migrate = deliveryData.migrateAutoProvisionedEmailTargets;
    if (typeof migrate === "function") await migrate(env, userId, accountEmail);
  }
  const normalizedAccountEmail = normalizeDeliveryEmailValue(accountEmail);
  if (!normalizedAccountEmail) {
    return [];
  }
  if (await hasSuppressedEmailAddress(env, userId, normalizedAccountEmail)) {
    return [];
  }
  const allTargets = dedupeTargetsByValue([
    ...(await listDeliveryTargets(env, userId, {
      watchlistId,
      channel: "email",
      limit: 10,
    })),
    ...(await listDeliveryTargets(env, userId, {
      watchlistId: null,
      channel: "email",
      limit: 10,
    })),
  ]);
  const combinedTargets = allTargets.filter((target) =>
    isUsableEmailTarget(target, normalizedAccountEmail),
  );

  if (combinedTargets.length > 0) {
    return combinedTargets;
  }

  // Never re-provision an address the recipient unsubscribed or paused —
  // upsertDeliveryTarget would reset those flags.
  if (hasEmailTargetForAddress(allTargets, normalizedAccountEmail)) {
    return [];
  }

  const fallbackTarget = await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, {
    userId,
    targetValue: normalizedAccountEmail,
    optInSource: AUTO_PROVISIONED_EMAIL_SOURCE,
    metadata: {
      autoProvisioned: true,
    },
  });

  return fallbackTarget ? [fallbackTarget] : [];
}

async function resolveDigestWhatsAppTargets(env: AppEnv, userId: string) {
  if (!isWhatsAppDeliveryCustomerFacing()) return [];
  return (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "whatsapp",
    limit: 10,
  })).filter(isUsableWhatsAppTarget);
}

async function resolveAlertWhatsAppTargets(env: AppEnv, userId: string, watchlistId: string) {
  if (!isWhatsAppDeliveryCustomerFacing()) return [];
  return dedupeTargetsByValue([
    ...(await listDeliveryTargets(env, userId, {
      watchlistId,
      channel: "whatsapp",
      limit: 10,
    })),
    ...(await listDeliveryTargets(env, userId, {
      watchlistId: null,
      channel: "whatsapp",
      limit: 10,
    })),
  ]).filter(isUsableWhatsAppTarget);
}

async function resolveDigestSlackTargets(env: AppEnv, userId: string) {
  if (!isSlackWebhookDeliveryCustomerFacing()) return [];
  return (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "slack",
    limit: 10,
  })).filter(isUsableSlackTarget);
}

async function resolveAlertSlackTargets(env: AppEnv, userId: string, watchlistId: string) {
  if (!isSlackWebhookDeliveryCustomerFacing()) return [];
  return dedupeTargetsByValue([
    ...(await listDeliveryTargets(env, userId, {
      watchlistId,
      channel: "slack",
      limit: 10,
    })),
    ...(await listDeliveryTargets(env, userId, {
      watchlistId: null,
      channel: "slack",
      limit: 10,
    })),
  ]).filter(isUsableSlackTarget);
}

async function resolveDigestTeamsTargets(env: AppEnv, userId: string) {
  if (!isTeamsWebhookDeliveryCustomerFacing()) return [];
  return (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "teams",
    limit: 10,
  })).filter(isUsableTeamsTarget);
}

async function resolveAlertTeamsTargets(env: AppEnv, userId: string, watchlistId: string) {
  if (!isTeamsWebhookDeliveryCustomerFacing()) return [];
  return dedupeTargetsByValue([
    ...(await listDeliveryTargets(env, userId, {
      watchlistId,
      channel: "teams",
      limit: 10,
    })),
    ...(await listDeliveryTargets(env, userId, {
      watchlistId: null,
      channel: "teams",
      limit: 10,
    })),
  ]).filter(isUsableTeamsTarget);
}

function isUsableEmailTarget(target: DeliveryTargetRecord, currentAccountEmail?: string | null) {
  const normalizedAccountEmail = normalizeDeliveryEmailValue(currentAccountEmail);
  if (
    !normalizedAccountEmail ||
    target.isPaused ||
    !target.isOptedIn ||
    target.optedOutAt ||
    !target.isValidated ||
    target.validationStatus !== "validated"
  ) {
    return false;
  }

  return normalizeDeliveryEmailValue(target.targetValue) === normalizedAccountEmail;
}

function isAutoProvisionedEmailTarget(target: DeliveryTargetRecord) {
  return target.optInSource === AUTO_PROVISIONED_EMAIL_SOURCE || target.metadata.autoProvisioned === true;
}

async function resolveVerifiedAccountEmail(
  env: AppEnv,
  userId: string,
  fallbackEmail: string | null,
) {
  const profileLoader = ("getUserDeliveryProfile" in deliveryData
    ? deliveryData.getUserDeliveryProfile
    : undefined) as unknown as
    | ((loaderEnv: AppEnv, loaderUserId: string) => Promise<{
        email: string | null;
        emailVerified?: boolean;
      } | null>)
    | undefined;
  const profile = typeof profileLoader === "function"
    ? await profileLoader(env, userId)
    : null;
  if (profile) {
    if (profile.emailVerified !== true) return null;
    return normalizeDeliveryEmailValue(profile.email);
  }

  // Isolated adapters without D1 may provide a verified account email through
  // their caller context. Production has the profile helper and fails closed
  // when the durable current email cannot be read.
  return env.DB ? null : normalizeDeliveryEmailValue(fallbackEmail);
}

function normalizeDeliveryEmailValue(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function hasEmailTargetForAddress(targets: DeliveryTargetRecord[], address: string) {
  const normalized = address.trim().toLowerCase();
  return targets.some((target) => target.targetValue.trim().toLowerCase() === normalized);
}

function isUsableSlackTarget(target: DeliveryTargetRecord) {
  return (
    !target.isPaused &&
    target.isOptedIn &&
    !target.optedOutAt &&
    target.isValidated &&
    target.validationStatus === "validated"
  );
}

function isUsableTeamsTarget(target: DeliveryTargetRecord) {
  return (
    !target.isPaused &&
    target.isOptedIn &&
    !target.optedOutAt &&
    target.isValidated &&
    target.validationStatus === "validated"
  );
}

function isUsableWhatsAppTarget(target: DeliveryTargetRecord) {
  return (
    !target.isPaused &&
    target.isOptedIn &&
    !target.optedOutAt &&
    target.isValidated &&
    target.validationStatus === "validated" &&
    target.templateEligible
  );
}


async function sendRenderedDigestEmail(
  env: AppEnv,
  input: {
    to: string;
    email: ReturnType<typeof buildDigestEmail>;
    unsubscribeUrl: string | null;
  },
): Promise<EmailProviderResult> {
  const result = await sendCloudflareEmail(env, {
    to: input.to,
    subject: input.email.subject,
    html: input.email.html,
    text: input.email.text,
    tag: "weekly-digest",
    unsubscribeUrl: input.unsubscribeUrl,
    theme: "case-file",
  });
  return result;
}

async function sendInstantEmail(
  env: AppEnv,
  input: {
    email: string;
    subject: string;
    html: string;
    text?: string | null;
    unsubscribeUrl: string | null;
  },
) {
  return sendCloudflareEmail(env, {
    to: input.email,
    subject: input.subject,
    html: input.html,
    text: input.text ?? undefined,
    tag: "instant-alert",
    unsubscribeUrl: input.unsubscribeUrl,
    theme: "case-file",
  });
}


async function persistDeliveryTargetSuccess(
  env: AppEnv,
  target: DeliveryTargetRecord,
  attemptId: string,
  deliveredAt: string | null,
) {
  await upsertDeliveryTarget(env, {
    userId: target.userId,
    watchlistId: target.watchlistId,
    channel: target.channel,
    targetValue: target.targetValue,
    validationStatus: target.validationStatus,
    isValidated: target.isValidated,
    isOptedIn: target.isOptedIn,
    optInSource: target.optInSource,
    optedInAt: target.optedInAt,
    isPaused: target.isPaused,
    pausedAt: target.pausedAt,
    optedOutAt: target.optedOutAt,
    templateEligible: target.templateEligible,
    lastSuccessfulDeliveryAt: deliveredAt,
    lastSuccessfulAttemptId: attemptId,
    providerIdentifier: target.providerIdentifier,
    metadata: target.metadata,
  });
}

/**
 * Issue #2175 do-step 3: the one-click "forward to a teammate / client" URL
 * behind every customer brief — the live share view of the digest (or, for
 * instant alerts, the watchlist), produced by the existing share-link
 * machinery. Reuse-first: an active link for the same resource is reused so
 * re-sends never multiply links; otherwise one is created with the standard
 * token shape and default TTL. The caller applies the plan gate
 * (`share_links`) before invoking this. Any failure degrades to null — the
 * brief simply omits the forward line, delivery is never blocked.
 */
async function resolveShareForwardUrl(
  env: AppEnv,
  input: {
    userId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  },
): Promise<string | null> {
  try {
    const listActive = deliveryData.listActiveShareLinks;
    const createShare = deliveryData.createShareLink;
    if (typeof listActive !== "function" || typeof createShare !== "function") {
      return null;
    }
    const active = await listActive(env, input.userId, 50);
    const existing = active.find(
      (link) =>
        link.resourceType === input.resourceType &&
        link.resourceId === input.resourceId,
    );
    const token =
      existing?.token ??
      (
        await createShare(env, systemShareSession(input.userId), {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          isSnapshot: false,
        })
      ).token;
    return `${appBaseUrl(env)}/share/${token}`;
  } catch {
    return null;
  }
}

/**
 * Minimal session shape for system-actor share creation during delivery:
 * `createShareLink` reads only `session.user.id` (the workspace owner the
 * link belongs to). No request session exists in the cron/delivery context.
 */
function systemShareSession(userId: string): AppSession {
  return { user: { id: userId } } as unknown as AppSession;
}

async function resolveEntitledDeliveryConfigs(
  env: AppEnv,
  userId: string,
  workspaceConfig: WorkspaceDeliveryConfigRecord,
  watchlistConfig: WatchlistDeliveryConfigRecord | null,
) {
  const { getUserPlan } = await import("~/lib/plan.server");
  const { applyDeliveryEntitlements } = await import("~/lib/plan-feature-gate.server");
  const plan = await getUserPlan(env, userId);
  return {
    plan,
    workspaceConfig: applyDeliveryEntitlements(plan, workspaceConfig),
    watchlistConfig: watchlistConfig ? applyDeliveryEntitlements(plan, watchlistConfig) : null,
  };
}

function buildLegacyWorkspaceConfig(
  userId: string,
  hasEmail: boolean,
): WorkspaceDeliveryConfigRecord {
  const defaults = legacyWorkspaceDeliveryDefaults({ hasEmail });
  return {
    id: `legacy-workspace-${userId}`,
    userId,
    sensitivityMode: defaults.sensitivityMode,
    instantEnabled: defaults.instantEnabled,
    digestEnabled: defaults.digestEnabled,
    digestCadencePreference: defaults.digestCadencePreference,
    emailEnabled: defaults.emailEnabled,
    whatsappEnabled: defaults.whatsappEnabled,
    slackEnabled: defaults.slackEnabled,
    teamsEnabled: defaults.teamsEnabled,
    quietHours: null,
    timezone: null,
    createdAt: "",
    updatedAt: "",
  };
}

function buildDeliveryAttemptIdempotencyKey(input: {
  digestRunId: string;
  lane: DeliveryLane;
  channel: DeliveryChannel;
  targetValue: string;
}) {
  return [
    "digest",
    input.digestRunId,
    input.lane,
    input.channel,
    input.targetValue.trim().toLowerCase(),
  ].join(":");
}

function buildLegacyInstantDeliveryAttemptIdempotencyKey(input: {
  watchlistId: string;
  lane: DeliveryLane;
  channel: DeliveryChannel;
  targetValue: string;
  batchKey: string;
}) {
  return [
    "instant",
    input.watchlistId,
    input.lane,
    input.channel,
    input.targetValue.trim().toLowerCase(),
    input.batchKey,
  ].join(":");
}

function buildInstantDeliveryAttemptIdempotencyKey(input: {
  watchlistId: string;
  lane: DeliveryLane;
  channel: DeliveryChannel;
  targetValue: string;
  batchKey: string;
  attemptKind: "send" | "quiet-hours";
}) {
  return `${buildLegacyInstantDeliveryAttemptIdempotencyKey(input)}:${input.attemptKind}`;
}

async function resolveInstantAttemptDedupe(
  env: AppEnv,
  input: {
    userId: string;
    watchlistId: string;
    deliveryTargetId: string;
    lane: DeliveryLane;
    channel: DeliveryChannel;
    targetValue: string;
    eventIds: string[];
    payloadSnapshot: Record<string, unknown>;
    batchKey: string;
    deferredByQuietHours: boolean;
  },
): Promise<{
  idempotencyKey: string;
  duplicate: DeliveryAttemptRecord | null;
  retryAttempt: DeliveryAttemptRecord | null;
  attemptId: string | null;
  claimUpdatedAt: string | null;
}> {
  const attemptKind = input.deferredByQuietHours ? "quiet-hours" : "send";
  const currentIdempotencyKey = buildInstantDeliveryAttemptIdempotencyKey({
    ...input,
    attemptKind,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(
    env,
    currentIdempotencyKey,
  );

  const legacyIdempotencyKey = buildLegacyInstantDeliveryAttemptIdempotencyKey(input);
  const legacyDuplicate = duplicate
    ? null
    : await getDeliveryAttemptByIdempotencyKey(env, legacyIdempotencyKey);

  let idempotencyKey = currentIdempotencyKey;
  let reclaimCandidate = duplicate;
  if (legacyDuplicate) {
    if (input.deferredByQuietHours) {
      return {
        idempotencyKey: currentIdempotencyKey,
        duplicate: legacyDuplicate,
        retryAttempt: null,
        attemptId: null,
        claimUpdatedAt: null,
      };
    }

    if (legacyDuplicate.status !== "skipped_due_to_quiet_hours") {
      const retryEvidenceIsTrusted =
        input.channel === "email" ||
        hasTrustedInstantProviderRetryEvidence(legacyDuplicate);
      const stalePreDispatch =
        retryEvidenceIsTrusted && isStalePreDispatchAttempt(legacyDuplicate);
      const definiteFailure =
        retryEvidenceIsTrusted &&
        legacyDuplicate.status === "failed" &&
        legacyDuplicate.webhookStatus === "failed";
      if (!stalePreDispatch && !definiteFailure) {
        return {
          idempotencyKey: currentIdempotencyKey,
          duplicate: legacyDuplicate,
          retryAttempt: null,
          attemptId: null,
          claimUpdatedAt: null,
        };
      }
      idempotencyKey = legacyIdempotencyKey;
      reclaimCandidate = legacyDuplicate;
    }
  }

  const claimInput = {
    userId: input.userId,
    watchlistId: input.watchlistId,
    deliveryTargetId: input.deliveryTargetId,
    lane: input.lane,
    channel: input.channel,
    provider:
      input.channel === "email"
        ? EMAIL_PROVIDER
        : input.channel === "slack"
          ? SLACK_PROVIDER
          : input.channel === "teams"
            ? TEAMS_PROVIDER
            : "whatsapp_cloud_api",
    targetValue: input.targetValue,
    eventIds: input.eventIds,
    payloadSnapshot: input.payloadSnapshot,
    idempotencyKey,
    deferredByQuietHours: input.deferredByQuietHours,
  };
  const claim = env.DB
    ? await claimInstantDeliveryAttempt(env, claimInput)
    : await claimInstantDeliveryAttemptWithoutDb(env, claimInput);
  if (claim.duplicate) {
    return {
      idempotencyKey,
      duplicate: claim.duplicate,
      retryAttempt: null,
      attemptId: null,
      claimUpdatedAt: null,
    };
  }

  return {
    idempotencyKey,
    duplicate: null,
    retryAttempt: claim.reclaimed ? reclaimCandidate : null,
    attemptId: claim.attemptId,
    claimUpdatedAt: claim.claimUpdatedAt,
  };
}

async function claimInstantDeliveryAttemptWithoutDb(
  env: AppEnv,
  input: {
    userId: string;
    watchlistId: string;
    deliveryTargetId: string;
    lane: DeliveryLane;
    channel: DeliveryChannel;
    provider: string;
    targetValue: string;
    eventIds: string[];
    payloadSnapshot: Record<string, unknown>;
    idempotencyKey: string;
    deferredByQuietHours: boolean;
  },
) {
  const existing = await getDeliveryAttemptByIdempotencyKey(
    env,
    input.idempotencyKey,
  );
  const quietHours = input.deferredByQuietHours;
  if (existing) {
    if (quietHours) {
      return {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: existing,
        reclaimed: false,
      };
    }

    const retryEvidenceIsTrusted =
      input.channel === "email" ||
      hasTrustedInstantProviderRetryEvidence(existing);
    const stalePreDispatch =
      retryEvidenceIsTrusted && isStalePreDispatchAttempt(existing);
    const definiteFailure =
      retryEvidenceIsTrusted &&
      existing.status === "failed" &&
      existing.webhookStatus === "failed";
    if (!stalePreDispatch && !definiteFailure) {
      return {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: existing,
        reclaimed: false,
      };
    }

    const claimUpdatedAt = new Date().toISOString();
    const reclaimed = await updateDeliveryAttemptResult(env, existing.id, {
      provider: input.provider,
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      payloadSnapshot: input.payloadSnapshot,
      targetValue: input.targetValue,
      updatedAt: claimUpdatedAt,
      expectedStatus: stalePreDispatch ? "pending" : "failed",
      expectedWebhookStatus: stalePreDispatch ? "pending" : "failed",
      expectedUpdatedAt: existing.updatedAt,
    });
    if (reclaimed !== false) {
      return {
        attemptId: existing.id,
        claimUpdatedAt,
        duplicate: null,
        reclaimed: true,
      };
    }

    const concurrent = await getDeliveryAttemptByIdempotencyKey(
      env,
      input.idempotencyKey,
    );
    return {
      attemptId: null,
      claimUpdatedAt: null,
      duplicate: concurrent ?? existing,
      reclaimed: false,
    };
  }

  const claimUpdatedAt = new Date().toISOString();
  try {
    const attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTargetId,
      lane: input.lane,
      channel: input.channel,
      provider: input.provider,
      status: quietHours ? "skipped_due_to_quiet_hours" : "pending",
      webhookStatus: quietHours ? "provider_unknown" : "pending",
      targetValue: input.targetValue,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: null,
      eventIds: input.eventIds,
      payloadSnapshot: input.payloadSnapshot,
      idempotencyKey: input.idempotencyKey,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      timestamp: claimUpdatedAt,
    });
    return {
      attemptId,
      claimUpdatedAt: quietHours ? null : claimUpdatedAt,
      duplicate: null,
      reclaimed: false,
    };
  } catch (error) {
    const concurrent = await getDeliveryAttemptByIdempotencyKey(
      env,
      input.idempotencyKey,
    );
    if (concurrent) {
      return {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: concurrent,
        reclaimed: false,
      };
    }
    throw error;
  }
}

function classifyInstantDeliveryOutcome(
  attempt: Pick<DeliveryAttemptRecord, "status" | "webhookStatus">,
): InstantDeliveryOutcome {
  if (attempt.status === "skipped_due_to_quiet_hours") {
    return "quiet_deferral";
  }
  if (attempt.status === "skipped_due_to_dedupe") {
    return "intentional_dedupe";
  }
  if (attempt.status === "sent" && attempt.webhookStatus !== "failed") {
    return "provider_accepted";
  }
  if (attempt.status === "failed" && attempt.webhookStatus === "failed") {
    return "definitive_terminal_failure";
  }
  if (
    attempt.status === "pending" ||
    attempt.webhookStatus === "pending" ||
    attempt.webhookStatus === "provider_unknown" ||
    attempt.webhookStatus === "legacy_unknown"
  ) {
    return "pending_provider_unknown";
  }
  throw new Error("Instant delivery attempt has an ambiguous durable outcome.");
}

function summarizeCurrentInstantAttempt(
  input: Omit<
    InstantAttemptSummary,
    "outcome" | "claimedByThisRun" | "duplicate" | "source"
  > & {
    webhookStatus: DeliveryAttemptRecord["webhookStatus"];
  },
): InstantAttemptSummary {
  const { webhookStatus, ...summary } = input;
  return {
    ...summary,
    outcome: classifyInstantDeliveryOutcome({
      status: summary.deferredByQuietHours
        ? "skipped_due_to_quiet_hours"
        : summary.status,
      webhookStatus,
    }),
    claimedByThisRun: true,
    duplicate: false,
    source: "current_claim",
  };
}

function summarizeDeliveryAttempt(
  attempt: DeliveryAttemptRecord,
  providerAttemptedByThisRun = false,
): InstantAttemptSummary {
  return {
    channel: attempt.channel,
    status: deliveryAttemptSummaryStatus(attempt.status),
    targetValue: attempt.targetValue,
    providerMessageId: attempt.providerMessageId,
    errorMessage: attempt.errorMessage,
    deliveredAt: confirmedDeliveryTimestamp(attempt),
    deferredByQuietHours: attempt.status === "skipped_due_to_quiet_hours",
    outcome: classifyInstantDeliveryOutcome(attempt),
    claimedByThisRun: false,
    providerAttemptedByThisRun,
    duplicate: true,
    source: "durable_attempt",
  };
}

async function beginInstantDeliveryDispatch(
  env: AppEnv,
  attempt: {
    attemptId: string | null;
    claimUpdatedAt: string | null;
    idempotencyKey: string;
  },
): Promise<{
  dispatchStartedAt: string | null;
  duplicate: DeliveryAttemptRecord | null;
}> {
  if (!attempt.attemptId || !attempt.claimUpdatedAt) {
    return { dispatchStartedAt: null, duplicate: null };
  }

  const provider = attempt.idempotencyKey.includes(":email:")
    ? EMAIL_PROVIDER
    : attempt.idempotencyKey.includes(":slack:")
      ? SLACK_PROVIDER
      : attempt.idempotencyKey.includes(":teams:")
        ? TEAMS_PROVIDER
        : "whatsapp_cloud_api";
  const dispatchStartedAt = env.DB
    ? await markInstantDeliveryDispatchStarted(
        env,
        attempt.attemptId,
        attempt.claimUpdatedAt,
      )
    : await markDeliveryAttemptProviderDispatch({
        attemptId: attempt.attemptId,
        provider,
        claimUpdatedAt: attempt.claimUpdatedAt,
        update: (attemptId, update) =>
          updateDeliveryAttemptResult(env, attemptId, update),
      });
  if (dispatchStartedAt) {
    return { dispatchStartedAt, duplicate: null };
  }

  const current = await getDeliveryAttemptByIdempotencyKey(env, attempt.idempotencyKey);
  if (!current) {
    throw new Error("Instant delivery dispatch claim disappeared.");
  }
  if (current.channel === "email" && current.status === "pending" && current.webhookStatus === "pending") {
    const cancelled = await cancelPendingEmailAttemptAfterDispatchLoss(env, {
      attemptId: attempt.attemptId,
      idempotencyKey: attempt.idempotencyKey,
      expectedUpdatedAt: attempt.claimUpdatedAt,
    });
    return { dispatchStartedAt: null, duplicate: cancelled };
  }
  return { dispatchStartedAt: null, duplicate: current };
}

async function finalizeInstantDeliveryAttempt(
  env: AppEnv,
  input: {
    attemptId: string;
    idempotencyKey: string;
    dispatchStartedAt: string | null;
    provider: string;
    status: "pending" | "sent" | "failed";
    webhookStatus:
      | "pending"
      | "delivered"
      | "failed"
      | "legacy_unknown"
      | "provider_unknown";
    providerMessageId: string | null;
    providerStatusLastSeenAt: string | null;
    templateName?: string | null;
    errorMessage: string | null;
    sentAt: string | null;
    failedAt: string | null;
  },
) {
  const finalized = await updateDeliveryAttemptResult(env, input.attemptId, {
    provider: input.provider,
    status: input.status,
    webhookStatus: input.webhookStatus,
    providerMessageId: input.providerMessageId,
    providerStatusLastSeenAt: input.providerStatusLastSeenAt,
    templateName: input.templateName ?? null,
    errorMessage: input.errorMessage,
    sentAt: input.sentAt,
    failedAt: input.failedAt,
    expectedStatus: input.dispatchStartedAt ? "pending" : undefined,
    expectedWebhookStatus: input.dispatchStartedAt ? "provider_unknown" : undefined,
    expectedUpdatedAt: input.dispatchStartedAt ?? undefined,
  });
  if (finalized !== false) return { won: true, attempt: null };

  const current = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  if (!current) {
    throw new Error("Instant delivery attempt disappeared during finalization.");
  }
  return { won: false, attempt: current };
}

function deliveryAttemptSummaryStatus(status: DeliveryAttemptRecord["status"]) {
  if (status === "sent") return "sent";
  if (status === "pending") return "pending";
  return "failed";
}

type InstantAlertBatch = {
  batchKey: string;
  events: WatchEventRecord[];
  provisional: boolean;
  deferredByQuietHours: boolean;
  allowedChannels: DeliveryChannel[];
};

type InstantAlertContent = {
  competitor: string;
  shortChange: string;
  subject: string;
  html: string;
  /**
   * Issue #2175 do-step 3: plain-text part parity — every fact the HTML
   * alert carries (mark, captures, criticality, meaning, proof state,
   * forward link) also renders in the text part.
   */
  text: string;
  watchlistUrl: string | null;
  /** E2 alert increment: why this alert matters, derived never invented. */
  materialityReason: string;
  /** E2 alert increment: exactly one accountable reviewer per alert. */
  reviewerLabel: string;
};

function buildInstantAlertBatches(input: {
  lane: DeliveryLane;
  events: WatchEventRecord[];
  workspaceConfig: WorkspaceDeliveryConfigRecord;
  watchlistConfig: WatchlistDeliveryConfigRecord | null;
}) {
  const batches = new Map<string, InstantAlertBatch>();

  for (const event of input.events) {
    const decision = evaluateDeliveryPolicy({
      lane: input.lane,
      event,
      workspaceConfig: input.workspaceConfig,
      watchlistConfig: input.watchlistConfig,
    });

    if (!decision.instantEligible && !decision.deferredByQuietHours) {
      continue;
    }

    const existing = batches.get(decision.batchKey) ?? {
      batchKey: decision.batchKey,
      events: [],
      provisional: false,
      deferredByQuietHours: false,
      allowedChannels: [...decision.allowedChannels],
    };
    existing.events.push(event);
    existing.provisional = existing.provisional || decision.provisional;
    existing.deferredByQuietHours =
      existing.deferredByQuietHours || decision.deferredByQuietHours;
    batches.set(decision.batchKey, existing);
  }

  return [...batches.values()];
}

function renderEventDiffHtml(
  event: WatchEventRecord,
  screenshotPair: { beforeUrl: string; afterUrl: string } | null = null,
) {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const from = typeof metadata.from === "string" ? metadata.from.trim() : "";
  const to = typeof metadata.to === "string" ? metadata.to.trim() : "";
  if (!from || !to) {
    return "";
  }
  const captures = resolveEventDiffCaptures(metadata);
  if (!captures) {
    return `
      <p style="margin: 0 0 16px; font-family: ${EMAIL_MONO_FONT}; font-size: 12px; color: ${EMAIL_CASE_INK_FAINT};">
        Before/Now comparison not shown because one or both capture times were unavailable or invalid.
      </p>
    `;
  }

  // Visual diff alert payload (2026-08-17): when the event's proof-capture
  // pair is on file, embed the stored before/after screenshots side by
  // side. The pair gate mirrors the watchlist event diff plate exactly —
  // both URLs must be present or the pair is skipped, never half a
  // side-by-side. URLs come from `proofScreenshotAbsoluteUrl` (HTTPS
  // validated by the producer), so the email `<img>` is safe to render
  // without further sanitization beyond `escapeHtml`.
  // BL-022: the screenshot pair carries the same capture timestamps as the
  // text rows below — sourced from the stored capture/scan record, never
  // email-build time, so the "when was this true?" question is answerable
  // on the visual diff too.
  const screenshotRow = screenshotPair
    ? `<tr>
          <td colspan="2" style="padding: 0 0 12px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; background-color: ${EMAIL_CASE_BONE};">
              <tr>
                <td style="padding: 0 8px 0 0; vertical-align: top; width: 50%;">
                  <p style="margin: 0 0 4px; font-family: ${EMAIL_MONO_FONT}; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: ${EMAIL_CASE_INK_FAINT};">Before</p>
                  <img src="${escapeHtml(screenshotPair.beforeUrl)}" alt="Before the change" width="280" style="display: block; max-width: 100%; width: 100%; border-radius: 0; border: 1px solid ${EMAIL_CASE_LINE}; background-color: ${EMAIL_CASE_CARD};">
                  <small style="font-family: ${EMAIL_MONO_FONT}; color: ${EMAIL_CASE_INK_FAINT};">Captured ${escapeHtml(formatEventCaptureTime(captures.beforeCapturedAt))}</small>
                </td>
                <td style="padding: 0; vertical-align: top; width: 50%;">
                  <p style="margin: 0 0 4px; font-family: ${EMAIL_MONO_FONT}; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: ${EMAIL_CASE_INK_FAINT};">Now</p>
                  <img src="${escapeHtml(screenshotPair.afterUrl)}" alt="After the change" width="280" style="display: block; max-width: 100%; width: 100%; border-radius: 0; border: 1px solid ${EMAIL_CASE_LINE}; background-color: ${EMAIL_CASE_CARD};">
                  <small style="font-family: ${EMAIL_MONO_FONT}; color: ${EMAIL_CASE_INK_FAINT};">Captured ${escapeHtml(formatEventCaptureTime(captures.nowCapturedAt))}</small>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : "";

  // The one fact the customer actually wants: what it said before, and now.
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 16px; border-collapse: collapse; font-size: 14px; background-color: ${EMAIL_CASE_BONE}; border: 1px solid ${EMAIL_CASE_LINE};">
      ${screenshotRow}
      <tr>
        <td style="padding: 8px 10px 8px 12px; color: ${EMAIL_CASE_INK_FAINT}; vertical-align: top; font-family: ${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Before</td>
        <td style="padding: 8px 12px; color: ${EMAIL_CASE_INK_SOFT};">${escapeHtml(from)}<br><small style="font-family: ${EMAIL_MONO_FONT}; color: ${EMAIL_CASE_INK_FAINT};">Captured ${escapeHtml(formatEventCaptureTime(captures.beforeCapturedAt))}</small></td>
      </tr>
      <tr>
        <td style="padding: 8px 10px 8px 12px; color: ${EMAIL_CASE_INK_FAINT}; vertical-align: top; font-family: ${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Now</td>
        <td style="padding: 8px 12px; color: ${EMAIL_CASE_INK};"><strong>${escapeHtml(to)}</strong><br><small style="font-family: ${EMAIL_MONO_FONT}; color: ${EMAIL_CASE_INK_FAINT};">Captured ${escapeHtml(formatEventCaptureTime(captures.nowCapturedAt))}</small></td>
      </tr>
    </table>
  `;
}

function renderEventDiffText(event: WatchEventRecord) {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const from = typeof metadata.from === "string" ? metadata.from.trim() : "";
  const to = typeof metadata.to === "string" ? metadata.to.trim() : "";
  if (!from || !to) return "";
  const captures = resolveEventDiffCaptures(metadata);
  return captures
    ? ` — was "${from}" (captured ${formatEventCaptureTime(captures.beforeCapturedAt)}), now "${to}" (captured ${formatEventCaptureTime(captures.nowCapturedAt)})`
    : " — changed values were recorded, but one or both capture times were unavailable or invalid.";
}

function resolveEventDiffCaptures(metadata: Record<string, unknown>) {
  const read = (keys: string[]) => {
    for (const key of keys) {
      const value = metadata[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  const beforeCapturedAt = read([
    "beforeCapturedAt",
    "fromCapturedAt",
    "previousCapturedAt",
    "baselineCapturedAt",
  ]);
  const nowCapturedAt = read(["capturedAt", "nowCapturedAt"]);
  const beforeMs = beforeCapturedAt ? Date.parse(beforeCapturedAt) : Number.NaN;
  const nowMs = nowCapturedAt ? Date.parse(nowCapturedAt) : Number.NaN;
  if (
    !beforeCapturedAt ||
    !nowCapturedAt ||
    !Number.isFinite(beforeMs) ||
    !Number.isFinite(nowMs) ||
    beforeMs >= nowMs
  ) {
    return null;
  }
  return { beforeCapturedAt, nowCapturedAt };
}

function formatEventCaptureTime(value: string) {
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

// Fetches the ads referenced by alert events in one batched call. A missing
// thumbnail must never block an alert, so lookup failures degrade to no image.
async function loadAlertAdsById(env: AppEnv, events: WatchEventRecord[]) {
  const adIds = events
    .map((event) => event.adId)
    .filter((adId): adId is string => Boolean(adId));

  if (adIds.length === 0) {
    return new Map<string, AdRecord>();
  }

  try {
    const ads = await listAdsByIds(env, adIds);
    return new Map(ads.map((ad) => [ad.metaAdId, ad]));
  } catch {
    return new Map<string, AdRecord>();
  }
}

/**
 * P1 evidence truth (2026-08-10): resolves every alert event to its customer
 * evidence state via the shared render contract, using one bounded batched
 * query over the referenced proof captures. An event with no resolvable
 * capture pair stays unverified — the contract fails closed, so missing,
 * failed, or unordered evidence can never claim a verified move. A lookup
 * failure (or a test adapter without the helper) degrades to no evidence,
 * which makes the alert provisional — never blocks delivery and never
 * invents evidence.
 */
async function loadAlertEvidenceStates(
  env: AppEnv,
  userId: string,
  events: WatchEventRecord[],
): Promise<Map<string, CustomerEvidenceState>> {
  const states = new Map<string, CustomerEvidenceState>();
  // The whole resolution is fail-closed: a missing helper on a test adapter
  // (strict mocks throw on property access) or a failed lookup degrades to
  // no evidence, which makes the alert provisional — it never blocks
  // delivery and never invents evidence.
  let pairs: Awaited<ReturnType<typeof deliveryData.listProofCapturePairsForEventIds>> = [];
  try {
    const listPairs = deliveryData.listProofCapturePairsForEventIds;
    if (typeof listPairs !== "function") {
      return states;
    }
    pairs = await listPairs(env, userId, events.map((event) => event.id));
  } catch {
    return states;
  }
  const byEventId = new Map(pairs.map((pair) => [pair.eventId, pair]));
  for (const event of events) {
    const pair = byEventId.get(event.id) ?? null;
    states.set(
      event.id,
      resolveCustomerEvidenceState({
        event,
        proofCapture: pair?.current ?? null,
        beforeCapturedAt: pair?.previous
          ? (pair.previous.succeededAt ?? pair.previous.attemptedAt)
          : null,
        nowCapturedAt: pair?.current
          ? (pair.current.succeededAt ?? pair.current.attemptedAt)
          : null,
      }),
    );
  }
  return states;
}

/**
 * Visual diff alert payload (2026-08-17): resolves the screenshot pair
 * (current + previous succeeded capture with a stored
 * `screenshotArtifactKey`) for every alert event in one bounded batched
 * query. The result is keyed by `eventId` and only contains entries with
 * BOTH URLs present — the same pair gate the watchlist event diff plate
 * uses, so the renderer never has to decide whether to render a half-pair.
 * A missing helper on a test adapter or a failed lookup degrades to an
 * empty map, which makes the alert text-only — never blocks delivery,
 * never invents an image.
 */
async function loadAlertScreenshotPairs(
  env: AppEnv,
  userId: string,
  events: WatchEventRecord[],
): Promise<Map<string, { beforeUrl: string; afterUrl: string }>> {
  const pairs = new Map<string, { beforeUrl: string; afterUrl: string }>();
  // Mirrors `loadAlertEvidenceStates`: strict-mock test adapters throw on
  // missing property access, so the lookup is wrapped in try/catch and the
  // empty-map fallback keeps the alert text-only — never blocks delivery,
  // never invents an image.
  let rows: Awaited<ReturnType<typeof deliveryData.listProofCapturePairsForEventIds>> = [];
  try {
    const listPairs = deliveryData.listProofCapturePairsForEventIds;
    if (typeof listPairs !== "function") {
      return pairs;
    }
    rows = await listPairs(env, userId, events.map((event) => event.id));
  } catch {
    return pairs;
  }
  for (const row of rows) {
    const beforeUrl = proofScreenshotAbsoluteUrl(
      env,
      row.previous?.screenshotArtifactKey ?? null,
    );
    const afterUrl = proofScreenshotAbsoluteUrl(
      env,
      row.current?.screenshotArtifactKey ?? null,
    );
    if (!beforeUrl || !afterUrl) {
      continue;
    }
    pairs.set(row.eventId, { beforeUrl, afterUrl });
  }
  return pairs;
}

// One creative image per alert email: the primary event's, only when a real
// https creative URL was captured. Silent skip otherwise — no placeholders.
function renderCreativeImageHtml(
  event: WatchEventRecord,
  adsById: Map<string, AdRecord> | undefined,
) {
  const ad = event.adId ? adsById?.get(event.adId) : null;
  const imageUrl = ad?.creativeImageUrl?.trim();
  if (!imageUrl || !/^https:\/\//i.test(imageUrl)) {
    return "";
  }

  return `<img src="${escapeHtml(imageUrl)}" alt="Ad creative" width="280" style="display: block; max-width: 100%; width: 280px; border-radius: 0; border: 1px solid ${EMAIL_CASE_LINE}; background-color: ${EMAIL_CASE_CARD}; margin: 12px 0;">`;
}

export function renderPresenceDigestHtml(input: {
  lines: string[];
  appUrl: string;
}) {
  const htmlLines = input.lines
    .map(
      (line) =>
        `<li style="margin: 0 0 8px; color: ${EMAIL_CASE_INK_SOFT};">${escapeHtml(line)}</li>`,
    )
    .join("");
  return `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: ${EMAIL_CASE_CARD}; color: ${EMAIL_CASE_INK}; font-size: 15px; line-height: 1.6;">
        <p style="${EMAIL_CASE_EYEBROW_STYLE}">Presence digest</p>
        <h1 style="${EMAIL_CASE_H1_STYLE}">Where your competitors showed up</h1>
        <ul style="margin: 0 0 24px; padding-left: 20px;">${htmlLines}</ul>
        <p style="margin: 0;">
          <a href="${escapeHtml(input.appUrl)}" style="${EMAIL_CASE_BUTTON_STYLE}">Open presence tracking</a>
        </p>
      </div>
    `;
}

export function buildInstantAlertContent(
  watchlist: Pick<WatchlistRecord, "id" | "name">,
  events: WatchEventRecord[],
  provisional: boolean,
  env: AppEnv,
  adsById?: Map<string, AdRecord>,
  reviewerLabel?: string | null,
  evidenceByEventId?: ReadonlyMap<string, CustomerEvidenceState> | null,
  screenshotPairsByEventId?: ReadonlyMap<
    string,
    { beforeUrl: string; afterUrl: string }
  > | null,
  briefOptions: {
    /** Issue #2175 do-step 3: share-view forward link (plan-gated upstream). */
    forwardUrl?: string | null;
    /** Workspace delivery timezone for the subject's captured-at suffix. */
    timeZone?: string | null;
  } = {},
): InstantAlertContent {
  const primaryEvent = events[0];
  const competitor = readCompetitorLabel(primaryEvent) ?? watchlist.name;
  // WP-24: deep-link the primary change so "See the evidence" lands on the row.
  const watchlistUrl = buildWatchlistUrl(env, watchlist.id, primaryEvent?.id ?? null);
  const creativeImageHtml = renderCreativeImageHtml(primaryEvent, adsById);
  // Visual diff alert payload (2026-08-17): resolve the primary event's
  // stored before/after screenshot pair (same pair gate the watchlist event
  // diff plate uses). An absent or partial pair stays unrendered —
  // `renderEventDiffHtml` falls back to its existing text-only output,
  // never half a side-by-side.
  const primaryScreenshotPair = primaryEvent
    ? screenshotPairsByEventId?.get(primaryEvent.id) ?? null
    : null;
  // E2 alert increment (2026-08-08): every alert carries a named owner and a
  // materiality reason before delivery. The reviewer is the workspace owner
  // identity (truthful "Workspace owner" fallback, never invented from
  // watchlist/event text); the materiality reason is derived from the filed
  // events — provisional alerts say they are unconfirmed, baseline snapshots
  // say they are starting points, confirmed changes say what moved.
  const reviewer = digestReviewerLabel(reviewerLabel);
  const baseline =
    events.length === 1 &&
    ((primaryEvent.metadata ?? {}) as Record<string, unknown>).kind === "baseline";
  // P1 (2026-08-10): only events whose evidence resolves to a verified change
  // may contribute confirmed materiality copy. A confirmed status alone is a
  // claim, not evidence — without a succeeded, ordered capture pair the alert
  // stays provisional, and mixed batches derive copy from verified items only
  // so one evidenced event never inflates a batch of unverified ones.
  const verifiedEvents = events.filter(
    (event) => evidenceByEventId?.get(event.id) === "verified_change",
  );
  const materialityReason = alertMaterialityReason({
    events: verifiedEvents,
    provisional: provisional || (!baseline && verifiedEvents.length === 0),
    baseline,
  });
  const accountabilityBlock = renderEmailAccountabilityBlock({
    materialityReason,
    reviewerLabel: reviewer,
  });

  if (events.length === 1) {
    const isBaseline =
      ((primaryEvent.metadata ?? {}) as Record<string, unknown>).kind === "baseline";
    // Issue #2175 do-step 2: a confirmed change alert leads with the change
    // itself — competitor, what moved, when it was captured — never a count.
    // Provisional and baseline alerts keep their own honest subjects.
    const subject = provisional
      ? `Possible change at ${competitor}`
      : isBaseline
        ? primaryEvent.title
        : buildChangeLeadSubject({
            competitor,
            eventType: primaryEvent.eventType,
            title: primaryEvent.title,
            metadata: (primaryEvent.metadata ?? {}) as Record<string, unknown>,
            timeZone: briefOptions.timeZone,
            capturedAtFallback:
              primaryEvent.confirmedAt ?? primaryEvent.createdAt ?? null,
          });
    const shortChange = provisional
      ? "Possible change detected"
      : primaryEvent.title;
    const intelligence = buildChangeIntelligenceSummary(primaryEvent);
    const advertiserNote = readCompetitorLabel(primaryEvent)
      ? `<p style="margin: 0 0 10px; font-family: ${EMAIL_MONO_FONT}; font-size: 12px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_FAINT};">Advertiser: ${escapeHtml(competitor)}</p>`
      : "";
    // Issue #2175 do-step 1: the alert row carries the criticality band with
    // its reasons, one deterministic "what this usually means" line, and —
    // when no before/after screenshot pair (or creative image) is shown — the
    // honest reason why. All derived from stored facts, never invented.
    const briefFactInput = {
      eventType: primaryEvent.eventType,
      metadata: (primaryEvent.metadata ?? {}) as Record<string, unknown>,
      title: primaryEvent.title,
    };
    const diffHtml = renderEventDiffHtml(primaryEvent, primaryScreenshotPair);
    const showsScreenshots = diffHtml.includes("<img");
    const showsCreative = creativeImageHtml.length > 0;
    const evidenceState = evidenceByEventId?.get(primaryEvent.id) ?? null;
    const briefNoScreenshotReason =
      showsScreenshots || showsCreative
        ? null
        : changeBriefNoScreenshotReason({
            eventType: primaryEvent.eventType,
            metadata: briefFactInput.metadata,
            proofStatus:
              evidenceState === "verified_change"
                ? "verified_proof"
                : evidenceState === "check_failed"
                  ? "proof_failed"
                  : null,
            provisional: provisional || evidenceState === "provisional_signal",
          });
    const briefCriticalityText = changeBriefCriticalityLine(
      readChangeBriefCriticality(briefFactInput),
    );
    const briefMeaningText = changeBriefMeaningLine(briefFactInput);
    const briefFactsHtml = `
          <p style="margin: 0 0 6px; font-family: ${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_SOFT};">${escapeHtml(briefCriticalityText)}</p>
          <p style="margin: 0 0 16px; color: ${EMAIL_CASE_INK_SOFT}; font-size: 13px;"><em>${escapeHtml(briefMeaningText)}</em></p>
          ${briefNoScreenshotReason ? `<p style="margin: 0 0 16px; color: ${EMAIL_CASE_INK_SOFT}; font-size: 12px;">${escapeHtml(briefNoScreenshotReason)}</p>` : ""}`;
    const forwardHtml = renderInstantForwardHtml(briefOptions.forwardUrl);
    const diffText = renderEventDiffText(primaryEvent);

    return {
      competitor,
      shortChange,
      subject,
      watchlistUrl,
      materialityReason,
      reviewerLabel: reviewer,
      html: `
        <div style="font-family: Inter, system-ui, sans-serif; background-color: ${EMAIL_CASE_CARD}; color: ${EMAIL_CASE_INK}; line-height: 1.5;">
          <p style="${EMAIL_CASE_EYEBROW_STYLE}">Instant alert · ${escapeHtml(provisional ? "provisional" : "live")}</p>
          <h1 style="${EMAIL_CASE_H1_STYLE}">${escapeHtml(subject)}</h1>
          ${advertiserNote}
          <p style="margin: 0 0 8px; color: ${EMAIL_CASE_INK_SOFT};">${escapeHtml(primaryEvent.summary)}</p>
          <p style="margin: 0 0 6px; font-family: ${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${EMAIL_CASE_INK_FAINT};">${escapeHtml(intelligence.priorityBand)}</p>
          <p style="margin: 0 0 16px; color: ${EMAIL_CASE_INK};"><strong>Suggested next action:</strong> ${escapeHtml(intelligence.recommendedAction)}</p>
          ${accountabilityBlock}
          ${diffHtml}
          ${creativeImageHtml}
          ${briefFactsHtml}
          ${watchlistUrl ? `<p style="margin: 16px 0 0;"><a href="${watchlistUrl}" style="${EMAIL_CASE_BUTTON_STYLE}">See the evidence</a></p>` : ""}
          ${forwardHtml}
        </div>
      `,
      text: [
        subject,
        "",
        readCompetitorLabel(primaryEvent) ? `Advertiser: ${competitor}` : null,
        primaryEvent.summary,
        `Priority: ${intelligence.priorityBand}`,
        `Suggested next action: ${intelligence.recommendedAction}`,
        `Why this matters: ${materialityReason}`,
        `Accountable reviewer: ${reviewer}`,
        diffText ? `What changed${diffText}` : null,
        briefCriticalityText,
        `What this usually means: ${briefMeaningText}`,
        briefNoScreenshotReason,
        watchlistUrl ? `See the evidence: ${watchlistUrl}` : null,
        briefOptions.forwardUrl
          ? `Forward this change to a teammate or client: ${briefOptions.forwardUrl}`
          : null,
      ]
        .filter((line): line is string => typeof line === "string" && line.length > 0)
        .join("\n"),
    };
  }

  // Issue #2175 do-step 2: a confirmed batch leads with its single most
  // critical change (highest criticality score, first event breaks ties),
  // never a count. Provisional batches keep their honest subject.
  const leadEvent = mostCriticalAlertEvent(events);
  const subject = provisional
    ? `Possible changes at ${competitor}`
    : buildChangeLeadSubject({
        competitor,
        eventType: leadEvent.eventType,
        title: leadEvent.title,
        metadata: (leadEvent.metadata ?? {}) as Record<string, unknown>,
        timeZone: briefOptions.timeZone,
        capturedAtFallback: leadEvent.confirmedAt ?? leadEvent.createdAt ?? null,
      });

  // Mirror the single-event gate: only claim an advertiser when real advertiser
  // metadata exists — never present the watchlist name as an advertiser.
  const batchedAdvertiserNote = readCompetitorLabel(primaryEvent)
    ? `<p style="margin: 0 0 12px; font-family: ${EMAIL_MONO_FONT}; font-size: 12px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_FAINT};">Advertiser: ${escapeHtml(competitor)}</p>`
    : "";
  const forwardHtml = renderInstantForwardHtml(briefOptions.forwardUrl);

  return {
    competitor,
    shortChange: `${events.length} watchlist changes`,
    subject,
    watchlistUrl,
    materialityReason,
    reviewerLabel: reviewer,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: ${EMAIL_CASE_CARD}; color: ${EMAIL_CASE_INK}; line-height: 1.5;">
        <p style="${EMAIL_CASE_EYEBROW_STYLE}">Instant alert · ${escapeHtml(provisional ? "provisional" : "live")}</p>
        <h1 style="${EMAIL_CASE_H1_STYLE}">${escapeHtml(subject)}</h1>
        ${batchedAdvertiserNote}
        ${accountabilityBlock}
        ${creativeImageHtml}
        <div style="${EMAIL_CASE_CARD_STYLE}">
          ${events
            .map((event, index) => {
              const intelligence = buildChangeIntelligenceSummary(event);
              // Issue #2175 do-step 1: every batched change row carries its
              // criticality band + reasons and the deterministic "what this
              // usually means" line (stored facts only, no LLM).
              const briefFactInput = {
                eventType: event.eventType,
                metadata: (event.metadata ?? {}) as Record<string, unknown>,
                title: event.title,
              };
              const dotted =
                index < events.length - 1
                  ? `; border-bottom: 1px dotted ${EMAIL_CASE_LINE}`
                  : "";
              return `
                <div style="padding: 6px 0;${dotted}">
                  <strong>${escapeHtml(event.title)}</strong>
                  <span style="display:block; font-family: ${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${EMAIL_CASE_INK_FAINT}; margin: 2px 0 4px;">${escapeHtml(intelligence.priorityBand)}</span>
                  <span style="color: ${EMAIL_CASE_INK_SOFT};">${escapeHtml(event.summary)}${escapeHtml(renderEventDiffText(event))}</span>
                  <span style="display:block; margin-top: 4px; font-family: ${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_SOFT};">${escapeHtml(changeBriefCriticalityLine(readChangeBriefCriticality(briefFactInput)))}</span>
                  <span style="display:block; margin-top: 4px; color: ${EMAIL_CASE_INK_SOFT};"><em>${escapeHtml(changeBriefMeaningLine(briefFactInput))}</em></span>
                  <span style="display:block; margin-top: 4px; color: ${EMAIL_CASE_INK};"><strong>Suggested next action:</strong> ${escapeHtml(intelligence.recommendedAction)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
        ${watchlistUrl ? `<p style="margin: 20px 0 0;"><a href="${watchlistUrl}" style="${EMAIL_CASE_BUTTON_STYLE}">View watchlist</a></p>` : ""}
        ${forwardHtml}
      </div>
    `,
    text: [
      subject,
      "",
      `Why this matters: ${materialityReason}`,
      `Accountable reviewer: ${reviewer}`,
      "",
      ...events.flatMap((event, index) => {
        const intelligence = buildChangeIntelligenceSummary(event);
        const briefFactInput = {
          eventType: event.eventType,
          metadata: (event.metadata ?? {}) as Record<string, unknown>,
          title: event.title,
        };
        return [
          `${index + 1}. ${event.title} — ${event.summary}${renderEventDiffText(event)}`,
          `   ${changeBriefCriticalityLine(readChangeBriefCriticality(briefFactInput))}`,
          `   What this usually means: ${changeBriefMeaningLine(briefFactInput)}`,
          `   Suggested next action: ${intelligence.recommendedAction}`,
        ];
      }),
      "",
      watchlistUrl ? `View watchlist: ${watchlistUrl}` : null,
      briefOptions.forwardUrl
        ? `Forward this change to a teammate or client: ${briefOptions.forwardUrl}`
        : null,
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n"),
  };
}

/**
 * The batch's most critical event by the shared change-brief scorer (stored
 * band wins for website-page events). Ties break to the earliest event so the
 * subject is deterministic for identical batches.
 */
function mostCriticalAlertEvent(events: WatchEventRecord[]): WatchEventRecord {
  let best = events[0];
  let bestScore = -1;
  for (const event of events) {
    const criticality = readChangeBriefCriticality({
      eventType: event.eventType,
      metadata: (event.metadata ?? {}) as Record<string, unknown>,
    });
    const score = criticality.score ?? -1;
    if (score > bestScore) {
      best = event;
      bestScore = score;
    }
  }
  return best;
}

/** Issue #2175 do-step 3: the alert's one-click forward line (HTML part). */
function renderInstantForwardHtml(forwardUrl: string | null | undefined) {
  const url = forwardUrl?.trim();
  if (!url) {
    return "";
  }
  return `<p style="margin: 12px 0 0; font-family: ${EMAIL_MONO_FONT}; font-size: 12px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_SOFT};">Forward this change to a teammate or client: <a href="${escapeHtml(url)}" style="color: ${EMAIL_CASE_GREEN_INK}; font-weight: 700; text-decoration: underline;">open the share view →</a></p>`;
}

function renderInstantSlackText(content: InstantAlertContent, events: WatchEventRecord[]) {
  const lines = [
    `*${escapeSlackText(content.subject)}*`,
  ];

  for (const event of events.slice(0, 6)) {
    lines.push(
      `• ${escapeSlackText(event.title)}: ${escapeSlackText(event.summary)}${escapeSlackText(renderEventDiffText(event))}`,
    );
  }

  if (events.length > 6) {
    lines.push(`+${events.length - 6} more changes.`);
  }

  // E2 alert increment (2026-08-08): Slack alerts carry the same named owner
  // and materiality reason as the email — before delivery, on every channel.
  lines.push(
    `Why this matters: ${escapeSlackText(content.materialityReason)}`,
    `Accountable reviewer: ${escapeSlackText(content.reviewerLabel)}`,
  );

  if (content.watchlistUrl) {
    lines.push(`<${content.watchlistUrl}|View watchlist>`);
  }

  return lines.join("\n");
}

/**
 * Teams connector text is Markdown (unlike Slack's Mrkdwn link syntax), so
 * deep links use the [label](url) form. Copy mirrors Slack exactly: the
 * subject carries the honest provisional label ("Possible change at …" when
 * the change is not yet confirmed), the materiality reason and accountable
 * reviewer ride along, and the deep link lands on the watchlist row.
 */
function renderInstantTeamsText(content: InstantAlertContent, events: WatchEventRecord[]) {
  const lines = [
    `**${escapeSlackText(content.subject)}**`,
  ];

  for (const event of events.slice(0, 6)) {
    lines.push(
      `• ${escapeSlackText(event.title)}: ${escapeSlackText(event.summary)}${escapeSlackText(renderEventDiffText(event))}`,
    );
  }

  if (events.length > 6) {
    lines.push(`+${events.length - 6} more changes.`);
  }

  lines.push(
    `**Why this matters:** ${escapeSlackText(content.materialityReason)}`,
    `**Accountable reviewer:** ${escapeSlackText(content.reviewerLabel)}`,
  );

  if (content.watchlistUrl) {
    lines.push(`[View watchlist](${content.watchlistUrl})`);
  }

  return lines.join("\n");
}

function readCompetitorLabel(event: WatchEventRecord) {
  const advertiser = event.metadata.advertiser;
  return typeof advertiser === "string" && advertiser.trim().length > 0 ? advertiser : null;
}

function buildWatchlistUrl(
  env: AppEnv,
  watchlistId: string,
  eventId?: string | null,
) {
  const baseUrl = env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/app/watchlists?watchlist=${encodeURIComponent(watchlistId)}`;
  const trimmedEventId = eventId?.trim();
  return trimmedEventId
    ? `${url}&event=${encodeURIComponent(trimmedEventId)}`
    : url;
}

function dedupeTargetsByValue(targets: DeliveryTargetRecord[]) {
  const deduped = new Map<string, DeliveryTargetRecord>();
  for (const target of targets) {
    deduped.set(`${target.channel}:${target.targetValue.trim().toLowerCase()}`, target);
  }
  return [...deduped.values()];
}


export async function sendPresenceDigestEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    subject: string;
    lines: string[];
    idempotencyKey: string;
  },
) {
  const { buildUnsubscribeUrl } = await import("~/lib/unsubscribe.server");

  // Every exit reports the same {accepted, delivered} shape main introduced,
  // because presence-digest.server.ts reads both fields off the result. A bare
  // `false` would make delivery.accepted undefined and silently downgrade every
  // one of these outcomes to "send_failed".
  const notSent = { accepted: false, delivered: false };

  const normalized = input.email.trim().toLowerCase();
  if (!normalized) return notSent;
  const targets = await listDeliveryTargets(env, input.userId, {
    watchlistId: null,
    channel: "email",
    limit: 10,
  });
  const matchingTargets = targets.filter(
    (target) => target.targetValue.trim().toLowerCase() === normalized,
  );
  let deliveryTarget =
    matchingTargets.find(
      (target) =>
        target.isOptedIn &&
        !target.optedOutAt &&
        !target.isPaused &&
        target.isValidated &&
        target.validationStatus === "validated",
    ) ?? null;
  if (!deliveryTarget && matchingTargets.length > 0) {
    return notSent;
  }
  deliveryTarget ??= await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, {
    userId: input.userId,
    targetValue: normalized,
    optInSource: AUTO_PROVISIONED_EMAIL_SOURCE,
    metadata: { autoProvisioned: true, purpose: "presence_digest" },
  });
  if (!deliveryTarget) return notSent;

  const unsubscribeUrl = await buildUnsubscribeUrl(env, {
    userId: input.userId,
    targetId: deliveryTarget.id,
  });

  const bodyHtml = renderPresenceDigestHtml({
    lines: input.lines,
    appUrl: buildPresenceAppUrl(env),
  });
  const payloadSnapshot = {
    kind: "presence_digest",
    lineCount: input.lines.length,
  };
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    deliveryTargetId: deliveryTarget.id,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: normalized,
    templateName: "presence_digest",
    eventIds: [],
    payloadSnapshot,
    idempotencyKey: input.idempotencyKey,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    // A duplicate claim means someone else already owns this send. Report its
    // real outcome rather than a bare boolean, so an already-confirmed duplicate
    // is not downgraded to "unconfirmed".
    const duplicate = claim.duplicate;
    if (!duplicate) return notSent;
    return {
      accepted: duplicate.status === "sent",
      delivered:
        confirmedDeliveryTimestamp({
          webhookStatus: duplicate.webhookStatus,
          providerStatusLastSeenAt: duplicate.providerStatusLastSeenAt,
          sentAt: duplicate.sentAt,
        }) !== null,
    };
  }

  const dispatchStartedAt = await markInstantDeliveryDispatchStarted(
    env,
    claim.attemptId,
    claim.claimUpdatedAt,
  );
  if (!dispatchStartedAt) return notSent;

  const providerResult = await sendCloudflareEmail(env, {
    to: normalized,
    subject: input.subject,
    // The single shell comes from sendCloudflareEmail's case-file theme (the
    // pre-existing double-wrap here wrapped a full shell inside another shell;
    // passing the bare body gives the digest family one coherent frame).
    html: bodyHtml,
    tag: "presence-digest",
    unsubscribeUrl,
    theme: "case-file",
    preheader: "Presence tracking updates from Five to Nine",
  });
  const sentAt = providerAcceptedAt(providerResult);

  const finalized = await updateDeliveryAttemptResult(env, claim.attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    payloadSnapshot,
    targetValue: normalized,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
  });

  return {
    // `finalized === false` means the attempt row could not be written, so we
    // must not report acceptance we cannot evidence (this branch's fix), while
    // `delivered` stays main's provider-confirmation truth.
    accepted: finalized !== false && providerResult.status === "sent",
    delivered:
      confirmedDeliveryTimestamp({
        webhookStatus: providerResult.webhookStatus,
        providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
        sentAt,
      }) !== null,
  };
}

function buildPresenceAppUrl(env: AppEnv) {
  const baseUrl = env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim() || "https://0509.io";
  return `${baseUrl.replace(/\/+$/, "")}/app/presence`;
}

/**
 * Issue #2422: auto-file one monthly report per workspace, so the customer
 * never has to build one by hand.
 *
 * Reports were manual-only — a 765-line builder route behind Deliver → Reports
 * — while the digest pipeline already assembles the same decision-ladder
 * content on a schedule. For a small book of business a build-it-yourself
 * report is a feature nobody runs.
 *
 * Reuse-first, per the issue and its binding judge edits: the document comes
 * from the existing `report-builder.server.ts`, the payload from the existing
 * report-approval snapshot, the link from the existing `createShareLink`, and
 * the email from THIS module's existing claim → dispatch → finalize path with
 * the existing Cloudflare sender. No new sender, no new mechanism, no new cron
 * — a fifth wrangler schedule would escape the release-soak CHECK that accepts
 * only the four production crons.
 *
 * Idempotency is the point of the ticket. The weekly cron fires four to five
 * times a month, so "monthly on a weekly slot" needs a gate or it is a coin
 * flip. The gate is the workspace's own monthly-report share link
 * (`resource_type='report'`, `resource_id='report-monthly:<YYYY-MM>'`), read
 * before any build: present means the UTC month is already filed, so a cron
 * retry and a second weekly slot in the same month are both no-ops.
 */

/** UTC month key (`YYYY-MM`) that a run belongs to. */
export function utcMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Stable per-workspace-per-month report id; the idempotency key of the job. */
export function monthlyReportResourceId(monthKey: string): string {
  return `report-monthly:${monthKey}`;
}

export interface MonthlyReportRunResult {
  attempted: number;
  filed: number;
  duplicates: number;
  skipped: number;
  failed: number;
}

/**
 * Customer copy follows `docs/customer-information-architecture.md`: decision
 * first, supporting evidence second, no internal implementation labels, and no
 * invented numbers — the count is the filed report's own row count.
 */
export function buildMonthlyReportEmail(input: {
  name: string | null;
  monthLabel: string;
  changeCount: number;
  shareUrl: string;
}) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
  const changeLabel = input.changeCount === 1 ? "change" : "changes";
  const subject = `Your ${input.monthLabel} report is ready — ${input.changeCount} ${changeLabel}`;
  const preheader = `${input.changeCount} ${changeLabel} with proof status and next actions, already filed for you.`;
  const html = `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #fffdf8; color: #171611; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="${EMAIL_CASE_EYEBROW_STYLE}">Your ${escapeHtml(input.monthLabel)} report</p>
      <p style="margin: 0 0 4px; font-family: ${EMAIL_DISPLAY_FONT}; font-size: 44px; line-height: 1.05; font-weight: 800; letter-spacing: -1px; color: ${EMAIL_CASE_INK};">${input.changeCount}</p>
      <p style="margin: 0 0 20px; font-size: 18px; line-height: 1.3; letter-spacing: -0.3px; color: ${EMAIL_CASE_INK}; font-weight: 700;">${changeLabel} in ${escapeHtml(input.monthLabel)}, ready to review</p>
      <p style="margin: 0 0 16px; color: ${EMAIL_CASE_INK_SOFT};">We file this report for you at the start of every month. No proof, no claim — every line is backed by a stored capture.</p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.shareUrl)}" style="${EMAIL_CASE_BUTTON_STYLE}">Open your report</a>
      </p>
      <p style="margin: 0; font-family: ${EMAIL_MONO_FONT}; font-size: 12px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_FAINT};">
        This link is a read-only snapshot. You can still build any report by hand
        from Deliver → Reports.
      </p>
    </div>
  `;
  const text = [
    input.name?.trim() ? `Hi ${input.name.trim()},` : "Hi,",
    "",
    `Your ${input.monthLabel} report is ready: ${input.changeCount} ${changeLabel}.`,
    "We file this report for you at the start of every month. No proof, no claim.",
    "",
    `Open your report: ${input.shareUrl}`,
  ].join("\n");

  return { subject, preheader, html, text };
}

function formatMonthlyReportMonthLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Paid workspaces only (Nish decision): Free gets nothing recurring. Excluded
 * in the same query rather than filtered after the fact, matching
 * `listPaidUsersForRecap` so both monthly customer jobs see one population.
 */
export async function listPaidWorkspacesForMonthlyReport(env: AppEnv) {
  const rows = await queryAll<{ user_id: string; email: string; name: string | null; plan: string }>(
    env,
    `
      SELECT
        user_plan.user_id AS user_id,
        user.email AS email,
        user.name AS name,
        user_plan.plan AS plan
      FROM user_plan
      INNER JOIN user ON user.id = user_plan.user_id
      WHERE user_plan.plan IN ('scout', 'starter', 'agency')
        AND user.email IS NOT NULL
        AND TRIM(user.email) != ''
      ORDER BY user_plan.user_id ASC
    `,
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    plan: row.plan,
  }));
}

/**
 * The month gate: "build only when no report exists for the current UTC
 * month". Reports are built on demand and never stored as rows, so the durable
 * per-month artefact is the share link minted for that month.
 *
 * The predicate must match the read that decides reuse in
 * `sendOneMonthlyReport` — including `expires_at` — or the two disagree: a link
 * whose 90-day TTL has lapsed would still count as "filed" here and silently
 * suppress the month, while the reuse read would correctly find nothing.
 */
async function hasMonthlyReportShare(env: AppEnv, userId: string, monthKey: string) {
  const row = await queryOne<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM share_link
      WHERE user_id = ?
        AND resource_type = 'report'
        AND resource_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `,
    userId,
    monthlyReportResourceId(monthKey),
    new Date().toISOString(),
  );
  return Number(row?.count ?? 0) > 0;
}

/**
 * Build the workspace's monthly report snapshot, or null when there is nothing
 * worth filing. Reuses the same builder + snapshot the manual reports route
 * uses, so a filed report is identical to one built by hand.
 */
async function buildMonthlyReportSnapshot(env: AppEnv, userId: string) {
  const { listAdsByIds, listProofCapturePairsForEventIds, listWatchEvents, listWatchlists } =
    await import("~/lib/data.server");
  const watchlist =
    (await listWatchlists(env, userId)).find((candidate) => candidate.isActive !== false) ??
    null;
  if (!watchlist) return null;

  const events = await listWatchEvents(env, watchlist.id, 60);
  if (events.length === 0) return null;

  const adIds = events
    .map((event) => event.adId)
    .filter((adId): adId is string => typeof adId === "string" && adId.length > 0);
  const [ads, proofCapturePairs] = await Promise.all([
    listAdsByIds(env, adIds),
    listProofCapturePairsForEventIds(
      env,
      userId,
      events.map((event) => event.id),
      { includePrevious: false },
    ),
  ]);

  const { buildWatchlistReport } = await import("~/lib/report-builder.server");
  const report = buildWatchlistReport({
    watchlist,
    events,
    adsById: new Map(ads.map((ad) => [ad.metaAdId, ad])),
    proofCapturesByEventId: new Map(
      proofCapturePairs.map((pair) => [pair.eventId, pair.current]),
    ),
  });

  // The same sanitizing snapshot the manual share action mints: identity is
  // stripped so a leaked link cannot be walked back to the workspace's own
  // report ids.
  const { createApprovedReportSnapshot } = await import("~/lib/report-approval");
  const snapshot = createApprovedReportSnapshot({
    ...(JSON.parse(JSON.stringify(report)) as typeof report),
    reportId: "shared-report",
    resourceId: "shared",
  });
  return snapshot ? { report, snapshot } : null;
}

type MonthlyReportOutcome =
  | "sent"
  | "duplicate"
  | "nothing_to_file"
  | "unverified"
  | "disabled"
  | "missing_email"
  | "share_failed"
  | "failed";

/**
 * Mint the month's share link under its deterministic id.
 *
 * `createShareLink` with an explicit id uses INSERT OR IGNORE and then rejects
 * the row as `share_link_inactive` if it is not live (revoked, or past the
 * 90-day default TTL). Because the id is deterministic, a dead row would
 * otherwise make that month permanently unfileable — every later cron tick
 * would take the error branch and page, with no way to clear it. So on that one
 * rejection, mint under a fresh id: a new live row for the same month is the
 * correct outcome (the month is not yet filed), and a superseded dead row is
 * harmless.
 */
async function mintMonthlyReportShare(
  env: AppEnv,
  userId: string,
  monthKey: string,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const session = systemShareSession(userId);
  const resourceId = monthlyReportResourceId(monthKey);
  try {
    return (
      await deliveryData.createShareLink(env, session, {
        id: `${resourceId}:${userId}`,
        resourceType: "report",
        resourceId,
        isSnapshot: true,
        snapshotPayload: snapshot,
      })
    ).token;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "share_link_inactive") {
      throw error;
    }
    return (
      await deliveryData.createShareLink(env, session, {
        resourceType: "report",
        resourceId,
        isSnapshot: true,
        snapshotPayload: snapshot,
      })
    ).token;
  }
}

/**
 * One workspace, one month: mint (or reuse) the report share link, then email
 * it through the existing instant-delivery path. Returns a reason so the caller
 * classifies duplicates and skips without string matching.
 */
async function sendOneMonthlyReport(
  env: AppEnv,
  input: { userId: string; email: string; name: string | null; monthKey: string },
): Promise<MonthlyReportOutcome> {
  // Mirror the scan-trouble and recap gates: verified email, workspace
  // opt-out, List-Unsubscribe. System jobs must never mail an unverified or
  // opted-out address.
  const { isUserEmailVerified } = await import("~/lib/email-verification.server");
  if (!(await isUserEmailVerified(env, input.userId))) {
    return "unverified";
  }

  const workspaceConfig = await getWorkspaceDeliveryConfig(env, input.userId);
  if (workspaceConfig && !workspaceConfig.emailEnabled) {
    return "disabled";
  }
  const primaryTarget =
    (await resolveDigestEmailTargets(
      env,
      input.userId,
      input.email.trim().toLowerCase() || null,
    ))[0] ?? null;
  const recipient = primaryTarget?.targetValue.trim().toLowerCase() ?? "";
  if (!primaryTarget) return "disabled";
  if (!recipient) return "missing_email";

  const built = await buildMonthlyReportSnapshot(env, input.userId);
  if (!built) return "nothing_to_file";

  const resourceId = monthlyReportResourceId(input.monthKey);
  let shareUrl: string;
  try {
    // Read the month's link by its own id, not through a LIMIT-50 window: a
    // busy workspace can own more than 50 newer shares, and `listActiveShareLinks`
    // would then miss this month's row.
    const linkId = `${resourceId}:${input.userId}`;
    const existing = await deliveryData.getShareLinkById(env, input.userId, linkId);
    const token =
      existing?.token ??
      (await mintMonthlyReportShare(env, input.userId, input.monthKey, built.snapshot as unknown as Record<string, unknown>));
    shareUrl = `${appBaseUrl(env)}/share/${token}`;
  } catch (error) {
    console.error("Monthly report share mint failed.", {
      userId: input.userId,
      monthKey: input.monthKey,
      error,
    });
    return "share_failed";
  }

  let unsubscribeUrl: string | null = null;
  if (primaryTarget.id) {
    try {
      unsubscribeUrl = await buildUnsubscribeUrl(env, {
        userId: input.userId,
        targetId: primaryTarget.id,
      });
    } catch {
      unsubscribeUrl = null;
    }
  }

  // Per workspace + month, not per run: the weekly cron's second slot in the
  // same month cannot double-send, and a cron retry is a no-op.
  const idempotencyKey = `monthly_report:${input.userId}:${input.monthKey}`;
  const payloadSnapshot = {
    kind: "monthly_report",
    monthKey: input.monthKey,
    reportId: built.report.reportId,
    changeCount: built.report.rows.length,
  };
  const claim = await claimInstantDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    deliveryTargetId: primaryTarget.id,
    lane: "customer",
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: recipient,
    templateName: "monthly_report",
    eventIds: [],
    payloadSnapshot,
    idempotencyKey,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    return "duplicate";
  }

  const dispatchStartedAt = await markInstantDeliveryDispatchStarted(
    env,
    claim.attemptId,
    claim.claimUpdatedAt,
  );
  if (!dispatchStartedAt) {
    // Another worker owns this attempt; a rejected gate with no other owner is
    // a real failure and must not be reported as a duplicate.
    const durableAttempt = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
    const anotherOwnerAdvanced =
      durableAttempt !== null &&
      (durableAttempt.status !== "pending" ||
        durableAttempt.webhookStatus !== "pending" ||
        durableAttempt.updatedAt !== claim.claimUpdatedAt);
    if (!anotherOwnerAdvanced) {
      console.error("Monthly report dispatch gate rejected.", {
        userId: input.userId,
        monthKey: input.monthKey,
        reason: "dispatch_gate_rejected",
      });
    }
    return anotherOwnerAdvanced ? "duplicate" : "failed";
  }

  const model = buildMonthlyReportEmail({
    name: input.name,
    monthLabel: formatMonthlyReportMonthLabel(input.monthKey),
    changeCount: built.report.rows.length,
    shareUrl,
  });
  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: model.subject,
    html: model.html,
    text: model.text,
    tag: "monthly_report",
    unsubscribeUrl,
    theme: "case-file",
    preheader: model.preheader,
  });

  const finalized = await updateDeliveryAttemptResult(env, claim.attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    payloadSnapshot,
    targetValue: recipient,
    expectedStatus: "pending",
    expectedWebhookStatus: "provider_unknown",
    expectedUpdatedAt: dispatchStartedAt,
  });

  return finalized && providerResult.status === "sent" ? "sent" : "failed";
}

/**
 * Issue #2422 entry point, called from the existing weekly cron tick in
 * `workers/app.ts`. Builds at most one report per paid workspace per UTC month;
 * a retry, a second weekly slot in the same month, and a duplicate cron
 * delivery all return `duplicates` without sending.
 */
export async function sendMonthlyReports(
  env: AppEnv,
  options: { scheduledTime?: number } = {},
): Promise<MonthlyReportRunResult> {
  const result: MonthlyReportRunResult = {
    attempted: 0,
    filed: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
  };
  if (!env.DB) return result;

  const now =
    options.scheduledTime === undefined ? new Date() : new Date(options.scheduledTime);
  const monthKey = utcMonthKey(now);

  for (const workspace of await listPaidWorkspacesForMonthlyReport(env)) {
    result.attempted += 1;
    try {
      // The month gate runs before any build, so the common case (already
      // filed this month) costs one indexed COUNT and no report work.
      if (await hasMonthlyReportShare(env, workspace.userId, monthKey)) {
        result.duplicates += 1;
        continue;
      }

      // The list query already restricts to paid plan families; this re-read
      // catches catalog drift AND a scheduled cancellation whose effective date
      // has passed (`effectivePlanFromRow`). A failed read must fail CLOSED: a
      // permissive fallback would mail a workspace the plan gate should have
      // excluded, which is the one hole worth not having here.
      try {
        const { getUserPlan } = await import("~/lib/plan.server");
        if ((await getUserPlan(env, workspace.userId)) === "free") {
          result.skipped += 1;
          continue;
        }
      } catch (error) {
        result.failed += 1;
        console.error(
          `Monthly report plan check failed for user ${workspace.userId}; skipping this workspace.`,
          error,
        );
        continue;
      }

      const profile = await getUserDeliveryProfile(env, workspace.userId);
      const outcome = await sendOneMonthlyReport(env, {
        userId: workspace.userId,
        email: profile?.email?.trim() || workspace.email,
        name: profile?.name ?? workspace.name,
        monthKey,
      });
      if (outcome === "sent") {
        result.filed += 1;
      } else if (outcome === "duplicate") {
        result.duplicates += 1;
      } else if (
        outcome === "unverified" ||
        outcome === "disabled" ||
        outcome === "missing_email" ||
        outcome === "nothing_to_file"
      ) {
        result.skipped += 1;
      } else {
        result.failed += 1;
      }
    } catch (error) {
      // One bad workspace never stops the run; the failure is counted and
      // surfaced by the scheduled-task observer in workers/app.ts.
      result.failed += 1;
      console.error(
        `Monthly report failed for user ${workspace.userId}; continuing with remaining workspaces.`,
        error,
      );
    }
  }

  return result;
}
