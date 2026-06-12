import {
  type DigestCadence,
  digestCadenceLabel,
  readDigestIntelligence,
} from "~/lib/change-intelligence";
import { safeTimeZone } from "~/lib/safe-timezone";
import {
  createDeliveryAttempt,
  getDeliveryAttemptByIdempotencyKey,
  getOldestUserId,
  getUserIdByEmail,
  getDeliveryTargetById,
  getDeliveryTargetByProviderIdentifier,
  getWatchlistDeliveryConfig,
  getWorkspaceDeliveryConfig,
  legacyWorkspaceDeliveryDefaults,
  listDeliveryTargets,
  reconcileDeliveryAttemptByProviderMessageId,
  updateDeliveryAttemptResult,
  upsertDeliveryTarget,
  upsertDigestDelivery,
} from "~/lib/data.server";
import { evaluateDeliveryPolicy, resolveDeliveryConfig } from "~/lib/delivery-policy.server";
import type { AppEnv } from "~/lib/env.server";
import { emailFromAddress, isEmailSendingConfigured } from "~/lib/env.server";
import { buildUnsubscribeUrl } from "~/lib/unsubscribe.server";
import type {
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

const AUTO_PROVISIONED_EMAIL_SOURCE = "account_email";
const EMAIL_PROVIDER = "cloudflare_email" as const;

interface DigestAttemptSummary {
  channel: DeliveryChannel;
  status: "sent" | "failed";
  targetValue: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
}

type EmailProviderResult = {
  provider: typeof EMAIL_PROVIDER;
  status: "sent" | "failed";
  webhookStatus: "pending" | "failed" | "provider_unknown";
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
};

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
  const workspaceConfigRecord =
    (await getWorkspaceDeliveryConfig(env, input.userId)) ??
    buildLegacyWorkspaceConfig(input.userId, Boolean(input.accountEmail));
  const config = resolveDeliveryConfig({
    workspaceConfig: workspaceConfigRecord,
    watchlistConfig: null,
  });

  if (!config.digestEnabled) {
    return {
      attempts: 0,
      channels: [] as DeliveryChannel[],
      details: [] as DigestAttemptSummary[],
    };
  }

  const lane = input.lane ?? "customer";
  const isHeartbeat = input.items.length === 0 && Boolean(input.heartbeat);
  const emailTargets = config.emailEnabled
    ? await resolveDigestEmailTargets(env, input.userId, input.accountEmail)
    : [];
  // "All quiet" heartbeats stay email-only: a WhatsApp template or Slack
  // ping saying nothing happened reads as noise on those channels.
  const whatsappTargets = !isHeartbeat && config.whatsappEnabled
    ? await resolveDigestWhatsAppTargets(env, input.userId)
    : [];
  const slackTargets = !isHeartbeat && config.slackEnabled
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
  const workspaceConfigRecord =
    (await getWorkspaceDeliveryConfig(env, input.userId)) ??
    buildLegacyWorkspaceConfig(input.userId, Boolean(input.accountEmail));
  const watchlistConfig = await getWatchlistDeliveryConfig(env, input.watchlist.id);
  const batches = buildInstantAlertBatches({
    lane,
    events: input.events,
    workspaceConfig: workspaceConfigRecord,
    watchlistConfig,
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
  const whatsappTargets = batches.some((batch) => batch.allowedChannels.includes("whatsapp"))
    ? await resolveAlertWhatsAppTargets(env, input.userId, input.watchlist.id)
    : [];
  const slackTargets = batches.some((batch) => batch.allowedChannels.includes("slack"))
    ? await resolveAlertSlackTargets(env, input.userId, input.watchlist.id)
    : [];

  const attempts: DigestAttemptSummary[] = [];

  for (const batch of batches) {
    const content = buildInstantAlertContent(input.watchlist, batch.events, batch.provisional, env);

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
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  // A failed prior attempt is retryable; anything else is a true duplicate.
  if (duplicate && duplicate.status !== "failed") {
    return {
      channel: "email" as const,
      status: duplicate.status === "sent" ? "sent" : "failed",
      targetValue: duplicate.targetValue,
      providerMessageId: duplicate.providerMessageId,
      errorMessage: duplicate.errorMessage,
      deliveredAt: duplicate.sentAt,
    };
  }

  const cadenceLabel = digestCadenceLabel(input.cadence);
  const isHeartbeat = input.items.length === 0 && Boolean(input.heartbeat);
  const subject = isHeartbeat
    ? `Five to Nine ${cadenceLabel}: all quiet — ${input.heartbeat!.adsSeen} ads checked`
    : `Five to Nine ${cadenceLabel}: ${input.items.length} competitor changes`;
  const providerResult = await sendDigestEmail(env, {
    email: target.targetValue,
    name: input.userName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    heartbeat: input.heartbeat ?? null,
    subject,
    cadence: input.cadence,
    timeZone,
    unsubscribeUrl: await buildUnsubscribeUrl(env, {
      userId: target.userId,
      targetId: target.id,
    }),
  });

  let attemptId: string;
  if (duplicate) {
    await updateDeliveryAttemptResult(env, duplicate.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
    attemptId = duplicate.id;
  } else {
    attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: null,
      digestRunId: input.digestRunId,
      deliveryTargetId: target.id,
      lane,
      channel: "email",
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      targetValue: target.targetValue,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: null,
      eventIds: input.items.map((item) => item.eventId),
      payloadSnapshot: {
        kind: "weekly_digest",
        channel: "email",
        subject,
        cadence: input.cadence ?? "weekly",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        itemCount: input.items.length,
      },
      idempotencyKey,
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, target, attemptId, providerResult.deliveredAt);
  }

  return {
    channel: "email" as const,
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.deliveredAt,
  };
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
      sentAt: providerResult.deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, input.deliveryTarget, attemptId, providerResult.deliveredAt);
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
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  // A failed prior attempt is retryable; anything else is a true duplicate.
  if (duplicate && duplicate.status !== "failed") {
    return {
      channel: "whatsapp" as const,
      status: duplicate.status === "sent" ? "sent" : "failed",
      targetValue: duplicate.targetValue,
      providerMessageId: duplicate.providerMessageId,
      errorMessage: duplicate.errorMessage,
      deliveredAt: duplicate.sentAt,
    };
  }

  const providerResult = await sendDigestWhatsApp(env, {
    lane,
    target,
    itemCount: input.items.length,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    timeZone,
  });
  let attemptId: string;
  if (duplicate) {
    await updateDeliveryAttemptResult(env, duplicate.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.status === "sent" ? new Date().toISOString() : null,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
    attemptId = duplicate.id;
  } else {
    attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: null,
      digestRunId: input.digestRunId,
      deliveryTargetId: target.id,
      lane,
      channel: "whatsapp",
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      targetValue: target.targetValue,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: providerResult.templateName,
      eventIds: input.items.map((item) => item.eventId),
      payloadSnapshot: {
        kind: "weekly_digest",
        channel: "whatsapp",
        templateName: providerResult.templateName,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        itemCount: input.items.length,
      },
      idempotencyKey,
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.status === "sent" ? new Date().toISOString() : null,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, target, attemptId, new Date().toISOString());
  }

  return {
    channel: "whatsapp" as const,
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.status === "sent" ? new Date().toISOString() : null,
  };
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
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  // A failed prior attempt is retryable; anything else is a true duplicate.
  if (duplicate && duplicate.status !== "failed") {
    return {
      channel: "slack" as const,
      status: duplicate.status === "sent" ? "sent" : "failed",
      targetValue: duplicate.targetValue,
      providerMessageId: duplicate.providerMessageId,
      errorMessage: duplicate.errorMessage,
      deliveredAt: duplicate.sentAt,
    };
  }

  const cadenceLabel = digestCadenceLabel(input.cadence);
  const providerResult = await sendSlackWebhookMessage(env, target, {
    text: renderDigestSlackText({
      cadenceLabel,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      items: input.items,
      timeZone,
    }),
  });
  let attemptId: string;
  if (duplicate) {
    await updateDeliveryAttemptResult(env, duplicate.id, {
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
    attemptId = duplicate.id;
  } else {
    attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: null,
      digestRunId: input.digestRunId,
      deliveryTargetId: target.id,
      lane,
      channel: "slack",
      provider: providerResult.provider,
      status: providerResult.status,
      webhookStatus: providerResult.webhookStatus,
      targetValue: target.targetValue,
      providerMessageId: providerResult.providerMessageId,
      providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
      templateName: null,
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
      errorMessage: providerResult.errorMessage,
      sentAt: providerResult.deliveredAt,
      failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
    });
  }

  if (providerResult.status === "sent") {
    await persistDeliveryTargetSuccess(env, target, attemptId, providerResult.deliveredAt);
  }

  return {
    channel: "slack" as const,
    status: providerResult.status,
    targetValue: target.targetValue,
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.errorMessage,
    deliveredAt: providerResult.deliveredAt,
  };
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
  return (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "whatsapp",
    limit: 10,
  })).filter(isUsableWhatsAppTarget);
}

