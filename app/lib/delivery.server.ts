import {
  type DigestCadence,
  digestCadenceLabel,
  readDigestIntelligence,
} from "~/lib/change-intelligence";
import { buildDigestEmail } from "~/lib/digest-email.server";
import { safeTimeZone } from "~/lib/safe-timezone";
import {
  createDeliveryAttempt,
  getDeliveryAttemptByIdempotencyKey,
  getOldestUserId,
  getUserDeliveryProfile,
  getUserIdByEmail,
  getUserPlanBillingInfo,
  getDeliveryTargetById,
  getDeliveryTargetByProviderIdentifier,
  getWatchlistDeliveryConfig,
  getWorkspaceDeliveryConfig,
  legacyWorkspaceDeliveryDefaults,
  listAdsByIds,
  listDeliveryTargets,
  listStaleBillingLifecycleEmailAttempts,
  reconcileDeliveryAttemptByProviderMessageId,
  updateDeliveryAttemptResult,
  upsertDeliveryTarget,
  upsertDigestDelivery,
  type UserPlanBillingInfo,
} from "~/lib/data.server";
import {
  deliveryPreDispatchStaleBefore,
  isStalePreDispatchAttempt,
} from "~/lib/delivery-attempt-lease";
import { evaluateDeliveryPolicy, resolveDeliveryConfig } from "~/lib/delivery-policy.server";
import type { AppEnv } from "~/lib/env.server";
import { emailFromSender, isEmailSendingConfigured } from "~/lib/env.server";
import {
  isSlackDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import { buildUnsubscribeUrl } from "~/lib/unsubscribe.server";
import type {
  AdRecord,
  DeliveryChannel,
  DeliveryAttemptRecord,
  DeliveryTargetRecord,
  WatchEventRecord,
  WatchlistRecord,
  WatchlistDeliveryConfigRecord,
  WorkspaceDeliveryConfigRecord,
  DeliveryLane,
} from "~/lib/types";
import { sendDigestWhatsApp, sendInstantWhatsApp } from "~/lib/whatsapp.server";
import {
  sendSlackWebhookMessage,
  SLACK_PROVIDER,
} from "~/lib/slack-webhook.server";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import { renderEmailShell } from "~/lib/email-template.server";
import { PromiseTimeoutError, promiseWithTimeout } from "~/lib/fetch-timeout.server";

const AUTO_PROVISIONED_EMAIL_SOURCE = "account_email";
const EMAIL_PROVIDER = "cloudflare_email" as const;
const CLOUDFLARE_EMAIL_SEND_TIMEOUT_MS = 10_000;
const BILLING_LIFECYCLE_RECOVERY_LIMIT = 10;
const SUPPORT_CASE_IDEMPOTENCY_PREFIX = "support-case:";
const SUPPORT_CASE_REOPEN_IDEMPOTENCY_PREFIX = "support-case-reopen:";

interface DigestAttemptSummary {
  channel: DeliveryChannel;
  status: "sent" | "failed" | "pending";
  targetValue: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
}

type EmailProviderResult = {
  provider: typeof EMAIL_PROVIDER;
  status: "sent" | "failed" | "pending";
  webhookStatus: "pending" | "failed" | "provider_unknown";
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
};

const BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE =
  "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE" as const;

export class BillingLifecycleEmailExplicitFailure extends Error {
  readonly code = BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE;

  constructor(
    readonly idempotencyKey: string,
    providerMessage: string | null,
  ) {
    super(providerMessage ?? "Cloudflare Email explicitly rejected the lifecycle email.");
    this.name = "BillingLifecycleEmailExplicitFailure";
  }
}

export function isBillingLifecycleEmailExplicitFailure(
  error: unknown,
): error is BillingLifecycleEmailExplicitFailure {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE &&
    "idempotencyKey" in error &&
    typeof error.idempotencyKey === "string"
  );
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
  items: DigestDeliveryItem[];
  // Present when the period had zero changes but successful scans: the
  // digest becomes an "all quiet" heartbeat (email only).
  heartbeat?: DigestHeartbeat | null;
  // Optional AI weekly strategy paragraph persisted on the digest run.
  // Null/absent renders nothing — never an apology string.
  strategyParagraph?: string | null;
  cadence?: DigestCadence;
  lane?: DeliveryLane;
}

export interface DeliverWatchlistAlertsInput {
  userId: string;
  userName: string;
  accountEmail: string | null;
  watchlist: Pick<WatchlistRecord, "id" | "userId" | "name">;
  events: WatchEventRecord[];
  lane?: DeliveryLane;
}

export async function deliverWeeklyDigest(env: AppEnv, input: DeliverWeeklyDigestInput) {
  const lane = input.lane ?? "customer";
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
    ? await resolveDigestEmailTargets(env, input.userId, input.accountEmail)
    : [];
  // "All quiet" heartbeats stay email-only: a WhatsApp template or Slack
  // ping saying nothing happened reads as noise on those channels.
  const whatsappTargets = !isHeartbeat && config.whatsappEnabled && isWhatsAppDeliveryCustomerFacing()
    ? await resolveDigestWhatsAppTargets(env, input.userId)
    : [];
  const slackTargets = !isHeartbeat && config.slackEnabled && isSlackDeliveryCustomerFacing()
    ? await resolveDigestSlackTargets(env, input.userId)
    : [];

  const attempts: DigestAttemptSummary[] = [];

  const digestTimeZone = config.timezone ?? null;

  for (const target of emailTargets) {
    attempts.push(await deliverDigestToEmailTarget(env, input, lane, target, digestTimeZone));
  }

  for (const target of whatsappTargets) {
    attempts.push(await deliverDigestToWhatsAppTarget(env, input, lane, target, digestTimeZone));
  }

  for (const target of slackTargets) {
    attempts.push(await deliverDigestToSlackTarget(env, input, lane, target, digestTimeZone));
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
    });
  }

  return {
    attempts: attempts.length,
    channels: [...new Set(attempts.map((attempt) => attempt.channel))],
    details: attempts,
  };
}

