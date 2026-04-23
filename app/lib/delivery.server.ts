import { Resend } from "resend";

import {
  createDeliveryAttempt,
  getDeliveryAttemptByIdempotencyKey,
  getWatchlistDeliveryConfig,
  getWorkspaceDeliveryConfig,
  legacyWorkspaceDeliveryDefaults,
  listDeliveryTargets,
  reconcileDeliveryAttemptByProviderMessageId,
  upsertDeliveryTarget,
  upsertDigestDelivery,
} from "~/lib/data.server";
import { evaluateDeliveryPolicy, resolveDeliveryConfig } from "~/lib/delivery-policy.server";
import type { AppEnv } from "~/lib/env.server";
import { isResendConfigured } from "~/lib/env.server";
import type {
  DeliveryChannel,
  DeliveryTargetRecord,
  WatchEventRecord,
  WatchlistRecord,
  WatchlistDeliveryConfigRecord,
  WorkspaceDeliveryConfigRecord,
  DeliveryLane,
} from "~/lib/types";
import { sendDigestWhatsApp, sendInstantWhatsApp } from "~/lib/whatsapp.server";

const AUTO_PROVISIONED_EMAIL_SOURCE = "account_email";

interface DigestAttemptSummary {
  channel: DeliveryChannel;
  status: "sent" | "failed";
  targetValue: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
}

export interface DigestDeliveryItem {
  eventId: string;
  watchlistId: string;
  watchlistName: string;
  eventType: string;
  title: string;
  summary: string;
}

export interface DeliverWeeklyDigestInput {
  userId: string;
  userName: string;
  accountEmail: string | null;
  digestRunId: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
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
    };
  }

  const lane = input.lane ?? "customer";
  const emailTargets = config.emailEnabled
    ? await resolveDigestEmailTargets(env, input.userId, input.accountEmail)
    : [];
  const whatsappTargets = config.whatsappEnabled
    ? await resolveDigestWhatsAppTargets(env, input.userId)
    : [];

  const attempts: DigestAttemptSummary[] = [];

  for (const target of emailTargets) {
    attempts.push(await deliverDigestToEmailTarget(env, input, lane, target));
  }

  for (const target of whatsappTargets) {
    attempts.push(await deliverDigestToWhatsAppTarget(env, input, lane, target));
  }

  const primaryEmailAttempt = attempts.find((attempt) => attempt.channel === "email");
  if (primaryEmailAttempt) {
    await upsertDigestDelivery(env, input.digestRunId, {
      provider: "resend",
      status: primaryEmailAttempt.status,
      recipientEmail: primaryEmailAttempt.targetValue,
      externalMessageId: primaryEmailAttempt.providerMessageId,
      errorMessage: primaryEmailAttempt.errorMessage,
      deliveredAt: primaryEmailAttempt.deliveredAt,
    });
  }

  return {
    attempts: attempts.length,
    channels: [...new Set(attempts.map((attempt) => attempt.channel))],
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
    providerStatusLastSeenAt: string;
    errorMessage?: string | null;
  },
) {
  return reconcileDeliveryAttemptByProviderMessageId(env, input);
}

async function deliverDigestToEmailTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
): Promise<DigestAttemptSummary> {
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "email",
    targetValue: target.targetValue,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
    return {
      channel: "email" as const,
      status: duplicate.status === "sent" ? "sent" : "failed",
      targetValue: duplicate.targetValue,
      providerMessageId: duplicate.providerMessageId,
      errorMessage: duplicate.errorMessage,
      deliveredAt: duplicate.sentAt,
    };
  }

  const subject = `Five to Nine weekly digest: ${input.items.length} competitor changes`;
  const providerResult = await sendDigestEmail(env, {
    email: target.targetValue,
    name: input.userName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    subject,
  });

  const attemptId = await createDeliveryAttempt(env, {
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
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      itemCount: input.items.length,
    },
    idempotencyKey,
    errorMessage: providerResult.errorMessage,
    sentAt: providerResult.deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

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
  const idempotencyKey = buildInstantDeliveryAttemptIdempotencyKey({
    watchlistId: input.watchlistId,
    lane: input.lane,
    channel: "email",
    targetValue: input.deliveryTarget.targetValue,
    batchKey: input.batch.batchKey,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
    return {
      channel: "email",
      status: duplicate.status === "sent" ? "sent" : "failed",
      targetValue: duplicate.targetValue,
      providerMessageId: duplicate.providerMessageId,
      errorMessage: duplicate.errorMessage,
      deliveredAt: duplicate.sentAt,
    };
  }

  if (input.batch.deferredByQuietHours) {
    await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTarget.id,
      lane: input.lane,
      channel: "email",
      provider: "resend",
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
      idempotencyKey,
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
  });

  const attemptId = await createDeliveryAttempt(env, {
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
    idempotencyKey,
    errorMessage: providerResult.errorMessage,
    sentAt: providerResult.deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

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
  const idempotencyKey = buildInstantDeliveryAttemptIdempotencyKey({
    watchlistId: input.watchlistId,
    lane: input.lane,
    channel: "whatsapp",
    targetValue: input.deliveryTarget.targetValue,
    batchKey: input.batch.batchKey,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
    return {
      channel: "whatsapp",
      status: duplicate.status === "sent" ? "sent" : "failed",
      targetValue: duplicate.targetValue,
      providerMessageId: duplicate.providerMessageId,
      errorMessage: duplicate.errorMessage,
      deliveredAt: duplicate.sentAt,
    };
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
      idempotencyKey,
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
  const attemptId = await createDeliveryAttempt(env, {
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
    idempotencyKey,
    errorMessage: providerResult.errorMessage,
    sentAt: deliveredAt,
    failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
  });

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

async function deliverDigestToWhatsAppTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
): Promise<DigestAttemptSummary> {
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "whatsapp",
    targetValue: target.targetValue,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
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
  });
  const attemptId = await createDeliveryAttempt(env, {
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

async function resolveDigestEmailTargets(
  env: AppEnv,
  userId: string,
  accountEmail: string | null,
) {
  const configuredTargets = (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "email",
    limit: 10,
  })).filter((target) => !target.isPaused && target.validationStatus !== "invalid");

  if (configuredTargets.length > 0) {
    return configuredTargets;
  }

  if (!accountEmail) {
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
  const combinedTargets = dedupeTargetsByValue([
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
  ]).filter((target) => !target.isPaused && target.validationStatus !== "invalid");

  if (combinedTargets.length > 0) {
    return combinedTargets;
  }

  if (!accountEmail) {
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
  })).filter((target) => !target.isPaused && target.isOptedIn && !target.optedOutAt);
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
  ]).filter(
    (target) =>
      !target.isPaused &&
      target.isOptedIn &&
      !target.optedOutAt &&
      target.isValidated &&
      target.validationStatus === "validated",
  );
}

