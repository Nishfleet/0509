import { Resend } from "resend";

import {
  createDeliveryAttempt,
  getDeliveryAttemptByIdempotencyKey,
  getWorkspaceDeliveryConfig,
  legacyWorkspaceDeliveryDefaults,
  listDeliveryTargets,
  upsertDeliveryTarget,
  upsertDigestDelivery,
} from "~/lib/data.server";
import { resolveDeliveryConfig } from "~/lib/delivery-policy.server";
import type { AppEnv } from "~/lib/env.server";
import { isResendConfigured } from "~/lib/env.server";
import type {
  DeliveryChannel,
  DeliveryTargetRecord,
  WorkspaceDeliveryConfigRecord,
  DeliveryLane,
} from "~/lib/types";
import { sendDigestWhatsApp } from "~/lib/whatsapp.server";

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

  const subject = `0509 weekly digest: ${input.items.length} competitor changes`;
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

async function resolveDigestWhatsAppTargets(env: AppEnv, userId: string) {
  return (await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "whatsapp",
    limit: 10,
  })).filter((target) => !target.isPaused && target.isOptedIn && !target.optedOutAt);
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
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">0509 weekly digest</p>
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