export async function deliverWatchlistAlerts(env: AppEnv, input: DeliverWatchlistAlertsInput) {
  if (input.events.length === 0) {
    return {
      attempts: 0,
      channels: [] as DeliveryChannel[],
    };
  }

  const lane = input.lane ?? "customer";
  if (lane === "customer") {
    const { isUserEmailVerified } = await import("~/lib/email-verification.server");
    if (!(await isUserEmailVerified(env, input.userId))) {
      return {
        attempts: 0,
        channels: [] as DeliveryChannel[],
      };
    }
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
    };
  }

  const emailTargets = batches.some((batch) => batch.allowedChannels.includes("email"))
    ? await resolveAlertEmailTargets(env, input.userId, input.watchlist.id, input.accountEmail)
    : [];
  const whatsappTargets = isWhatsAppDeliveryCustomerFacing() && batches.some((batch) => batch.allowedChannels.includes("whatsapp"))
    ? await resolveAlertWhatsAppTargets(env, input.userId, input.watchlist.id)
    : [];
  const slackTargets = batches.some((batch) => batch.allowedChannels.includes("slack"))
    ? await resolveAlertSlackTargets(env, input.userId, input.watchlist.id)
    : [];

  // One batched lookup so alert emails can show the primary event's captured
  // creative. Only fetched when an email will actually render it.
  const alertAdsById =
    emailTargets.length > 0
      ? await loadAlertAdsById(env, input.events)
      : new Map<string, AdRecord>();

  const attempts: DigestAttemptSummary[] = [];

  for (const batch of batches) {
    const content = buildInstantAlertContent(
      input.watchlist,
      batch.events,
      batch.provisional,
      env,
      alertAdsById,
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
  }

  return {
    attempts: attempts.length,
    channels: [...new Set(attempts.map((attempt) => attempt.channel))],
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

const DIGEST_STATUS_CHANNEL_PRIORITY: DeliveryChannel[] = ["email", "slack", "whatsapp"];

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

  const target = await getDeliveryTargetById(env, {
    userId: attempt.userId,
    targetId: attempt.deliveryTargetId,
  });
  if (!target || target.channel !== "whatsapp") {
    return;
  }
  if (readString(target.metadata.validationProviderMessageId) !== attempt.providerMessageId) {
    return;
  }

  const statusSeenAt =
    attempt.providerStatusLastSeenAt ?? attempt.sentAt ?? attempt.failedAt ?? new Date().toISOString();

  await upsertDeliveryTarget(env, {
    userId: target.userId,
    watchlistId: target.watchlistId,
    channel: target.channel,
    targetValue: target.targetValue,
    validationStatus: delivered ? "validated" : "invalid",
    isValidated: delivered,
    isOptedIn: target.isOptedIn,
    optInSource: target.optInSource,
    optedInAt: target.optedInAt,
    isPaused: target.isPaused,
    pausedAt: target.pausedAt,
    optedOutAt: target.optedOutAt,
    templateEligible: delivered,
    lastSuccessfulDeliveryAt: delivered ? statusSeenAt : target.lastSuccessfulDeliveryAt,
    lastSuccessfulAttemptId: delivered ? attempt.id : target.lastSuccessfulAttemptId,
    providerIdentifier: attempt.providerMessageId ?? target.providerIdentifier,
    metadata: {
      ...target.metadata,
      validationAttemptId: attempt.id,
      validationWebhookStatus: attempt.webhookStatus,
      validationStatusLastSeenAt: statusSeenAt,
      validationErrorMessage: failed ? attempt.errorMessage ?? "WhatsApp setup delivery failed." : null,
    },
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
  const target = await getDeliveryTargetByProviderIdentifier(env, {
    channel: "whatsapp",
    providerIdentifier: input.providerMessageId,
  });
  if (!target || readString(target.metadata.validationProviderMessageId) !== input.providerMessageId) {
    return;
  }

  const normalizedRawStatus = input.rawProviderStatus?.toLowerCase() ?? null;
  const delivered =
    input.status === "sent" &&
    input.webhookStatus === "delivered" &&
    (normalizedRawStatus === "delivered" || normalizedRawStatus === "read");
  const failed = input.status === "failed" || input.webhookStatus === "failed";
  if (!delivered && !failed) {
    return;
  }

  await upsertDeliveryTarget(env, {
    userId: target.userId,
    watchlistId: target.watchlistId,
    channel: target.channel,
    targetValue: target.targetValue,
    validationStatus: delivered ? "validated" : "invalid",
    isValidated: delivered,
    isOptedIn: target.isOptedIn,
    optInSource: target.optInSource,
    optedInAt: target.optedInAt,
    isPaused: target.isPaused,
    pausedAt: target.pausedAt,
    optedOutAt: target.optedOutAt,
    templateEligible: delivered,
    lastSuccessfulDeliveryAt: delivered ? input.providerStatusLastSeenAt : target.lastSuccessfulDeliveryAt,
    lastSuccessfulAttemptId: target.lastSuccessfulAttemptId,
    providerIdentifier: input.providerMessageId,
    metadata: {
      ...target.metadata,
      validationWebhookStatus: input.webhookStatus,
      validationStatusLastSeenAt: input.providerStatusLastSeenAt,
      validationErrorMessage: failed ? input.errorMessage ?? "WhatsApp setup delivery failed." : null,
      validationReconciledWithoutAttempt: true,
    },
  });
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function selectDigestStatusAttempt(attempts: DigestAttemptSummary[]) {
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
    const stalePreDispatch = isStalePreDispatchAttempt(duplicate);
    if (duplicate.status !== "failed" && !stalePreDispatch) {
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
      payloadSnapshot: input.payloadSnapshot,
      updatedAt: claimUpdatedAt,
      expectedStatus: stalePreDispatch ? "pending" : "failed",
      expectedWebhookStatus: stalePreDispatch ? "pending" : undefined,
      expectedUpdatedAt: stalePreDispatch ? duplicate.updatedAt : undefined,
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
      payloadSnapshot: input.payloadSnapshot,
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
    deliveredAt: attempt.sentAt,
  };
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

async function deliverDigestToEmailTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
  timeZone: string | null,
): Promise<DigestAttemptSummary> {
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "email",
    targetValue: target.targetValue,
  });
  const unsubscribeUrl = await buildUnsubscribeUrl(env, {
    userId: target.userId,
    targetId: target.id,
  });
  const email = renderDigestEmail(env, {
    digestRunId: input.digestRunId,
    name: input.userName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    heartbeat: input.heartbeat ?? null,
    strategyParagraph: input.strategyParagraph ?? null,
    cadence: input.cadence,
    timeZone,
    unsubscribeUrl,
  });
  const attemptClaim = await claimDigestDeliveryAttempt(env, {
    userId: input.userId,
    digestRunId: input.digestRunId,
    deliveryTargetId: target.id,
    lane,
    channel: "email",
    provider: EMAIL_PROVIDER,
    targetValue: target.targetValue,
    eventIds: input.items.map((item) => item.eventId),
    payloadSnapshot: {
      kind: "weekly_digest",
      channel: "email",
      subject: email.subject,
      cadence: input.cadence ?? "weekly",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      itemCount: input.items.length,
    },
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

  const providerResult = await sendRenderedDigestEmail(env, {
    to: target.targetValue,
    email,
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
    expectedWebhookStatus: "pending",
    expectedUpdatedAt: claimUpdatedAt,
  });
  const providerSummary: DigestAttemptSummary = {
    channel: "email",
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: null,
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

async function deliverInstantEmailBatch(
  env: AppEnv,
  input: {
    lane: DeliveryLane;
    userId: string;
    deliveryTarget: DeliveryTargetRecord;
    watchlistId: string;
    batch: InstantAlertBatch;
    content: InstantAlertContent;
  },
): Promise<DigestAttemptSummary> {
  const attemptDedupe = await resolveInstantAttemptDedupe(env, {
    watchlistId: input.watchlistId,
    lane: input.lane,
    channel: "email",
    targetValue: input.deliveryTarget.targetValue,
    batchKey: input.batch.batchKey,
    deferredByQuietHours: input.batch.deferredByQuietHours,
  });
  if (attemptDedupe.duplicate) {
    return summarizeDeliveryAttempt(attemptDedupe.duplicate);
  }

  if (input.batch.deferredByQuietHours) {
    await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel: "email",
      provider: EMAIL_PROVIDER,
      status: "skipped_due_to_quiet_hours",
      webhookStatus: "provider_unknown",
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: null,
      eventIds: input.batch.events.map((event) => event.id),
      payloadSnapshot: {
        kind: "instant_alert",
        channel: "email",
        batchKey: input.batch.batchKey,
        subject: input.content.subject,
        provisional: input.batch.provisional,
      },
      idempotencyKey: attemptDedupe.idempotencyKey,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
    });

    return {
      channel: "email",
      status: "failed",
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      errorMessage: null,
      deliveredAt: null,
    };
  }

  const providerResult = await sendInstantEmail(env, {
    email: input.deliveryTarget.targetValue,
    subject: input.content.subject,
    html: input.content.html,
    unsubscribeUrl: await buildUnsubscribeUrl(env, {
      userId: input.deliveryTarget.userId,
      targetId: input.deliveryTarget.id,
    }),
  });

  let attemptId: string;
  if (attemptDedupe.retryAttempt) {
    await updateDeliveryAttemptResult(env, attemptDedupe.retryAttempt.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      errorMessage: providerResult.errorMessage,
      sentAt: providerAcceptedAt(providerResult),
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
    attemptId = attemptDedupe.retryAttempt.id;
  } else {
    attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel: "email",
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: null,
      eventIds: input.batch.events.map((event) => event.id),
      payloadSnapshot: {
        kind: "instant_alert",
        channel: "email",
        batchKey: input.batch.batchKey,
        subject: input.content.subject,
        provisional: input.batch.provisional,
        watchlistUrl: input.content.watchlistUrl,
      },
      idempotencyKey: attemptDedupe.idempotencyKey,
      errorMessage: providerResult.errorMessage,
      sentAt: providerAcceptedAt(providerResult),
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
  }
  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(
      env,
      input.deliveryTarget,
      attemptId,
      providerAcceptedAt(providerResult),
    );
  }

  return {
    channel: "email",
    status: providerResult.status,
    targetValue: input.deliveryTarget.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.deliveredAt,
  };
}

async function deliverInstantWhatsAppBatch(
  env: AppEnv,
  input: {
    lane: DeliveryLane;
    userId: string;
    deliveryTarget: DeliveryTargetRecord;
    watchlistId: string;
    batch: InstantAlertBatch;
    content: InstantAlertContent;
  },
): Promise<DigestAttemptSummary> {
  const attemptDedupe = await resolveInstantAttemptDedupe(env, {
    watchlistId: input.watchlistId,
    lane: input.lane,
    channel: "whatsapp",
    targetValue: input.deliveryTarget.targetValue,
    batchKey: input.batch.batchKey,
    deferredByQuietHours: input.batch.deferredByQuietHours,
  });
  if (attemptDedupe.duplicate) {
    return summarizeDeliveryAttempt(attemptDedupe.duplicate);
  }

  if (input.batch.deferredByQuietHours) {
    await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel: "whatsapp",
      provider: "whatsapp_cloud_api",
      status: "skipped_due_to_quiet_hours",
      webhookStatus: "provider_unknown",
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: null,
      eventIds: input.batch.events.map((event) => event.id),
      payloadSnapshot: {
        kind: "instant_alert",
        channel: "whatsapp",
        batchKey: input.batch.batchKey,
        provisional: input.batch.provisional,
      },
      idempotencyKey: attemptDedupe.idempotencyKey,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
    });

    return {
      channel: "whatsapp",
      status: "failed",
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      errorMessage: null,
      deliveredAt: null,
    };
  }

  const providerResult = await sendInstantWhatsApp(env, {
    lane: input.lane,
    target: input.deliveryTarget,
    competitor: input.content.competitor,
    shortChange: input.content.shortChange,
    watchlistUrl: input.content.watchlistUrl,
    provisional: input.batch.provisional,
  });

  const deliveredAt = providerResult.status === "sent" ? new Date().toISOString() : null;
  let attemptId: string;
  if (attemptDedupe.retryAttempt) {
    await updateDeliveryAttemptResult(env, attemptDedupe.retryAttempt.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      errorMessage: providerResult.errorMessage,
      sentAt: deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
    attemptId = attemptDedupe.retryAttempt.id;
  } else {
    attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel: "whatsapp",
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: providerResult.templateName,
      eventIds: input.batch.events.map((event) => event.id),
      payloadSnapshot: {
        kind: "instant_alert",
        channel: "whatsapp",
        batchKey: input.batch.batchKey,
        provisional: input.batch.provisional,
        shortChange: input.content.shortChange,
        watchlistUrl: input.content.watchlistUrl,
      },
      idempotencyKey: attemptDedupe.idempotencyKey,
      errorMessage: providerResult.errorMessage,
      sentAt: deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, input.deliveryTarget, attemptId, deliveredAt);
  }

  return {
    channel: "whatsapp",
    status: providerResult.status,
    targetValue: input.deliveryTarget.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt,
  };
}

async function deliverInstantSlackBatch(
  env: AppEnv,
  input: {
    lane: DeliveryLane;
    userId: string;
    deliveryTarget: DeliveryTargetRecord;
    watchlistId: string;
    batch: InstantAlertBatch;
    content: InstantAlertContent;
  },
): Promise<DigestAttemptSummary> {
  const attemptDedupe = await resolveInstantAttemptDedupe(env, {
    watchlistId: input.watchlistId,
    lane: input.lane,
    channel: "slack",
    targetValue: input.deliveryTarget.targetValue,
    batchKey: input.batch.batchKey,
    deferredByQuietHours: input.batch.deferredByQuietHours,
  });
  if (attemptDedupe.duplicate) {
    return summarizeDeliveryAttempt(attemptDedupe.duplicate);
  }

  if (input.batch.deferredByQuietHours) {
    await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel: "slack",
      provider: SLACK_PROVIDER,
      status: "skipped_due_to_quiet_hours",
      webhookStatus: "provider_unknown",
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: null,
      eventIds: input.batch.events.map((event) => event.id),
      payloadSnapshot: {
        kind: "instant_alert",
        channel: "slack",
        batchKey: input.batch.batchKey,
        provisional: input.batch.provisional,
      },
      idempotencyKey: attemptDedupe.idempotencyKey,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
    });

    return {
      channel: "slack",
      status: "failed",
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: null,
      errorMessage: null,
      deliveredAt: null,
    };
  }

  const providerResult = await sendSlackWebhookMessage(env, input.deliveryTarget, {
    text: renderInstantSlackText(input.content, input.batch.events),
  });

  let attemptId: string;
  if (attemptDedupe.retryAttempt) {
    await updateDeliveryAttemptResult(env, attemptDedupe.retryAttempt.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
    attemptId = attemptDedupe.retryAttempt.id;
  } else {
    attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel: "slack",
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      targetValue: input.deliveryTarget.targetValue,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: null,
      eventIds: input.batch.events.map((event) => event.id),
      payloadSnapshot: {
        kind: "instant_alert",
        channel: "slack",
        batchKey: input.batch.batchKey,
        provisional: input.batch.provisional,
        subject: input.content.subject,
        watchlistUrl: input.content.watchlistUrl,
      },
      idempotencyKey: attemptDedupe.idempotencyKey,
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, input.deliveryTarget, attemptId, providerResult.deliveredAt);
  }

  return {
    channel: "slack",
    status: providerResult.status,
    targetValue: input.deliveryTarget.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.deliveredAt,
  };
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
    expectedWebhookStatus: "pending",
    expectedUpdatedAt: claimUpdatedAt,
  });
  const providerSummary: DigestAttemptSummary = {
    channel: "whatsapp",
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt,
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

  const providerResult = await sendSlackWebhookMessage(env, target, {
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
    expectedWebhookStatus: "pending",
    expectedUpdatedAt: claimUpdatedAt,
  });
  const providerSummary: DigestAttemptSummary = {
    channel: "slack",
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.deliveredAt,
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

async function resolveDigestEmailTargets(
  env: AppEnv,
  userId: string,
  accountEmail: string | null,
) {
  const allTargets = await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "email",
    limit: 10,
  });
  const configuredTargets = allTargets.filter(isUsableEmailTarget);

  if (configuredTargets.length > 0) {
    return configuredTargets;
  }

  // Never re-provision an address the recipient unsubscribed or paused —
  // upsertDeliveryTarget would reset those flags.
  if (!accountEmail || hasEmailTargetForAddress(allTargets, accountEmail)) {
    return [];
  }

  const fallbackTarget = await upsertDeliveryTarget(env, {
    userId,
    watchlistId: null,
    channel: "email",
    targetValue: accountEmail,
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: AUTO_PROVISIONED_EMAIL_SOURCE,
    optedInAt: new Date().toISOString(),
    metadata: {
      autoProvisioned: true,
    },
  });

  return fallbackTarget ? [fallbackTarget] : [];
}

