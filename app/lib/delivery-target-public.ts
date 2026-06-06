import type { DeliveryTargetRecord } from "~/lib/types";

export type PublicDeliveryTargetRecord = Omit<DeliveryTargetRecord, "metadata"> & {
  metadata: Record<string, string>;
};

export function toPublicDeliveryTarget(target: DeliveryTargetRecord): PublicDeliveryTargetRecord {
  return {
    ...target,
    metadata: target.channel === "slack" ? safeSlackMetadata(target.metadata) : {},
  };
}

function safeSlackMetadata(metadata: Record<string, unknown>): Record<string, string> {
  const displayName = readString(metadata.displayName);
  if (!displayName) {
    return {};
  }

  return { displayName };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
