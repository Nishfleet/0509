import {
  classifyDigestItemSource,
  summarizeDigestProofMix,
  summarizePriorityMix,
} from "~/lib/proof-classification";
import type { DigestRecord } from "~/lib/types";

export interface DigestShareSnapshot {
  kind: "digest_share_snapshot";
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  proofMix: ReturnType<typeof summarizeDigestProofMix>;
  priorityMix: ReturnType<typeof summarizePriorityMix>;
  items: Array<{
    id: string;
    watchlistName: string;
    eventType: string;
    proofStatus: string;
    proofStatusLabel: string;
    sourceTypeLabel: string;
    title: string;
    summary: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }>;
}

export function buildDigestShareSnapshot(digest: DigestRecord): DigestShareSnapshot {
  return {
    kind: "digest_share_snapshot",
    periodStart: digest.periodStart,
    periodEnd: digest.periodEnd,
    createdAt: digest.createdAt,
    proofMix: summarizeDigestProofMix(digest.items),
    priorityMix: summarizePriorityMix(digest.items),
    items: digest.items.map((item, index) => {
      const classification = classifyDigestItemSource(item);
      return {
        id: `item-${index + 1}`,
        watchlistName: item.watchlistName,
        eventType: item.eventType,
        proofStatus: classification.status,
        proofStatusLabel: classification.label,
        sourceTypeLabel: classification.sourceTypeLabel,
        title: item.title,
        summary: item.summary,
        metadata: filterDigestMetadataForShare(item.metadata),
        createdAt: item.createdAt,
      };
    }),
  };
}

function filterDigestMetadataForShare(metadata: Record<string, unknown>) {
  const safeKeys = [
    "priorityScore",
    "priorityBand",
    "recommendedAction",
    "proofTrail",
    "sourceStatus",
    "eventStatus",
    "confirmedAt",
  ];
  return Object.fromEntries(
    safeKeys
      .filter((key) => typeof metadata[key] !== "undefined")
      .map((key) => [key, metadata[key]]),
  );
}