async function resolveAlertEmailTargets(
  env: AppEnv,
  userId: string,
  watchlistId: string,
  accountEmail: string | null,
) {
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
  const combinedTargets = allTargets.filter(isUsableEmailTarget);

  if (combinedTargets.length > 0) {
    return combinedTargets;
  }

  // Never re-provision an address the recipient unsubscribed or paused —
  // upsertDeliveryTarget would reset those flags.
  if (!accountEmail || hasEmailTargetForAddress(allTargets, accountEmail)) {
    return [];
  }

  const fallbackTarget = await upsertDeliveryTarget(env, {
    userId,
    watchlistId: null,
    channel: "email",
    targetValue: accountEmail,
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: AUTO_PROVISIONED_EMAIL_SOURCE,
    optedInAt: new Date().toISOString(),
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
  if (!isSlackDeliveryCustomerFacing()) return [];
  return (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "slack",
    limit: 10,
  })).filter(isUsableSlackTarget);
}

async function resolveAlertSlackTargets(env: AppEnv, userId: string, watchlistId: string) {
  if (!isSlackDeliveryCustomerFacing()) return [];
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

function isUsableEmailTarget(target: DeliveryTargetRecord) {
  return !target.isPaused && !target.optedOutAt && target.validationStatus !== "invalid";
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

// One daily "customer-at-risk" email to the operator when monitoring or
// delivery is degrading for paying customers — the ops dashboard is
// pull-only and nobody is paged to it. Day-keyed idempotency: max one/day.
export async function sendOperatorAlertEmail(
  env: AppEnv,
  input: {
    subject: string;
    lines: string[];
    idempotencyKey?: string;
    intro?: string;
  },
) {
  const recipient = env.LAUNCH_CANARY_EMAIL?.trim();
  if (!recipient) {
    return false;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const idempotencyKey = input.idempotencyKey ?? `operator-alert:${dayKey}`;
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate?.status === "sent") {
    return false;
  }

  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: input.subject,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 14px; line-height: 1.6;">
        <p style="margin: 0 0 12px;"><strong>${escapeHtml(input.intro ?? "Customer-at-risk signals from recent monitoring:")}</strong></p>
        <ul style="margin: 0 0 12px; padding-left: 18px;">
          ${input.lines.map((line) => `<li style="margin: 0 0 6px;">${escapeHtml(line)}</li>`).join("")}
        </ul>
        <p style="margin: 0; color: #5b6577; font-size: 12px;">
          Details: https://0509.io/app/ops
        </p>
      </div>
    `,
    tag: "operator-alert",
    unsubscribeUrl: null,
  });

  if (duplicate) {
    await updateDeliveryAttemptResult(env, duplicate.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      errorMessage: providerResult.errorMessage,
      sentAt: providerAcceptedAt(providerResult),
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
    return providerResult.status === "sent";
  }

  // delivery_attempt.user_id carries a foreign key to user(id), so the
  // attempt must be attributed to a REAL user row: the operator's own account
  // when it exists, else the oldest account (the founder's). Without this the
  // operator-alert insert violated the FK — the email sent but the dedupe row never
  // persisted and the logs claimed failure.
  const attemptUserId =
    (await getUserIdByEmail(env, recipient)) ?? (await getOldestUserId(env));
  if (!attemptUserId) {
    // Empty user table (fresh environment): nothing to attribute to — the
    // email went out, skip the ledger row.
    return providerResult.status === "sent";
  }

  await createDeliveryAttempt(env, {
    userId: attemptUserId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "internal",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: recipient,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "operator_alert",
    eventIds: [],
    payloadSnapshot: operatorAlertPayloadSnapshot(idempotencyKey, input.lines),
    idempotencyKey,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}

function operatorAlertPayloadSnapshot(idempotencyKey: string, lines: string[]) {
  if (idempotencyKey.startsWith(SUPPORT_CASE_IDEMPOTENCY_PREFIX)) {
    return {
      kind: "support_case_operator_alert",
      caseId: idempotencyKey.slice(SUPPORT_CASE_IDEMPOTENCY_PREFIX.length),
    };
  }
  if (idempotencyKey.startsWith(SUPPORT_CASE_REOPEN_IDEMPOTENCY_PREFIX)) {
    const caseId = idempotencyKey.slice(SUPPORT_CASE_REOPEN_IDEMPOTENCY_PREFIX.length).split(":")[0];
    return {
      kind: "support_case_operator_alert",
      caseId,
    };
  }

  return { kind: "operator_alert", lines };
}

export async function sendDeliveryTestEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
  },
) {
  const { requireDeliveryConfigSave } = await import("~/lib/plan-feature-gate.server");
  const deliveryGate = await requireDeliveryConfigSave(env, input.userId, { emailEnabled: true });
  if (!deliveryGate.ok) {
    return false;
  }

  // Cloudflare Email has no bounce webhooks, so a typo'd address shows
  // "sent" forever while the customer receives nothing. This send gives
  // them a way to prove the address works end-to-end.
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: "Test email from Five to Nine",
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">${greeting}</p>
        <p style="margin: 0 0 12px;">
          This is a test from Five to Nine. If you're reading it, competitor alerts and digests can
          reach this address.
        </p>
        <p style="margin: 0; color: #5b6577; font-size: 13px;">
          Nothing else changes — this was requested from your workspace delivery settings.
        </p>
      </div>
    `,
    tag: "delivery-test",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "delivery_test",
    eventIds: [],
    payloadSnapshot: { kind: "delivery_test" },
    idempotencyKey: `delivery-test:${input.userId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}

// Account-action verification emails (change email, delete account).
// Transactional: no unsubscribe header, still recorded as delivery attempts;
// action URLs carry secrets and are never persisted in payload snapshots.
export async function sendAccountActionEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    kind: "change_email" | "delete_account";
    actionUrl: string;
  },
) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
  const copy =
    input.kind === "change_email"
      ? {
          subject: "Confirm your new email for Five to Nine",
          body: "Someone asked to change the email on this Five to Nine account. If that was you, confirm with the button below.",
          action: "Confirm email change",
        }
      : {
          subject: "Confirm account deletion — Five to Nine",
          body: "Someone asked to permanently delete this Five to Nine account, including watchlists, history, and evidence. If that was you, confirm below. This cannot be undone.",
          action: "Delete my account",
        };

  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: copy.subject,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">${greeting}</p>
        <p style="margin: 0 0 16px;">${copy.body}</p>
        <p style="margin: 0 0 20px;">
          <a href="${escapeHtml(input.actionUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
            ${copy.action}
          </a>
        </p>
        <p style="margin: 0; color: #5b6577; font-size: 13px;">
          If you didn't ask for this, ignore this email — nothing changes.
        </p>
      </div>
    `,
    tag: `account-${input.kind.replace("_", "-")}`,
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: `account_${input.kind}`,
    eventIds: [],
    payloadSnapshot: { kind: `account_${input.kind}` },
    idempotencyKey: `account-${input.kind}:${input.userId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}

// --- Customer lifecycle billing emails (Dodo webhook driven) -----------------
// Transactional: they must reach the customer regardless of digest
// unsubscribe state, so they carry no List-Unsubscribe header — but every
// send still records a delivery_attempt. Webhook handlers can legitimately
// re-run (the dodo_webhook_event ledger reclaims failed events and expired
// processing leases, and Dodo re-emits dunning events across payment
// retries), so these sends use DETERMINISTIC idempotency keys and claim the
// key (a 'pending' delivery_attempt row) BEFORE calling the provider — the
// UNIQUE index arbitrates concurrent handlers, and only a recorded 'failed'
// attempt is retried in place. Not the crypto.randomUUID pattern used by
// user-initiated account emails.

function billingDateLabel(iso: string | null | undefined) {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) {
    return null;
  }
  const formatted = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
  return `${formatted} (UTC)`;
}

function renderBillingEmailHtml(input: {
  name: string | null;
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  footnote: string;
}) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
  const paragraphs = input.paragraphs
    .map((paragraph) => `<p style="margin: 0 0 16px;">${paragraph}</p>`)
    .join("");

  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      ${paragraphs}
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.ctaUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          ${escapeHtml(input.ctaLabel)}
        </a>
      </p>
      <p style="margin: 0 0 12px;">— Five to Nine</p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">${escapeHtml(input.footnote)}</p>
    </div>
  `;
}

async function sendBillingLifecycleEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    idempotencyKey: string;
    subject: string;
    bodyHtml: string;
    tag: string;
    templateName: string;
    retryWebhookOnExplicitFailure?: boolean;
  },
) {
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  const stalePreDispatch = duplicate ? isStalePreDispatchAttempt(duplicate) : false;
  // Sent rows and provider-unknown timeouts are terminal for automatic
  // retries. Only an explicit failure or an abandoned pre-dispatch lease can
  // call the provider again.
  if (duplicate && duplicate.status !== "failed" && !stalePreDispatch) {
    return false;
  }

  const billingStateFingerprint = billingLifecycleStateFingerprint(
    await getUserPlanBillingInfo(env, input.userId),
  );
  const payloadSnapshot = {
    kind: input.templateName,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    tag: input.tag,
    billingStateFingerprint,
  };
  let attemptId = duplicate?.id ?? null;
  let claimUpdatedAt: string | null = null;
  if (duplicate) {
    claimUpdatedAt = new Date().toISOString();
    const retryClaimed = await updateDeliveryAttemptResult(env, duplicate.id, {
      provider: EMAIL_PROVIDER,
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: input.templateName,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      payloadSnapshot,
      updatedAt: claimUpdatedAt,
      expectedStatus: stalePreDispatch ? "pending" : "failed",
      expectedWebhookStatus: stalePreDispatch ? "pending" : undefined,
      expectedUpdatedAt: stalePreDispatch ? duplicate.updatedAt : undefined,
    });
    // Older/mocked data adapters returned void; only an explicit false means
    // this handler lost the conditional database claim.
    if (retryClaimed === false) {
      return false;
    }
  }

  if (!attemptId) {
    // Claim the idempotency key BEFORE sending so two webhook events that
    // race past the duplicate pre-check (e.g. payment.failed +
    // subscription.failed for one failed renewal) can't both email: the
    // UNIQUE index on delivery_attempt.idempotency_key lets exactly one
    // claim win; the loser sees the row and backs off.
    claimUpdatedAt = new Date().toISOString();
    try {
      attemptId = await createDeliveryAttempt(env, {
        userId: input.userId,
        watchlistId: null,
        digestRunId: null,
        deliveryTargetId: null,
        lane: "customer",
        channel: "email",
        provider: EMAIL_PROVIDER,
        status: "pending",
        webhookStatus: "pending",
        targetValue: input.email,
        templateName: input.templateName,
        eventIds: [],
        payloadSnapshot,
        idempotencyKey: input.idempotencyKey,
        timestamp: claimUpdatedAt,
      });
    } catch (error) {
      const concurrentClaim = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
      if (concurrentClaim) {
        return false;
      }
      throw error;
    }
  }

  if (!claimUpdatedAt) {
    throw new Error("Billing lifecycle delivery claim did not return an owner token.");
  }

  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: input.subject,
    html: input.bodyHtml,
    tag: input.tag,
    unsubscribeUrl: null,
  });

  // First terminal transition wins. A reconciler may have resolved the
  // provider-unknown row while this provider call was in flight; in that
  // case this stale response must neither overwrite the durable outcome nor
  // report success to its caller.
  const finalized = await updateDeliveryAttemptResult(env, attemptId, {
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    expectedStatus: "pending",
    expectedWebhookStatus: "pending",
    expectedUpdatedAt: claimUpdatedAt,
  });
  if (finalized === false) {
    return false;
  }

  if (providerResult.status === "failed" && input.retryWebhookOnExplicitFailure) {
    throw new BillingLifecycleEmailExplicitFailure(
      input.idempotencyKey,
      providerResult.errorMessage,
    );
  }

  return providerResult.status === "sent";
}