async function sendDigestEmail(
  env: AppEnv,
  input: {
    email: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    items: DigestDeliveryItem[];
    subject: string;
  },
): Promise<{
  provider: "resend";
  status: "sent" | "failed";
  webhookStatus: "pending" | "failed" | "provider_unknown";
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
}> {
  if (!isResendConfigured(env)) {
    return {
      provider: "resend",
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: "Resend is not configured for this environment.",
      deliveredAt: null,
    };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const html = renderDigestHtml({
    name: input.name,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
  });
  const response = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL!,
    to: input.email,
    subject: input.subject,
    html,
    text: stripHtml(html),
  });

  if (response.error) {
    return {
      provider: "resend",
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: new Date().toISOString(),
      errorMessage: response.error.message,
      deliveredAt: null,
    };
  }

  return {
    provider: "resend",
    status: "sent",
    webhookStatus: "pending",
    providerMessageId: response.data?.id ?? null,
    providerStatusLastSeenAt: new Date().toISOString(),
    errorMessage: null,
    deliveredAt: new Date().toISOString(),
  };
}

async function sendInstantEmail(
  env: AppEnv,
  input: {
    email: string;
    subject: string;
    html: string;
  },
) {
  if (!isResendConfigured(env)) {
    return {
      provider: "resend" as const,
      status: "failed" as const,
      webhookStatus: "provider_unknown" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: "Resend is not configured for this environment.",
      deliveredAt: null,
    };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const response = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL!,
    to: input.email,
    subject: input.subject,
    html: input.html,
    text: stripHtml(input.html),
  });

  if (response.error) {
    return {
      provider: "resend" as const,
      status: "failed" as const,
      webhookStatus: "failed" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: new Date().toISOString(),
      errorMessage: response.error.message,
      deliveredAt: null,
    };
  }

  return {
    provider: "resend" as const,
    status: "sent" as const,
    webhookStatus: "pending" as const,
    providerMessageId: response.data?.id ?? null,
    providerStatusLastSeenAt: new Date().toISOString(),
    errorMessage: null,
    deliveredAt: new Date().toISOString(),
  };
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

function buildInstantDeliveryAttemptIdempotencyKey(input: {
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

function renderDigestHtml(input: {
  name: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
}) {
  const groups = input.items.reduce<Record<string, DigestDeliveryItem[]>>((accumulator, item) => {
    accumulator[item.watchlistName] = accumulator[item.watchlistName] ?? [];
    accumulator[item.watchlistName].push(item);
    return accumulator;
  }, {});

  return `
    <div style="font-family: Inter, system-ui, sans-serif; color: #0b1220; line-height: 1.5;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine weekly digest</p>
      <h1 style="margin: 0 0 12px;">${escapeHtml(input.name || "Team")}, here’s what changed on Meta.</h1>
      <p style="margin: 0 0 24px; color: #475467;">
        ${formatDate(input.periodStart)} to ${formatDate(input.periodEnd)} · ${input.items.length} tracked changes
      </p>
      ${Object.entries(groups)
        .map(
          ([watchlistName, items]) => `
            <section style="margin-bottom: 24px; padding: 18px; border: 1px solid #d7dce5; border-radius: 18px;">
              <h2 style="margin: 0 0 12px; font-size: 18px;">${escapeHtml(watchlistName)}</h2>
              <ul style="margin: 0; padding-left: 18px;">
                ${items
                  .map(
                    (item) => `
                      <li style="margin-bottom: 10px;">
                        <strong>${escapeHtml(item.title)}</strong><br />
                        <span style="color: #475467;">${escapeHtml(item.summary)}</span>
                      </li>
                    `,
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
    const subject = provisional
      ? `Possible change detected: ${competitor}`
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
          ${watchlistUrl ? `<p style="margin: 0;"><a href="${watchlistUrl}">View watchlist</a></p>` : ""}
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
                  <span style="color: #475467;">${escapeHtml(event.summary)}</span>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
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
