import {
  type DigestCadence,
  digestCadenceLabel,
  readDigestIntelligence,
} from "~/lib/change-intelligence";
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
import { isPostmarkConfigured, postmarkFromEmail, postmarkMessageStream } from "~/lib/env.server";
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
const EMAIL_PROVIDER = "postmark" as const;
const POSTMARK_EMAIL_API_URL = "https://api.postmarkapp.com/email";

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

export interface DeliverWeeklyDigestInput {
  userId: string;
  userName: string;
  accountEmail: string | null;
  digestRunId: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
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
  const emailTargets = config.emailEnabled
    ? await resolveDigestEmailTargets(env, input.userId, input.accountEmail)
    : [];
  const whatsappTargets = config.whatsappEnabled
    ? await resolveDigestWhatsAppTargets(env, input.userId)
    : [];
  const slackTargets = config.slackEnabled
    ? await resolveDigestSlackTargets(env, input.userId)
    : [];

  const attempts: DigestAttemptSummary[] = [];

  for (const target of emailTargets) {
    attempts.push(await deliverDigestToEmailTarget(env, input, lane, target));
  }

  for (const target of whatsappTargets) {
    attempts.push(await deliverDigestToWhatsAppTarget(env, input, lane, target));
  }

  for (const target of slackTargets) {
    attempts.push(await deliverDigestToSlackTarget(env, input, lane, target));
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
    providerStatusLastSeenAt: string;
    errorMessage?: string | null;
  },
) {
  return reconcileDeliveryAttemptByProviderMessageId(env, input);
}

const DIGEST_STATUS_CHANNEL_PRIORITY: DeliveryChannel[] = ["email", "slack", "whatsapp"];

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

  const cadenceLabel = digestCadenceLabel(input.cadence);
  const subject = `Five to Nine ${cadenceLabel}: ${input.items.length} competitor changes`;
  const providerResult = await sendDigestEmail(env, {
    email: target.targetValue,
    name: input.userName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    subject,
    cadence: input.cadence,
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
    idempotencyKey: attemptDedupe.idempotencyKey,
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
    idempotencyKey: attemptDedupe.idempotencyKey,
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

  const attemptId = await createDeliveryAttempt(env, {
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

async function deliverDigestToSlackTarget(
  env: AppEnv,
  input: DeliverWeeklyDigestInput,
  lane: DeliveryLane,
  target: DeliveryTargetRecord,
): Promise<DigestAttemptSummary> {
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey({
    digestRunId: input.digestRunId,
    lane,
    channel: "slack",
    targetValue: target.targetValue,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
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
    }),
  });
  const attemptId = await createDeliveryAttempt(env, {
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

function isUsableSlackTarget(target: DeliveryTargetRecord) {
  return (
    !target.isPaused &&
    target.isOptedIn &&
    !target.optedOutAt &&
    target.isValidated &&
    target.validationStatus === "validated"
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
    cadence?: DigestCadence;
  },
): Promise<EmailProviderResult> {
  if (!isPostmarkConfigured(env)) {
    return {
      provider: EMAIL_PROVIDER,
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: "Postmark is not configured for this environment.",
      deliveredAt: null,
    };
  }

  const html = renderDigestHtml({
    name: input.name,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    cadence: input.cadence,
  });
  return sendPostmarkEmail(env, {
    to: input.email,
    subject: input.subject,
    html,
    text: stripHtml(html),
    tag: "weekly-digest",
    metadata: {
      kind: "weekly_digest",
      item_count: String(input.items.length),
      cadence: input.cadence ?? "weekly",
    },
  });
}

async function sendInstantEmail(
  env: AppEnv,
  input: {
    email: string;
    subject: string;
    html: string;
  },
) {
  if (!isPostmarkConfigured(env)) {
    return {
      provider: EMAIL_PROVIDER,
      status: "failed" as const,
      webhookStatus: "provider_unknown" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: "Postmark is not configured for this environment.",
      deliveredAt: null,
    };
  }

  return sendPostmarkEmail(env, {
    to: input.email,
    subject: input.subject,
    html: input.html,
    text: stripHtml(input.html),
    tag: "instant-alert",
  });
}

async function sendPostmarkEmail(
  env: AppEnv,
  input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tag: string;
    metadata?: Record<string, string>;
  },
): Promise<EmailProviderResult> {
  const statusSeenAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetch(POSTMARK_EMAIL_API_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN!.trim(),
      },
      body: JSON.stringify({
        From: postmarkFromEmail(env),
        To: input.to,
        Subject: input.subject,
        HtmlBody: input.html,
        TextBody: input.text,
        MessageStream: postmarkMessageStream(env),
        Tag: input.tag,
        Metadata: input.metadata ?? {},
      }),
    });
  } catch (error) {
    return {
      provider: EMAIL_PROVIDER,
      status: "failed" as const,
      webhookStatus: "failed" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: statusSeenAt,
      errorMessage: `Postmark send failed: ${error instanceof Error ? error.message : "network error"}.`,
      deliveredAt: null,
    };
  }
  const payload = await response.json().catch(() => ({})) as {
    ErrorCode?: number;
    Message?: string;
    MessageID?: string;
  };

  if (!response.ok || (typeof payload.ErrorCode === "number" && payload.ErrorCode !== 0)) {
    return {
      provider: EMAIL_PROVIDER,
      status: "failed" as const,
      webhookStatus: "failed" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: statusSeenAt,
      errorMessage: payload.Message ?? `Postmark send failed with HTTP ${response.status}.`,
      deliveredAt: null,
    };
  }

  return {
    provider: EMAIL_PROVIDER,
    status: "sent" as const,
    webhookStatus: "pending" as const,
    providerMessageId: payload.MessageID ?? null,
    providerStatusLastSeenAt: statusSeenAt,
    errorMessage: null,
    deliveredAt: statusSeenAt,
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
): Promise<{ idempotencyKey: string; duplicate: DeliveryAttemptRecord | null }> {
  const attemptKind = input.deferredByQuietHours ? "quiet-hours" : "send";
  const idempotencyKey = buildInstantDeliveryAttemptIdempotencyKey({
    ...input,
    attemptKind,
  });
  const duplicate = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
  if (duplicate) {
    return { idempotencyKey, duplicate };
  }

  const legacyIdempotencyKey = buildLegacyInstantDeliveryAttemptIdempotencyKey(input);
  const legacyDuplicate = await getDeliveryAttemptByIdempotencyKey(env, legacyIdempotencyKey);
  if (!legacyDuplicate) {
    return { idempotencyKey, duplicate: null };
  }

  if (!input.deferredByQuietHours && legacyDuplicate.status === "skipped_due_to_quiet_hours") {
    return { idempotencyKey, duplicate: null };
  }

  return { idempotencyKey, duplicate: legacyDuplicate };
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

function renderDigestHtml(input: {
  name: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
  cadence?: DigestCadence;
}) {
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
}) {
  const lines = [
    `*Five to Nine ${escapeSlackText(input.cadenceLabel)}: ${input.items.length} competitor changes*`,
    `${formatDate(input.periodStart)} to ${formatDate(input.periodEnd)}`,
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

function renderInstantSlackText(content: InstantAlertContent, events: WatchEventRecord[]) {
  const lines = [
    `*${escapeSlackText(content.subject)}*`,
  ];

  for (const event of events.slice(0, 6)) {
    lines.push(`• ${escapeSlackText(event.title)}: ${escapeSlackText(event.summary)}`);
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

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