function billingLifecycleStateFingerprint(info: UserPlanBillingInfo) {
  return JSON.stringify({
    plan: info.plan,
    dodoStatus: info.dodoStatus,
    dodoPaymentId: info.dodoPaymentId,
    dodoProductId: info.dodoProductId,
    dodoPlanChangeProductId: info.dodoPlanChangeProductId,
    billingInterval: info.billingInterval,
    dodoSubscriptionId: info.dodoSubscriptionId,
    dodoCustomerId: info.dodoCustomerId,
    dodoNextBillingAt: info.dodoNextBillingAt,
    planUpdatedAt: info.planUpdatedAt,
  });
}

function readBillingLifecycleRecoveryPayload(attempt: DeliveryAttemptRecord) {
  const kind = readString(attempt.payloadSnapshot.kind);
  const subject = readString(attempt.payloadSnapshot.subject);
  const bodyHtml = readString(attempt.payloadSnapshot.bodyHtml);
  const tag = readString(attempt.payloadSnapshot.tag);
  const billingStateFingerprint = readString(
    attempt.payloadSnapshot.billingStateFingerprint,
  );
  const targetValue = readString(attempt.targetValue);

  if (
    !kind ||
    kind !== attempt.templateName ||
    !kind.startsWith("billing_") ||
    !subject ||
    !bodyHtml ||
    !tag ||
    !billingStateFingerprint ||
    !targetValue
  ) {
    return null;
  }

  return { subject, bodyHtml, tag, targetValue, billingStateFingerprint };
}

