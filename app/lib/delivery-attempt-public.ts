import type { DeliveryAttemptRecord } from "~/lib/types";

export interface PublicDeliveryAttemptSummary {
  digestRunId: string | null;
  channel: DeliveryAttemptRecord["channel"];
  status: DeliveryAttemptRecord["status"];
  webhookStatus: DeliveryAttemptRecord["webhookStatus"];
  targetValue: string;
  eventIds: string[];
  providerStatusLastSeenAt: string | null;
  sentAt: string | null;
  createdAt: string;
  errorMessage: string | null;
}

export function toPublicDeliveryAttemptSummary(
  attempt: DeliveryAttemptRecord,
): PublicDeliveryAttemptSummary {
  return {
    digestRunId: attempt.digestRunId,
    channel: attempt.channel,
    status: attempt.status,
    webhookStatus: attempt.webhookStatus,
    targetValue: deliveryTargetLabel(attempt.channel),
    eventIds: attempt.eventIds,
    providerStatusLastSeenAt: attempt.providerStatusLastSeenAt,
    sentAt: attempt.sentAt,
    createdAt: attempt.createdAt,
    errorMessage: deliveryRecoveryMessage(
      attempt.channel,
      attempt.status,
      attempt.webhookStatus,
      attempt.sentAt,
    ),
  };
}

function deliveryTargetLabel(channel: DeliveryAttemptRecord["channel"]) {
  if (channel === "email") {
    return "Configured email recipient";
  }
  if (channel === "whatsapp") {
    return "Configured WhatsApp recipient";
  }
  return "Connected Slack workspace";
}

function deliveryRecoveryMessage(
  channel: DeliveryAttemptRecord["channel"],
  status: DeliveryAttemptRecord["status"],
  webhookStatus: DeliveryAttemptRecord["webhookStatus"],
  sentAt: string | null,
) {
  if (status === "sent" && webhookStatus !== "delivered") {
    if (channel === "email") {
      return "The email provider accepted this message, but final delivery is unconfirmed.";
    }
    if (channel === "whatsapp") {
      return "WhatsApp accepted this message for sending, but final delivery is unconfirmed.";
    }
    return "Slack accepted this message for sending, but final delivery is unconfirmed.";
  }
  if (status === "pending" && webhookStatus === "provider_unknown") {
    return "Provider outcome is unknown. Check again later or contact support.";
  }
  if (channel === "email" && status === "failed" && sentAt) {
    return "The provider accepted this email, but later reported that delivery failed. Review the recipient address or contact support.";
  }
  if (status === "failed") {
    return "Delivery failed before provider acceptance. Review delivery settings or contact support.";
  }
  return null;
}
