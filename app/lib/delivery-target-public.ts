import type { DeliveryTargetRecord } from "~/lib/types";

export type PublicDeliveryTargetRecord = Omit<DeliveryTargetRecord, "metadata"> & {
  metadata: Record<string, string>;
};

export function toPublicDeliveryTarget(
  target: DeliveryTargetRecord,
  options?: { verifiedAccountEmail?: string | null },
): PublicDeliveryTargetRecord {
  return {
    ...target,
    targetValue:
      target.channel === "email"
        ? options?.verifiedAccountEmail ?? "Verified account email"
        : target.channel === "whatsapp"
          ? "Verified WhatsApp destination"
          : target.channel === "slack"
            ? "Connected Slack workspace"
            : "Connected Teams channel",
    providerIdentifier: null,
    metadata:
      target.channel === "slack"
        ? safeSlackMetadata(target.metadata)
        : target.channel === "teams"
          ? safeTeamsMetadata(target.metadata)
          : {},
  };
}

function safeSlackMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return safeDisplayNameMetadata(metadata);
}

function safeTeamsMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return safeDisplayNameMetadata(metadata);
}

function safeDisplayNameMetadata(metadata: Record<string, unknown>): Record<string, string> {
  const displayName = readString(metadata.displayName);
  if (!displayName) {
    return {};
  }

  return { displayName };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
