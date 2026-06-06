import type { AdRecord, AnalysisFieldInput } from "~/lib/types";

export function proofLinkForAd(
  ad: Pick<AdRecord, "adSnapshotUrl" | "source"> & { analysisFields?: AnalysisFieldInput[] },
) {
  return ad.adSnapshotUrl ?? (ad.source === "external" ? readAnalysisField(ad, "proof_url") : null);
}

function readAnalysisField(
  ad: { analysisFields?: AnalysisFieldInput[] },
  fieldKey: string,
) {
  return ad.analysisFields?.find((field) => field.fieldKey === fieldKey)?.fieldValue.trim() || null;
}