/**
 * Replays bounded billing-email outbox rows whose worker stopped before the
 * provider call. This is intentionally at-least-once crash recovery: caught
 * provider timeouts are persisted as provider_unknown and never auto-retried.
 */
export async function recoverAbandonedBillingLifecycleEmails(env: AppEnv) {
  const emptyResult = {
    scanned: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    providerUnknown: 0,
    superseded: 0,
    conflicts: 0,
  };
  if (!env.DB) {
    return emptyResult;
  }

  const attempts = await listStaleBillingLifecycleEmailAttempts(env, {
    staleBefore: deliveryPreDispatchStaleBefore(),
    limit: BILLING_LIFECYCLE_RECOVERY_LIMIT,
  });
  const result = { ...emptyResult, scanned: attempts.length };

  for (const attempt of attempts) {
    const claimUpdatedAt = new Date().toISOString();
    const claimed = await updateDeliveryAttemptResult(env, attempt.id, {
      provider: EMAIL_PROVIDER,
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: attempt.templateName,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      updatedAt: claimUpdatedAt,
      expectedStatus: "pending",
      expectedWebhookStatus: "pending",
      expectedUpdatedAt: attempt.updatedAt,
    });
    if (claimed !== true) {
      result.conflicts += 1;
      continue;
    }
    result.claimed += 1;

    const payload = readBillingLifecycleRecoveryPayload(attempt);
    if (!payload) {
      const failedAt = new Date().toISOString();
      const finalized = await updateDeliveryAttemptResult(env, attempt.id, {
        provider: EMAIL_PROVIDER,
        status: "failed",
        webhookStatus: "failed",
        providerMessageId: null,
        providerStatusLastSeenAt: null,
        templateName: attempt.templateName,
        errorMessage: "Billing lifecycle recovery payload is incomplete.",
        sentAt: null,
        failedAt,
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: claimUpdatedAt,
      });
      if (finalized === false) {
        result.conflicts += 1;
      } else {
        result.failed += 1;
      }
      continue;
    }

    const [currentBillingInfo, currentProfile] = await Promise.all([
      getUserPlanBillingInfo(env, attempt.userId),
      getUserDeliveryProfile(env, attempt.userId),
    ]);
    const currentEmail = readString(currentProfile?.email)?.toLowerCase() ?? null;
    const stateStillCurrent =
      billingLifecycleStateFingerprint(currentBillingInfo) ===
        payload.billingStateFingerprint &&
      currentEmail === payload.targetValue.toLowerCase();
    if (!stateStillCurrent) {
      const finalized = await updateDeliveryAttemptResult(env, attempt.id, {
        provider: EMAIL_PROVIDER,
        status: "skipped_due_to_dedupe",
        webhookStatus: "provider_unknown",
        providerMessageId: null,
        providerStatusLastSeenAt: null,
        templateName: attempt.templateName,
        errorMessage:
          "Billing lifecycle recovery was superseded by newer account state.",
        sentAt: null,
        failedAt: null,
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: claimUpdatedAt,
      });
      if (finalized === false) {
        result.conflicts += 1;
      } else {
        result.superseded += 1;
      }
      continue;
    }

    const providerResult = await sendCloudflareEmail(env, {
      to: payload.targetValue,
      subject: payload.subject,
      html: payload.bodyHtml,
      tag: payload.tag,
      unsubscribeUrl: null,
    });
    const finalized = await updateDeliveryAttemptResult(env, attempt.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: attempt.templateName,
      errorMessage: providerResult.errorMessage,
      sentAt: providerAcceptedAt(providerResult),
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
      expectedStatus: "pending",
      expectedWebhookStatus: "pending",
      expectedUpdatedAt: claimUpdatedAt,
    });
    if (finalized === false) {
      result.conflicts += 1;
    } else if (providerResult.status === "sent") {
      result.sent += 1;
    } else if (providerResult.status === "pending") {
      result.providerUnknown += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Resolve a provider-unknown lifecycle-email claim from external evidence.
 * Unknown outcomes are never re-sent automatically: an operator/provider
 * reconciliation must first mark the durable attempt sent (terminal) or
 * failed (safe for the existing in-place retry path).
 */
export async function reconcileBillingLifecycleEmailDelivery(
  env: AppEnv,
  input: {
    idempotencyKey: string;
    outcome: "sent" | "failed";
    reconciledAt: string;
    errorMessage?: string | null;
  },
) {
  if (!/^billing-(?:payment-issue|cancellation|refund):/.test(input.idempotencyKey)) {
    return false;
  }

  const attempt = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
  if (
    !attempt ||
    attempt.status !== "pending" ||
    attempt.webhookStatus !== "provider_unknown"
  ) {
    return false;
  }

  // Reconciliation is also a compare-and-set: conflicting external evidence
  // cannot overwrite whichever terminal outcome claimed the pending row
  // first. Older test adapters returned void, so only explicit false means
  // the durable claim was lost.
  const reconciled = await updateDeliveryAttemptResult(env, attempt.id, {
    provider: attempt.provider || EMAIL_PROVIDER,
    status: input.outcome,
    webhookStatus: input.outcome === "sent" ? "delivered" : "failed",
    providerMessageId: attempt.providerMessageId,
    providerStatusLastSeenAt: input.reconciledAt,
    errorMessage:
      input.outcome === "failed"
        ? input.errorMessage ?? "Provider reconciliation confirmed the email was not accepted."
        : null,
    sentAt: input.outcome === "sent" ? input.reconciledAt : null,
    failedAt: input.outcome === "failed" ? input.reconciledAt : null,
    expectedStatus: "pending",
  });
  return reconciled !== false;
}

// Dunning: a subscription payment failed and Dodo is retrying. Dodo emits
// these events repeatedly across its retry schedule, each with a fresh
// webhook id, so the key is day-coarse: at most one dunning email per
// customer per day no matter how the retries land.
export async function sendBillingPaymentIssueEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    occurredAt?: string | null;
    retryWebhookOnExplicitFailure?: boolean;
  },
) {
  const occurredAtMs = Date.parse(input.occurredAt ?? "");
  const dayKey = new Date(
    Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
  ).toISOString().slice(0, 10);
  return sendBillingLifecycleEmail(env, {
    userId: input.userId,
    email: input.email,
    idempotencyKey: `billing-payment-issue:${input.userId}:${dayKey}`,
    subject: "Action needed: a Five to Nine payment didn't go through",
    tag: "billing-payment-issue",
    templateName: "billing_payment_issue",
    retryWebhookOnExplicitFailure: input.retryWebhookOnExplicitFailure,
    bodyHtml: renderBillingEmailHtml({
      name: input.name,
      paragraphs: [
        "The latest payment for your Five to Nine subscription didn't go through. Nothing has changed yet — your plan stays active while the payment processor retries.",
        "To avoid an interruption, make sure your payment method is up to date.",
      ],
      ctaLabel: "Update payment method",
      ctaUrl: `${appBaseUrl(env)}/app/billing`,
      footnote:
        "If a retry has already succeeded, you can ignore this email — nothing changes.",
    }),
  });
}