async function resolveAlertWhatsAppTargets(env: AppEnv, userId: string, watchlistId: string) {
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
  return (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "slack",
    limit: 10,
  })).filter(isUsableSlackTarget);
}

async function resolveAlertSlackTargets(env: AppEnv, userId: string, watchlistId: string) {
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

// One nightly "customer-at-risk" email to the operator when monitoring or
// delivery is degrading for paying customers — the ops dashboard is
// pull-only and nobody is paged to it. Day-keyed idempotency: max one/day.
export async function sendOperatorAlertEmail(
  env: AppEnv,
  input: {
    subject: string;
    lines: string[];
    idempotencyKey?: string;
  },
) {
  const recipient = env.LAUNCH_CANARY_EMAIL?.trim();
  if (!recipient) {
    return false;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const idempotencyKey = input.idempotencyKey ?? `operator-alert:${dayKey}`;
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
    return false;
  }

  const providerResult = await sendCloudflareEmail(env, {
    to: recipient,
    subject: input.subject,
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; color: #1d2433; font-size: 14px; line-height: 1.6;">
        <p style="margin: 0 0 12px;"><strong>Customer-at-risk signals from last night's run:</strong></p>
        <ul style="margin: 0 0 12px; padding-left: 18px;">
          ${input.lines.map((line) => `<li style="margin: 0 0 6px;">${escapeHtml(line)}</li>`).join("")}
        </ul>
        <p style="margin: 0; color: #5b6577; font-size: 12px;">
          Details: https://0509.in/app/ops
        </p>
      </div>
    `,
    tag: "operator-alert",
    unsubscribeUrl: null,
  });

  // delivery_attempt.user_id carries a foreign key to user(id), so the
  // attempt must be attributed to a REAL user row: the operator's own account
  // when it exists, else the oldest account (the founder's). Without this the
  // nightly insert violated the FK — the email sent but the dedupe row never
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
    payloadSnapshot: { kind: "operator_alert", lines: input.lines },
    idempotencyKey,
    errorMessage: providerResult.errorMessage,
    sentAt: providerResult.deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  return providerResult.status === "sent";
}

export async function sendDeliveryTestEmail(
  env: AppEnv,
  input: {
    userId: string;
    email: string;
    name: string | null;
  },
) {
  // Cloudflare Email has no bounce webhooks, so a typo'd address shows
  // "sent" forever while the customer receives nothing. This send gives
  // them a way to prove the address works end-to-end.
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
  const providerResult = await sendCloudflareEmail(env, {
    to: input.email,
    subject: "Test email from Five to Nine",
    html: `
      <div style="font-family: Inter, system-ui, sans-serif; color: #1d2433; font-size: 15px; line-height: 1.6;">
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
    sentAt: providerResult.deliveredAt,
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
      <div style="font-family: Inter, system-ui, sans-serif; color: #1d2433; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 12px;">${greeting}</p>
        <p style="margin: 0 0 16px;">${copy.body}</p>
        <p style="margin: 0 0 20px;">
          <a href="${escapeHtml(input.actionUrl)}" style="display: inline-block; background: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
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
    sentAt: providerResult.deliveredAt,
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
    sentAt: providerResult.deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

  if (providerResult.status === "failed") {
    throw new Error(providerResult.errorMessage ?? "Password reset email failed to send.");
  }
}

function renderPasswordResetHtml(input: { name: string | null; resetUrl: string }) {
  const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";

  return `
    <div style="font-family: Inter, system-ui, sans-serif; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 16px;">
        Someone asked to reset the password for this Five to Nine account. If that was you, use the
        button below — the link works for one hour.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.resetUrl)}" style="display: inline-block; background: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          Reset password
        </a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        If you didn't ask for this, you can ignore this email — your password stays unchanged.
      </p>
    </div>
  `;
}

async function sendDigestEmail(
  env: AppEnv,
  input: {
    email: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    items: DigestDeliveryItem[];
    heartbeat?: DigestHeartbeat | null;
    subject: string;
    cadence?: DigestCadence;
    timeZone?: string | null;
    unsubscribeUrl: string | null;
  },
): Promise<EmailProviderResult> {
  const html = renderDigestHtml({
    name: input.name,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    heartbeat: input.heartbeat ?? null,
    cadence: input.cadence,
    timeZone: input.timeZone ?? null,
  });
  return sendCloudflareEmail(env, {
    to: input.email,
    subject: input.subject,
    html,
    tag: "weekly-digest",
    unsubscribeUrl: input.unsubscribeUrl,
  });
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
  const html = appendEmailFooter(input.html, input.unsubscribeUrl);
  const headers: Record<string, string> = {
    "X-0509-Tag": input.tag,
  };
  if (input.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const result = await env.EMAIL!.send({
      from: emailFromAddress(env),
      to: input.to,
      subject: input.subject,
      html,
      text: stripHtml(html),
      headers,
    });

    return {
      provider: EMAIL_PROVIDER,
      status: "sent" as const,
      webhookStatus: "provider_unknown" as const,
      providerMessageId: result?.messageId ?? null,
      providerStatusLastSeenAt: statusSeenAt,
      errorMessage: null,
      deliveredAt: statusSeenAt,
    };
  } catch (error) {
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

function appendEmailFooter(html: string, unsubscribeUrl: string | null) {
  const unsubscribeLink = unsubscribeUrl
    ? ` · <a href="${unsubscribeUrl}" style="color: #5b6577;">Unsubscribe</a>`
    : "";

  return `${html}
    <hr style="margin: 28px 0 14px; border: none; border-top: 1px solid #e4e7ec;" />
    <p style="font-family: Inter, system-ui, sans-serif; margin: 0; color: #98a2b3; font-size: 12px; line-height: 1.5;">
      Five to Nine · <a href="https://0509.in" style="color: #5b6577;">0509.in</a> · Questions? <a href="mailto:support@0509.in" style="color: #5b6577;">support@0509.in</a> · You're receiving this because email delivery is configured for your workspace${unsubscribeLink}
    </p>
  `;
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
    status: attempt.status === "sent" ? "sent" : "failed",
    targetValue: attempt.targetValue,
    providerMessageId: attempt.providerMessageId,
    errorMessage: attempt.errorMessage,
    deliveredAt: attempt.sentAt,
  };
}

function watchlistUrlFor(item: DigestDeliveryItem | undefined) {
  return item?.watchlistId
    ? `https://0509.in/app/watchlists?watchlist=${encodeURIComponent(item.watchlistId)}`
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
    <div style="font-family: Inter, system-ui, sans-serif; color: #0b1220; line-height: 1.5;">
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
    <div style="font-family: Inter, system-ui, sans-serif; color: #0b1220; line-height: 1.5;">
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
                  ? `<a href="${watchlistUrlFor(items[0])}" style="color: #0b1220; text-decoration: none;">${escapeHtml(watchlistName)}</a>`
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
                          Proof: ${escapeHtml(intelligence.proofTrail)}
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
        `  Proof: ${escapeSlackText(intelligence.proofTrail)}`,
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
    <table style="margin: 0 0 16px; border-collapse: collapse; font-size: 14px;">
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

function buildInstantAlertContent(
  watchlist: Pick<WatchlistRecord, "id" | "name">,
  events: WatchEventRecord[],
  provisional: boolean,
  env: AppEnv,
): InstantAlertContent {
  const primaryEvent = events[0];
  const competitor = readCompetitorLabel(primaryEvent) ?? watchlist.name;
  const watchlistUrl = buildWatchlistUrl(env, watchlist.id);

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
        <div style="font-family: Inter, system-ui, sans-serif; color: #0b1220; line-height: 1.5;">
          <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine alert</p>
          <h1 style="margin: 0 0 12px;">${escapeHtml(subject)}</h1>
          <p style="margin: 0 0 16px; color: #475467;">${escapeHtml(primaryEvent.summary)}</p>
          ${renderEventDiffHtml(primaryEvent)}
          ${watchlistUrl ? `<p style="margin: 0;"><a href="${watchlistUrl}">See the evidence</a></p>` : ""}
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
      <div style="font-family: Inter, system-ui, sans-serif; color: #0b1220; line-height: 1.5;">
        <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine alert</p>
        <h1 style="margin: 0 0 12px;">${escapeHtml(subject)}</h1>
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
        ${watchlistUrl ? `<p style="margin: 16px 0 0;"><a href="${watchlistUrl}">View watchlist</a></p>` : ""}
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
  const baseUrl = env.BETTER_AUTH_URL?.trim();
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