// Cancellation, both shapes: "scheduled" (cancelled but paid through a
// future date) and "ended" (access revoked now — immediate cancellation or
// expiry). Keyed on the webhook event id: exactly one email per event even
// when the ledger re-runs the handler.
export async function sendBillingCancellationEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    kind: "scheduled" | "ended";
    effectiveAt?: string | null;
    eventId: string;
    retryWebhookOnExplicitFailure?: boolean;
  },
) {
  const billingUrl = `${appBaseUrl(env)}/app/billing`;
  const base = {
    userId: input.userId,
    email: input.email,
    idempotencyKey: `billing-cancellation:${input.userId}:${input.eventId}`,
    tag: "billing-cancellation",
    retryWebhookOnExplicitFailure: input.retryWebhookOnExplicitFailure,
  };

  if (input.kind === "scheduled") {
    const dateLabel = billingDateLabel(input.effectiveAt);
    const activeUntil = dateLabel
      ? `Your plan stays active until <strong>${escapeHtml(dateLabel)}</strong> — watchlists, digests, and alerts keep running until then.`
      : "Your plan stays active until the end of the period you already paid for — watchlists, digests, and alerts keep running until then.";
    return sendBillingLifecycleEmail(env, {
      ...base,
      subject: "Your Five to Nine cancellation is confirmed",
      templateName: "billing_cancellation_scheduled",
      bodyHtml: renderBillingEmailHtml({
        name: input.name,
        paragraphs: [
          `Your Five to Nine subscription is cancelled and won't renew. ${activeUntil}`,
          "After that, your workspace moves to the Free plan. Watchlists over the Free limit are paused automatically (the newest one stays active), and your boards, history, and evidence stay in place.",
        ],
        ctaLabel: "Review billing",
        ctaUrl: billingUrl,
        footnote:
          "Changed your mind? Once your access ends, resubscribe from your billing page — paused watchlists resume automatically.",
      }),
    });
  }

  return sendBillingLifecycleEmail(env, {
    ...base,
    subject: "Your Five to Nine plan has ended",
    templateName: "billing_access_ended",
    bodyHtml: renderBillingEmailHtml({
      name: input.name,
      paragraphs: [
        "Your Five to Nine subscription has ended and your workspace is now on the Free plan.",
        "Watchlists over the Free limit were paused automatically — the newest one stays active. Your boards, history, and evidence are untouched.",
      ],
      ctaLabel: "Reactivate your plan",
      ctaUrl: billingUrl,
      footnote:
        "Resubscribe any time — paused watchlists resume automatically when a plan is active again.",
    }),
  });
}

// Full refund: plan revoked to Free and purchased credits expired. Keyed on
// the webhook event id.
export async function sendBillingRefundEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    eventId: string;
    retryWebhookOnExplicitFailure?: boolean;
  },
) {
  return sendBillingLifecycleEmail(env, {
    userId: input.userId,
    email: input.email,
    idempotencyKey: `billing-refund:${input.userId}:${input.eventId}`,
    subject: "Your Five to Nine refund has been processed",
    tag: "billing-refund",
    templateName: "billing_refund_revoked",
    retryWebhookOnExplicitFailure: input.retryWebhookOnExplicitFailure,
    bodyHtml: renderBillingEmailHtml({
      name: input.name,
      paragraphs: [
        "A full refund for your Five to Nine purchase has been processed. Your workspace has moved to the Free plan, and credits from that purchase have expired.",
        "Your boards, history, and evidence stay in place on the Free plan.",
      ],
      ctaLabel: "View billing",
      ctaUrl: `${appBaseUrl(env)}/app/billing`,
      footnote:
        "If this refund is unexpected, contact support using the address below.",
    }),
  });
}

export async function sendTeamInviteEmail(
  env: AppEnv,
  input: {
    ownerUserId: string;
    ownerName: string | null;
    inviteeEmail: string;
    acceptUrl: string;
  },
) {
  const inviter = input.ownerName?.trim() ? escapeHtml(input.ownerName.trim()) : "A teammate";

  const providerResult = await sendCloudflareEmail(env, {
    to: input.inviteeEmail,
    subject: `${input.ownerName?.trim() || "Your team"} invited you to Five to Nine`,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">Hi,</p>
        <p style="margin: 0 0 16px;">${inviter} invited you to their Five to Nine workspace — shared watchlists, collections, and the morning digest on competitor changes.</p>
        <p style="margin: 0 0 20px;">
          <a href="${escapeHtml(input.acceptUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
            Join the workspace
          </a>
        </p>
        <p style="margin: 0; color: #5b6577; font-size: 13px;">
          The invite expires in 7 days. If you weren't expecting this, ignore this email — nothing changes.
        </p>
      </div>
    `,
    tag: "team-invite",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.ownerUserId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.inviteeEmail,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "team_invite",
    eventIds: [],
    payloadSnapshot: { kind: "team_invite" },
    idempotencyKey: `team-invite:${input.ownerUserId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}

export async function sendPasswordResetEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    resetUrl: string;
  },
) {
  // Transactional and user-initiated: this must reach unsubscribed addresses
  // too, so it carries no List-Unsubscribe header — but it still goes through
  // the shared Cloudflare Email path and records a delivery_attempt like
  // every other send. The reset URL contains a secret token and is therefore
  // never written to the payload snapshot.
  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: "Reset your Five to Nine password",
    html: renderPasswordResetHtml(input),
    tag: "password-reset",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "password_reset",
    eventIds: [],
    payloadSnapshot: { kind: "password_reset" },
    idempotencyKey: `password-reset:${input.userId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  if (providerResult.status === "failed") {
    throw new Error(providerResult.errorMessage ?? "Password reset email failed to send.");
  }
}

/**
 * Better Auth email-verification link delivery.
 * Transactional (no List-Unsubscribe): the verify URL carries a secret token
 * and must reach the inbox even if the address later unsubscribes from digests.
 * Token URLs are never persisted in delivery_attempt payloads.
 */
export async function sendEmailVerificationEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
    verifyUrl: string;
  },
) {
  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: "Verify your email for Five to Nine",
    html: renderEmailVerificationHtml(input),
    tag: "email-verification",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "email_verification",
    eventIds: [],
    payloadSnapshot: { kind: "email_verification" },
    idempotencyKey: `email-verification:${input.userId}:${crypto.randomUUID()}`,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  if (providerResult.status === "failed") {
    throw new Error(providerResult.errorMessage ?? "Email verification send failed.");
  }
}

function renderPasswordResetHtml(input: { name: string | null; resetUrl: string }) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";

  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 16px;">
        Someone asked to reset the password for this Five to Nine account. If that was you, use the
        button below — the link works for one hour.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.resetUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          Reset password
        </a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        If you didn't ask for this, you can ignore this email — your password stays unchanged.
      </p>
    </div>
  `;
}

function renderEmailVerificationHtml(input: { name: string | null; verifyUrl: string }) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";

  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 16px;">
        Confirm this email address to create watchlists and receive competitor digests on Five to Nine.
        You can keep browsing without verifying.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.verifyUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          Verify email
        </a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        If you did not create a Five to Nine account, you can ignore this email.
      </p>
    </div>
  `;
}

function renderDigestEmail(
  env: AppEnv,
  input: {
    digestRunId: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    items: DigestDeliveryItem[];
    heartbeat?: DigestHeartbeat | null;
    strategyParagraph?: string | null;
    cadence?: DigestCadence;
    timeZone?: string | null;
    unsubscribeUrl: string | null;
  },
): ReturnType<typeof buildDigestEmail> {
  const baseUrl = appBaseUrl(env);
  return buildDigestEmail({
    name: input.name,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    heartbeat: input.heartbeat ?? null,
    strategyParagraph: input.strategyParagraph ?? null,
    cadence: input.cadence,
    timeZone: input.timeZone ?? null,
    fullDigestUrl: `${baseUrl}/app/digests?digest=${encodeURIComponent(input.digestRunId)}`,
    manageFrequencyUrl: `${baseUrl}/app/notifications`,
    supportEmail: SUPPORT_EMAIL,
    supportMailto: SUPPORT_MAILTO,
    unsubscribeUrl: input.unsubscribeUrl,
  });
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
  });
  return result;
}

async function sendInstantEmail(
  env: AppEnv,
  input: {
    email: string;
    subject: string;
    html: string;
    unsubscribeUrl: string | null;
  },
) {
  return sendCloudflareEmail(env, {
    to: input.email,
    subject: input.subject,
    html: input.html,
    tag: "instant-alert",
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

async function sendCloudflareEmail(
  env: AppEnv,
  input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    tag: string;
    unsubscribeUrl: string | null;
  },
): Promise<EmailProviderResult> {
  if (!isEmailSendingConfigured(env)) {
    return {
      provider: EMAIL_PROVIDER,
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: "Email sending is not configured for this environment.",
      deliveredAt: null,
    };
  }

  const statusSeenAt = new Date().toISOString();
  const html = renderEmailShell({
    bodyHtml: input.html,
    unsubscribeUrl: input.unsubscribeUrl,
  });
  const headers: Record<string, string> = {
    "X-0509-Tag": input.tag,
  };
  if (input.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const result = await promiseWithTimeout(
      env.EMAIL!.send({
        from: emailFromSender(env),
        to: input.to,
        subject: input.subject,
        html,
        text: input.text ?? stripHtml(html),
        headers,
      }),
      CLOUDFLARE_EMAIL_SEND_TIMEOUT_MS,
      "Cloudflare Email send timed out",
    );

    return {
      provider: EMAIL_PROVIDER,
      status: "sent" as const,
      webhookStatus: "provider_unknown" as const,
      providerMessageId: result?.messageId ?? null,
      providerStatusLastSeenAt: statusSeenAt,
      errorMessage: null,
      deliveredAt: null,
    };
  } catch (error) {
    if (error instanceof PromiseTimeoutError) {
      return {
        provider: EMAIL_PROVIDER,
        status: "pending" as const,
        webhookStatus: "provider_unknown" as const,
        providerMessageId: null,
        providerStatusLastSeenAt: statusSeenAt,
        errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
        deliveredAt: null,
      };
    }

    return {
      provider: EMAIL_PROVIDER,
      status: "failed" as const,
      webhookStatus: "failed" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: statusSeenAt,
      errorMessage: `Cloudflare Email send failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      deliveredAt: null,
    };
  }
}

function appBaseUrl(env: AppEnv) {
  const value = env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim() || "";
  return value ? value.replace(/\/+$/, "") : "https://0509.io";
}

function providerAcceptedAt(result: EmailProviderResult) {
  return result.status === "sent" ? result.providerStatusLastSeenAt : null;
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
    emailEnabled: defaults.emailEnabled,
    whatsappEnabled: defaults.whatsappEnabled,
    slackEnabled: defaults.slackEnabled,
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
    watchlistId: string;
    lane: DeliveryLane;
    channel: DeliveryChannel;
    targetValue: string;
    batchKey: string;
    deferredByQuietHours: boolean;
  },
): Promise<{
  idempotencyKey: string;
  duplicate: DeliveryAttemptRecord | null;
  retryAttempt: DeliveryAttemptRecord | null;
}> {
  const attemptKind = input.deferredByQuietHours ? "quiet-hours" : "send";
  const idempotencyKey = buildInstantDeliveryAttemptIdempotencyKey({
    ...input,
    attemptKind,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
    // Same semantics as digests: a failed prior send is retryable in place;
    // anything else is a true duplicate. Without this, one transient provider
    // error lost the instant alert forever.
    if (!input.deferredByQuietHours && duplicate.status === "failed") {
      return { idempotencyKey, duplicate: null, retryAttempt: duplicate };
    }

    return { idempotencyKey, duplicate, retryAttempt: null };
  }

  const legacyIdempotencyKey = buildLegacyInstantDeliveryAttemptIdempotencyKey(input);
  const legacyDuplicate = await getDeliveryAttemptByIdempotencyKey(env, legacyIdempotencyKey);
  if (!legacyDuplicate) {
    return { idempotencyKey, duplicate: null, retryAttempt: null };
  }

  if (
    !input.deferredByQuietHours &&
    (legacyDuplicate.status === "skipped_due_to_quiet_hours" ||
      legacyDuplicate.status === "failed")
  ) {
    return { idempotencyKey, duplicate: null, retryAttempt: null };
  }

  return { idempotencyKey, duplicate: legacyDuplicate, retryAttempt: null };
}

function summarizeDeliveryAttempt(attempt: DeliveryAttemptRecord): DigestAttemptSummary {
  return {
    channel: attempt.channel,
    status: deliveryAttemptSummaryStatus(attempt.status),
    targetValue: attempt.targetValue,
    providerMessageId: attempt.providerMessageId,
    errorMessage: attempt.errorMessage,
    deliveredAt: attempt.sentAt,
  };
}

function deliveryAttemptSummaryStatus(status: DeliveryAttemptRecord["status"]) {
  if (status === "sent") return "sent";
  if (status === "pending") return "pending";
  return "failed";
}

function watchlistUrlFor(item: DigestDeliveryItem | undefined) {
  return item?.watchlistId
    ? `https://0509.io/app/watchlists?watchlist=${encodeURIComponent(item.watchlistId)}`
    : null;
}

function renderDigestHtml(input: {
  name: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
  heartbeat?: DigestHeartbeat | null;
  cadence?: DigestCadence;
  timeZone?: string | null;
}) {
  if (input.items.length === 0 && input.heartbeat) {
    const cadenceLabel = digestCadenceLabel(input.cadence);
    return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #0b1220; line-height: 1.5;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine ${escapeHtml(cadenceLabel)}</p>
      <h1 style="margin: 0 0 12px;">${escapeHtml(input.name || "Team")}, all quiet on your competitors.</h1>
      <p style="margin: 0 0 16px; color: #475467;">
        ${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)}
      </p>
      <p style="margin: 0 0 16px;">
        We ran ${input.heartbeat.runs} check${input.heartbeat.runs === 1 ? "" : "s"} across
        ${input.heartbeat.watchlistsChecked} competitor${input.heartbeat.watchlistsChecked === 1 ? "" : "s"}
        and reviewed ${input.heartbeat.adsSeen} ad${input.heartbeat.adsSeen === 1 ? "" : "s"} —
        no visible changes to offers, headlines, CTAs, forms, or destinations.
      </p>
      <p style="margin: 0; color: #475467;">
        No news is a result too: your competitors held position this period. We keep watching —
        the moment something moves, you'll hear about it.
      </p>
    </div>
  `;
  }

  const groups = input.items.reduce<Record<string, DigestDeliveryItem[]>>((accumulator, item) => {
    accumulator[item.watchlistName] = accumulator[item.watchlistName] ?? [];
    accumulator[item.watchlistName].push(item);
    return accumulator;
  }, {});
  const cadenceLabel = digestCadenceLabel(input.cadence);

  return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #0b1220; line-height: 1.5;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine ${escapeHtml(cadenceLabel)}</p>
      <h1 style="margin: 0 0 12px;">${escapeHtml(input.name || "Team")}, here’s what changed on Meta.</h1>
      <p style="margin: 0 0 24px; color: #475467;">
        ${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)} · ${input.items.length} tracked changes
      </p>
      ${Object.entries(groups)
        .map(
          ([watchlistName, items]) => `
            <section style="margin-bottom: 24px; padding: 18px; border: 1px solid #d7dce5; border-radius: 18px;">
              <h2 style="margin: 0 0 12px; font-size: 18px;">${
                watchlistUrlFor(items[0])
                  ? `<a href="${watchlistUrlFor(items[0])}" style="color: #0b1220; text-decoration: underline;">${escapeHtml(watchlistName)}</a>`
                  : escapeHtml(watchlistName)
              }</h2>
              <ul style="margin: 0; padding-left: 18px;">
                ${items
                  .map(
                    (item) => {
                      const intelligence = readDigestIntelligence(item.metadata);
                      const scoreLabel = intelligence.priorityScore === null
                        ? intelligence.priorityBand
                        : `${intelligence.priorityBand} · ${intelligence.priorityScore}/100`;
                      return `
                      <li style="margin-bottom: 10px;">
                        <strong>${escapeHtml(item.title)}</strong><br />
                        <span style="color: #475467;">${escapeHtml(item.summary)}</span>
                        <div style="margin-top: 6px; color: #5b6577; font-size: 13px;">
                          ${escapeHtml(scoreLabel)}<br />
                          Next: ${escapeHtml(intelligence.recommendedAction)}<br />
                          Evidence: ${escapeHtml(intelligence.proofTrail)}
                        </div>
                      </li>
                    `;
                    },
                  )
                  .join("")}
              </ul>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDigestSlackText(input: {
  cadenceLabel: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
  timeZone?: string | null;
}) {
  const lines = [
    `*Five to Nine ${escapeSlackText(input.cadenceLabel)}: ${input.items.length} competitor changes*`,
    `${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)}`,
  ];

  if (input.items.length === 0) {
    return [...lines, "No digest changes yet."].join("\n");
  }

  for (const item of input.items.slice(0, 10)) {
    const intelligence = readDigestIntelligence(item.metadata);
    const scoreLabel = intelligence.priorityScore === null
      ? intelligence.priorityBand
      : `${intelligence.priorityBand} - ${intelligence.priorityScore}/100`;
    lines.push(
      [
        `• *${escapeSlackText(item.watchlistName)}*: ${escapeSlackText(item.title)}`,
        `  ${escapeSlackText(item.summary)}`,
        `  Priority: ${escapeSlackText(scoreLabel)}`,
        `  Next: ${escapeSlackText(intelligence.recommendedAction)}`,
        `  Evidence: ${escapeSlackText(intelligence.proofTrail)}`,
      ].join("\n"),
    );
  }

  if (input.items.length > 10) {
    lines.push(`+${input.items.length - 10} more changes in Five to Nine.`);
  }

  return lines.join("\n\n");
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
  watchlistUrl: string | null;
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

function renderEventDiffHtml(event: WatchEventRecord) {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const from = typeof metadata.from === "string" ? metadata.from.trim() : "";
  const to = typeof metadata.to === "string" ? metadata.to.trim() : "";
  if (!from || !to) {
    return "";
  }

  // The one fact the customer actually wants: what it said before, and now.
  return `
    <table style="margin: 0 0 16px; border-collapse: collapse; font-size: 14px; background-color: #ffffff; color: #0b1220;">
      <tr>
        <td style="padding: 4px 10px 4px 0; color: #98a2b3; vertical-align: top;">Before</td>
        <td style="padding: 4px 0; color: #475467;">${escapeHtml(from)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 10px 4px 0; color: #98a2b3; vertical-align: top;">Now</td>
        <td style="padding: 4px 0; color: #0b1220;"><strong>${escapeHtml(to)}</strong></td>
      </tr>
    </table>
  `;
}

function renderEventDiffText(event: WatchEventRecord) {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const from = typeof metadata.from === "string" ? metadata.from.trim() : "";
  const to = typeof metadata.to === "string" ? metadata.to.trim() : "";
  return from && to ? ` — was "${from}", now "${to}"` : "";
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

  return `<img src="${escapeHtml(imageUrl)}" alt="Ad creative" width="280" style="display: block; max-width: 280px; border-radius: 8px; border: 1px solid #e4e7ec; margin: 12px 0;">`;
}

function buildInstantAlertContent(
  watchlist: Pick<WatchlistRecord, "id" | "name">,
  events: WatchEventRecord[],
  provisional: boolean,
  env: AppEnv,
  adsById?: Map<string, AdRecord>,
): InstantAlertContent {
  const primaryEvent = events[0];
  const competitor = readCompetitorLabel(primaryEvent) ?? watchlist.name;
  const watchlistUrl = buildWatchlistUrl(env, watchlist.id);
  const creativeImageHtml = renderCreativeImageHtml(primaryEvent, adsById);

  if (events.length === 1) {
    const isBaseline =
      ((primaryEvent.metadata ?? {}) as Record<string, unknown>).kind === "baseline";
    const subject = provisional
      ? `Possible change detected: ${competitor}`
      : isBaseline
        ? primaryEvent.title
        : buildInstantSubject(primaryEvent.eventType, competitor, primaryEvent.title);
    const shortChange = provisional
      ? "Possible change detected"
      : primaryEvent.title;

    return {
      competitor,
      shortChange,
      subject,
      watchlistUrl,
      html: `
        <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #0b1220; line-height: 1.5;">
          <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine alert</p>
          <h1 style="margin: 0 0 12px;">${escapeHtml(subject)}</h1>
          <p style="margin: 0 0 16px; color: #475467;">${escapeHtml(primaryEvent.summary)}</p>
          ${renderEventDiffHtml(primaryEvent)}
          ${creativeImageHtml}
          ${watchlistUrl ? `<p style="margin: 0;"><a href="${watchlistUrl}" style="color: #2563eb; text-decoration: underline;">See the evidence</a></p>` : ""}
        </div>
      `,
    };
  }

  const subject = provisional
    ? `Possible changes detected: ${competitor}`
    : `${competitor}: ${events.length} changes detected`;

  return {
    competitor,
    shortChange: `${events.length} watchlist changes`,
    subject,
    watchlistUrl,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #0b1220; line-height: 1.5;">
        <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine alert</p>
        <h1 style="margin: 0 0 12px;">${escapeHtml(subject)}</h1>
        ${creativeImageHtml}
        <ul style="padding-left: 18px;">
          ${events
            .map(
              (event) => `
                <li style="margin-bottom: 10px;">
                  <strong>${escapeHtml(event.title)}</strong><br />
                  <span style="color: #475467;">${escapeHtml(event.summary)}${escapeHtml(renderEventDiffText(event))}</span>
                </li>
              `,
            )
            .join("")}
        </ul>
        ${watchlistUrl ? `<p style="margin: 16px 0 0;"><a href="${watchlistUrl}" style="color: #2563eb; text-decoration: underline;">View watchlist</a></p>` : ""}
      </div>
    `,
  };
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

  if (content.watchlistUrl) {
    lines.push(`<${content.watchlistUrl}|View watchlist>`);
  }

  return lines.join("\n");
}

function buildInstantSubject(eventType: WatchEventRecord["eventType"], competitor: string, fallbackTitle: string) {
  switch (eventType) {
    case "ad_new":
      return `New ad from ${competitor}`;
    case "ad_inactive":
      return `Ad went inactive: ${competitor}`;
    case "landing_page_url_changed":
      return `Landing page URL changed: ${competitor}`;
    case "landing_page_headline_changed":
    case "landing_page_offer_changed":
    case "landing_page_cta_changed":
    case "landing_page_form_changed":
      return `${fallbackTitle}: ${competitor}`;
    default:
      return `${fallbackTitle}: ${competitor}`;
  }
}

function readCompetitorLabel(event: WatchEventRecord) {
  const advertiser = event.metadata.advertiser;
  return typeof advertiser === "string" && advertiser.trim().length > 0 ? advertiser : null;
}

function buildWatchlistUrl(env: AppEnv, watchlistId: string) {
  const baseUrl = env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/+$/, "")}/app/watchlists?watchlist=${encodeURIComponent(watchlistId)}`;
}

function dedupeTargetsByValue(targets: DeliveryTargetRecord[]) {
  const deduped = new Map<string, DeliveryTargetRecord>();
  for (const target of targets) {
    deduped.set(`${target.channel}:${target.targetValue.trim().toLowerCase()}`, target);
  }
  return [...deduped.values()];
}

// Digest period dates are formatted in the workspace's configured delivery
// timezone when one exists, otherwise UTC. Locale-neutral en-GB on purpose —
// recipients are global, so no regional locale default.
function formatDate(value: string, timeZone?: string | null) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: safeTimeZone(timeZone),
  }).format(new Date(value));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
  const htmlLines = input.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: input.subject,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">Presence tracking updates</p>
        <ul style="margin: 0 0 16px; padding-left: 20px;">${htmlLines}</ul>
        <p style="margin: 0;"><a href="${escapeHtml(buildPresenceAppUrl(env))}">Open presence tracking</a></p>
      </div>
    `,
    tag: "presence-digest",
    unsubscribeUrl: null,
  });

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: null,
    lane: "customer",
    channel: "email",
    provider: providerResult.provider,
    status: providerResult.status,
    webhookStatus: providerResult.webhookStatus,
    targetValue: input.email,
    providerMessageId: providerResult.providerMessageId,
    providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
    templateName: "presence_digest",
    eventIds: [],
    payloadSnapshot: { kind: "presence_digest", lineCount: input.lines.length },
    idempotencyKey: input.idempotencyKey,
    errorMessage: providerResult.errorMessage,
    sentAt: providerAcceptedAt(providerResult),
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}

function buildPresenceAppUrl(env: AppEnv) {
  const baseUrl = env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim() || "https://0509.io";
  return `${baseUrl.replace(/\/+$/, "")}/app/presence`;
}
